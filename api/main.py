import csv
import io
import hashlib
import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import date

import httpx
from fastapi import Cookie, FastAPI, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select

from . import assets, config, script, voice
from .store import (digest, engine, init, invites, jobs, lookup, now, operators, password_hash, project_row,
                    projects, save_project, sessions, trends, uid, users, verifies, workspaces, write)

BUDGET = 4950
LIMITS = {"script": 150, "frame": 800, "clip": 3000, "export": 400, "retry": 600}
LOCAL_PRICES = {"script": 10, "frame": 30, "clip": 200, "export": 60}
LIVE = config.live_enabled()
DEMO = not LIVE and os.getenv("JINGXU_DEMO", "1") == "1"
SESSION_AGE = 86400 * 7
LINK_TTL = 300


@asynccontextmanager
async def lifespan(_):
    init()
    with write() as connection:
        if DEMO and not lookup(connection, workspaces, workspaces.c.id == "demo"):
            connection.execute(workspaces.insert().values(id="demo", name="镜序工作室", quota=100000))
    yield


app = FastAPI(title="镜序", lifespan=lifespan)


@app.exception_handler(ValueError)
async def value_error(_, error):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=422, content={"detail": str(error)})


def need(condition, message, status=422):
    if not condition:
        raise HTTPException(status_code=status, detail=message)


def text(value, limit=2000, required=False):
    need(isinstance(value, str), "请提供文本")
    value = value.strip()
    need(len(value) <= limit and (not required or value), "文本为空或超出长度")
    return value


def identity(session):
    if session:
        with engine.connect() as connection:
            row = lookup(connection, sessions, sessions.c.id == digest(session))
            if row and row["expires"] > now():
                user = lookup(connection, users, users.c.email == row["email"])
                if user:
                    return user["workspace"], user["admin"], user["email"]
    if DEMO and not session:
        return "demo", True, "demo"
    raise HTTPException(401, "请先登录镜序")


def owned(connection, workspace, project_id, lock=False):
    row = project_row(connection, workspace, project_id, lock)
    need(row is not None, "项目不存在", 404)
    return row


def session_cookie(connection, response, email):
    token = uid() + uid()
    connection.execute(sessions.insert().values(id=digest(token), email=email, expires=now() + SESSION_AGE))
    response.set_cookie("jx_session", token, httponly=True, secure=os.getenv("JINGXU_SECURE_COOKIE") == "1",
                        samesite="lax", max_age=SESSION_AGE)


def operator_address(email):
    return email != "demo" and email.lower() in {
        address.strip().lower() for address in os.getenv("JINGXU_OPERATOR_EMAILS", "").split(",") if address.strip()
    }


def is_operator(email):
    if not operator_address(email):
        return False
    with engine.connect() as connection:
        return lookup(connection, operators, operators.c.email == email) is not None


@app.get("/api/session")
def get_session(jx_session: str | None = Cookie(None)):
    workspace, admin, email = identity(jx_session)
    with engine.connect() as connection:
        record = lookup(connection, workspaces, workspaces.c.id == workspace)
    return {"workspace": workspace, "name": record["name"], "admin": admin, "email": email, "live": LIVE,
            "operator": bool(admin and is_operator(email))}


@app.post("/api/login")
def login(body: dict, response: Response):
    email = text(body.get("email", ""), 254, True).lower()
    password = text(body.get("password", ""), 128, True)
    with write() as connection:
        row = lookup(connection, users, users.c.email == email)
        need(row and verifies(password, row["password"]), "邮箱或密码错误", 401)
        session_cookie(connection, response, email)
    return {"ok": True}


@app.post("/api/register")
def register(body: dict, response: Response):
    email = text(body.get("email", ""), 254, True).lower()
    password = text(body.get("password", ""), 128, True)
    code = text(body.get("code", ""), 150, True)
    need(re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) and len(password) >= 10, "邮箱无效或密码少于 10 字符")
    with write() as connection:
        need(not lookup(connection, users, users.c.email == email), "邮箱已注册", 409)
        invitation = lookup(connection, invites, invites.c.id == digest(code), True)
        if invitation and invitation["expires"] > now():
            need(not operator_address(email), "该邮箱需要平台运营注册码", 403)
            workspace, admin = invitation["workspace"], False
            connection.execute(invites.delete().where(invites.c.id == invitation["id"]))
        else:
            bootstrap = os.getenv("JINGXU_OPERATOR_CODE" if operator_address(email) else "JINGXU_WORKSPACE_CODE")
            need(bootstrap and hmac.compare_digest(digest(bootstrap), digest(code)), "邀请码无效", 403)
            workspace, admin = uid(), True
            connection.execute(workspaces.insert().values(id=workspace, name=text(body.get("workspace", "镜序工作室"), 60, True),
                                                           quota=int(os.getenv("JINGXU_WORKSPACE_QUOTA_CENTS", "50000"))))
        need(workspace != "demo", "请先创建独立工作空间", 403)
        connection.execute(users.insert().values(email=email, password=password_hash(password), workspace=workspace, admin=admin))
        if admin and operator_address(email):
            connection.execute(operators.insert().values(email=email))
        session_cookie(connection, response, email)
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response, jx_session: str | None = Cookie(None)):
    if jx_session:
        with write() as connection:
            connection.execute(sessions.delete().where(sessions.c.id == digest(jx_session)))
    response.delete_cookie("jx_session")
    return {"ok": True}


def ledger(records):
    return {"committed": sum(r["reserved"] for r in records), "spent": sum(r["spent"] for r in records)}


def job_records(connection, workspace, project_id=None):
    query = select(jobs).where(jobs.c.workspace == workspace).order_by(jobs.c.created)
    if project_id:
        query = query.where(jobs.c.project == project_id)
    return list(connection.execute(query).mappings())


@app.get("/api/workspace")
def workspace_info(jx_session: str | None = Cookie(None)):
    workspace, admin, _ = identity(jx_session)
    need(admin, "仅管理员可查看用量", 403)
    with engine.connect() as connection:
        record = lookup(connection, workspaces, workspaces.c.id == workspace)
        members = connection.execute(select(users.c.email, users.c.admin).where(users.c.workspace == workspace)).mappings()
        return {"quota": record["quota"], **ledger(job_records(connection, workspace)), "members": list(members)}


@app.get("/api/operations")
def operations(jx_session: str | None = Cookie(None)):
    _, admin, email = identity(jx_session)
    need(admin and is_operator(email), "仅平台运营可访问", 403)
    with engine.connect() as connection:
        records = connection.execute(select(workspaces).order_by(workspaces.c.name)).mappings()
        output = []
        for workspace in records:
            entries = job_records(connection, workspace["id"])
            output.append({**dict(workspace), **ledger(entries),
                           "pending": sum(job["state"] in {"queued", "running"} for job in entries),
                           "uncertain": sum(job["state"] == "uncertain" for job in entries)})
    return output


@app.patch("/api/operations/{workspace_id}/quota")
def update_quota(workspace_id: str, body: dict, jx_session: str | None = Cookie(None)):
    _, admin, email = identity(jx_session)
    need(admin and is_operator(email), "仅平台运营可访问", 403)
    cents = body.get("cents")
    need(type(cents) is int and 0 <= cents <= 100_000_000, "额度超出范围")
    with write() as connection:
        record = lookup(connection, workspaces, workspaces.c.id == workspace_id, True)
        need(record, "工作空间不存在", 404)
        total = ledger(job_records(connection, workspace_id))
        need(cents >= total["spent"] + total["committed"], "额度不能低于已结算及占额金额", 409)
        connection.execute(workspaces.update().where(workspaces.c.id == workspace_id).values(quota=cents))
    return {"ok": True}


@app.post("/api/workspace/invites")
def invite(jx_session: str | None = Cookie(None)):
    workspace, admin, _ = identity(jx_session)
    need(admin and workspace != "demo", "邀请需要独立管理员账号", 403)
    code = uid()
    with write() as connection:
        connection.execute(invites.insert().values(id=digest(code), workspace=workspace, expires=now() + 86400))
    return {"code": code}


def project_summary(row):
    data = row["data"]
    return {"id": row["id"], "name": data["name"], "updated": row["updated"], "export": data["export"]}


@app.post("/api/voice/preview")
def preview_voice(body: dict, jx_session: str | None = Cookie(None)):
    identity(jx_session)
    dialogue = text(body.get("text", ""), 120, True)
    need(any(character.isalnum() for character in dialogue), "请输入可朗读的台词")
    audio = voice.local_wav(dialogue)
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@app.get("/api/projects")
def list_projects(jx_session: str | None = Cookie(None)):
    workspace, _, _ = identity(jx_session)
    with engine.connect() as connection:
        rows = connection.execute(select(projects).where(projects.c.workspace == workspace).order_by(projects.c.updated.desc())).mappings()
        return [project_summary(row) for row in rows]


@app.post("/api/projects")
def new_project(body: dict, jx_session: str | None = Cookie(None)):
    workspace, _, _ = identity(jx_session)
    name = text(body.get("name", ""), 100, True)
    product = text(body.get("product", ""), 2000, True)
    audience = text(body.get("audience", "视频号家庭与日常消费用户"), 200, True)
    fields = []
    for line in product.splitlines():
        key, separator, value = line.replace("：", ":", 1).partition(":")
        if separator and key.strip() and value.strip() and len(key) <= 30:
            fields.append((key.strip(), value.strip()))
        elif line.strip():
            fields.append(("商品资料", line.strip()))
    facts = [{"id": uid(), "label": label, "value": value, "source": "手工录入", "confirmed": False}
             for label, value in fields[:20]]
    data = {"name": name, "audience": audience, "facts": facts, "assets": [], "script": None,
            "version": 0, "refinements": 0, "export": None, "metrics": []}
    project_id = uid()
    with write() as connection:
        connection.execute(projects.insert().values(id=project_id, workspace=workspace, data=data, updated=now()))
    return {"id": project_id}


def snapshot(workspace, project_id):
    with engine.connect() as connection:
        row = owned(connection, workspace, project_id)
        records = job_records(connection, workspace, project_id)
    fields = ("id", "kind", "state", "reserved", "spent", "created", "updated", "result")
    data = row["data"]
    return {"id": project_id, **data, "budget": BUDGET, **ledger(records),
            "pacing_issues": script.pacing_issues(data["script"]["beats"]) if data["script"] else [],
            "jobs": [{**{key: j[key] for key in fields},
                      "price_version": j["payload"].get("price_version", "legacy")} for j in records]}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, jx_session: str | None = Cookie(None)):
    return snapshot(identity(jx_session)[0], project_id)


@app.get("/api/projects/{project_id}/events")
async def events(project_id: str, request: Request, jx_session: str | None = Cookie(None)):
    import asyncio
    workspace = identity(jx_session)[0]
    snapshot(workspace, project_id)

    async def stream():
        previous = ""
        for _ in range(60):
            if await request.is_disconnected():
                return
            current = json.dumps(snapshot(workspace, project_id), ensure_ascii=False)
            yield f"data: {current}\n\n" if current != previous else ": heartbeat\n\n"
            previous = current
            await asyncio.sleep(2)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/projects/{project_id}/media/{filename}")
def media(project_id: str, filename: str, download: bool = False, expires: int = 0,
          signature: str = "", jx_session: str | None = Cookie(None)):
    key = os.getenv("JINGXU_DOWNLOAD_KEY")
    signed = bool(key and expires >= now() and hmac.compare_digest(signature, sign_download(key, project_id, filename, expires)))
    workspace = identity(jx_session)[0] if not signed else None
    need(re.fullmatch(r"[a-f0-9]{32}(?:-cutout)?\.(?:png|jpg|mp4)", filename), "素材不存在", 404)
    if not signed:
        with engine.connect() as connection:
            owned(connection, workspace, project_id)
    path = assets.path_for(project_id, filename)
    try:
        assets.restore_file(project_id, path)
    except Exception as error:
        raise HTTPException(404, "素材不存在") from error
    need(path.is_file(), "素材不存在", 404)
    return FileResponse(path, filename=filename if download else None,
                        headers={"Cache-Control": "private, no-store"})


def sign_download(key, project_id, filename, expires):
    return hmac.new(key.encode(), f"{project_id}/{filename}/{expires}".encode(), hashlib.sha256).hexdigest()


@app.get("/api/projects/{project_id}/download")
def download_link(project_id: str, jx_session: str | None = Cookie(None)):
    workspace = identity(jx_session)[0]
    with engine.connect() as connection:
        row = owned(connection, workspace, project_id)
    filename = row["data"]["export"]
    need(filename, "暂无可下载的成片", 409)
    url = f"/api/projects/{project_id}/media/{filename}?download=true"
    key = os.getenv("JINGXU_DOWNLOAD_KEY")
    if key:
        expires = int(now()) + LINK_TTL
        url += f"&expires={expires}&signature={sign_download(key, project_id, filename, expires)}"
    return {"url": url}


@app.post("/api/projects/{project_id}/assets")
def upload(project_id: str, file: UploadFile = File(), kind: str = Form("product"),
           view: str = Form("正面"), jx_session: str | None = Cookie(None)):
    workspace = identity(jx_session)[0]
    need(kind in {"product", "character", "scene"}, "素材类型无效")
    view = text(view, 60, True)
    with engine.connect() as connection:
        owned(connection, workspace, project_id)
    asset_id = uid()
    path = assets.path_for(project_id, f"{asset_id}.png")
    try:
        assets.image_asset(file.file.read(assets.MAX_BYTES + 1), path)
    except (OSError, ValueError, assets.Image.DecompressionBombError) as error:
        raise HTTPException(422, "请上传 12 MB 以内的有效图片") from error
    cutout = path.with_name(path.stem + "-cutout.png")
    assets.publish_file(project_id, path)
    assets.publish_file(project_id, cutout)
    item = {"id": asset_id, "kind": kind, "view": view, "file": path.name, "cutout": cutout.name, "version": 1}
    with write() as connection:
        row = owned(connection, workspace, project_id, True)
        data = row["data"]
        item["version"] = 1 + sum(a["kind"] == kind and a["view"] == view for a in data["assets"])
        data["assets"].append(item)
        save_project(connection, row, data)
    return item


def choose_price(kind, beat=None):
    if not LIVE:
        if kind == "clip" and (not beat["dynamic"] or beat["product"]):
            return 20
        return LOCAL_PRICES[kind]
    try:
        prices = config.load_prices()
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    if kind == "clip":
        need("static_clip" in prices, "尚未设置单镜配音及合成费用上限", 409)
        static = int(prices["static_clip"])
        if not beat["dynamic"] or beat["product"] or not os.getenv("ARK_API_KEY"):
            need(static > 0, "费用上限必须大于零", 409)
            return static
        key = "dynamic_clip_sec"
        need(key in prices, "尚未设置视频单价上限", 409)
        price = static + int(prices[key]) * (beat["end"] - beat["start"])
    else:
        key = "product_frame" if kind == "frame" and beat["product"] else kind
        need(key in prices, "尚未设置此任务的费用上限", 409)
        price = int(prices[key])
    need(price > 0, "费用上限必须大于零", 409)
    return price


def enqueue(connection, row, kind, payload, amount):
    workspace = row["workspace"]
    ws = lookup(connection, workspaces, workspaces.c.id == workspace, True)
    records = job_records(connection, workspace)
    current = [r for r in records if r["project"] == row["id"]]
    target = payload.get("beat", {}).get("id")
    need(not any(r["kind"] == kind and r["state"] in {"queued", "running", "uncertain"} and
                 (r["payload"].get("beat") or {}).get("id") == target for r in current), "已有相同任务正在处理", 409)
    retry = any(r["kind"] == kind and r["state"] in {"failed", "uncertain"} and
                (r["payload"].get("beat") or {}).get("id") == target for r in current)
    bucket = "retry" if retry else kind
    rate_version = digest(os.getenv("JINGXU_PRICES_CENTS", "{}"))[:12] if LIVE else "demo-v1"
    payload = {**payload, "bucket": bucket, "live": LIVE, "price_version": rate_version}
    category = sum(r["spent"] + r["reserved"] for r in current if r["payload"].get("bucket") == bucket)
    total = ledger(current)
    aggregate = ledger(records)
    need(category + amount <= LIMITS[bucket] and total["spent"] + total["committed"] + amount <= BUDGET,
         "项目可用额度不足，请改用已有素材", 409)
    need(aggregate["spent"] + aggregate["committed"] + amount <= ws["quota"], "工作空间可用额度不足", 409)
    job = uid()
    connection.execute(jobs.insert().values(id=job, project=row["id"], workspace=workspace, kind=kind, state="queued",
                                             reserved=amount, spent=0, created=now(), updated=now(), payload=payload, result={}))
    return job


def selected(data, shot_id):
    need(data["script"], "请先生成剧本", 409)
    beat = next((b for b in data["script"]["beats"] if b["id"] == shot_id), None)
    need(beat, "镜头不存在", 404)
    return beat


def invalidate(data, beat):
    beat["revision"] += 1
    beat["approved"] = False
    for field in ("frame", "clip", "caption"):
        beat.pop(field, None)
    data["export"] = None


@app.post("/api/projects/{project_id}/actions/{action}")
def project_action(project_id: str, action: str, body: dict, jx_session: str | None = Cookie(None)):
    workspace, admin, _ = identity(jx_session)
    imported = None
    if action == "import-product":
        url = text(body.get("url", ""), 1000, True)
        with engine.connect() as connection:
            owned(connection, workspace, project_id)
        try:
            imported = assets.approved_source(url, "JINGXU_PRODUCT_SOURCES")
        except (httpx.HTTPError, ValueError) as error:
            raise ValueError("无法读取授权商品来源，请手工录入") from error
        need(isinstance(imported, dict) and imported, "商品资料格式无效")
    with write() as connection:
        row = owned(connection, workspace, project_id, True)
        data = row["data"]
        if action == "fact":
            fact = {"id": uid(), "label": text(body.get("label", ""), 60, True),
                    "value": text(body.get("value", ""), 1000, True),
                    "source": text(body.get("source", "手工录入"), 500, True), "confirmed": False}
            data["facts"].append(fact)
        elif action == "import-product":
            for key, value in list(imported.items())[:15]:
                if isinstance(value, (str, int, float)):
                    data["facts"].append({"id": uid(), "label": str(key)[:60], "value": str(value)[:1000],
                                          "source": url, "confirmed": False})
        elif action == "confirm":
            fact = next((f for f in data["facts"] if f["id"] == body.get("id")), None)
            need(fact, "商品资料不存在", 404)
            fact["confirmed"] = True
        elif action == "refine":
            beat = selected(data, body.get("id"))
            need(not LIVE or os.getenv("DEEPSEEK_API_KEY"), "此任务需要配置 DeepSeek", 409)
            need(data["refinements"] < 2, "自动修订已达上限，请编辑分镜", 409)
            notes = text(body.get("notes", ""), 600, True)
            pool = lookup(connection, trends, trends.c.workspace == workspace)
            payload = {"document": data, "beat": beat, "version": data["version"], "notes": notes,
                       "trends": pool["data"] if pool else []}
            job = enqueue(connection, row, "script", payload, choose_price("script"))
            data["refinements"] += 1
            save_project(connection, row, data)
            return {"job": job}
        elif action == "script":
            need(any(f["confirmed"] for f in data["facts"]), "请先确认商品信息", 409)
            need(not LIVE or os.getenv("DEEPSEEK_API_KEY"), "此任务需要配置 DeepSeek", 409)
            need(data["refinements"] < 2, "自动修订已达上限，请编辑分镜", 409)
            pool = lookup(connection, trends, trends.c.workspace == workspace)
            job = enqueue(connection, row, "script", {"document": data, "trends": pool["data"] if pool else []}, choose_price("script"))
            if data["script"]:
                data["refinements"] += 1
                save_project(connection, row, data)
            return {"job": job}
        elif action in {"edit", "frame", "approve", "clip"}:
            beat = selected(data, body.get("id"))
            if action == "edit":
                for key in ("title", "description", "dialogue", "prompt", "motion", "hook"):
                    if key in body:
                        beat[key] = text(body[key])
                if "dynamic" in body:
                    need(isinstance(body["dynamic"], bool), "镜头模式无效")
                    beat["dynamic"] = body["dynamic"]
                if "asset_ids" in body:
                    refs = body["asset_ids"]
                    need(isinstance(refs, list) and all(isinstance(ref, str) and any(a["id"] == ref for a in data["assets"]) for ref in refs),
                         "引用的素材不存在")
                    beat["asset_ids"] = refs
                script.validate_script(data["script"]["beats"], data["facts"])
                invalidate(data, beat)
            elif action == "frame":
                bound = [a for a in data["assets"] if a["id"] in beat["asset_ids"]]
                reference = next((a["file"] for a in bound if a["kind"] == "product"), None) if beat["product"] else (bound[0]["file"] if bound else None)
                need(not LIVE or beat["product"] or (os.getenv("ARK_API_KEY") and os.getenv("ARK_IMAGE_MODEL")),
                     "此镜需要配置火山引擎图像模型", 409)
                need(not (LIVE and beat["product"] and not reference), "商品镜头需要绑定实拍素材", 409)
                return {"job": enqueue(connection, row, "frame", {"beat": beat, "version": data["version"], "reference": reference}, choose_price("frame", beat))}
            elif action == "approve":
                need(beat.get("frame"), "需要先生成首帧", 409)
                beat["approved"] = True
            else:
                need(beat["approved"] and beat.get("frame"), "请先审核首帧", 409)
                need(not LIVE or not beat["dynamic"] or beat["product"] or (os.getenv("ARK_API_KEY") and os.getenv("ARK_VIDEO_MODEL")),
                     "此镜需要配置火山引擎视频模型", 409)
                return {"job": enqueue(connection, row, "clip", {"beat": beat, "version": data["version"]}, choose_price("clip", beat))}
        elif action == "export":
            need(data["script"], "请先生成剧本", 409)
            beats = data["script"]["beats"]
            script.validate_script(beats, data["facts"])
            need(all(b.get("clip") and b["approved"] for b in beats), "每个分镜都需要审核并生成片段", 409)
            return {"job": enqueue(connection, row, "export", {"beats": beats, "version": data["version"]}, choose_price("export"))}
        elif action == "metrics":
            content = text(body.get("csv", ""), 100000, True)
            reader = csv.DictReader(io.StringIO(content.removeprefix("\ufeff")), strict=True)
            count_fields = ("impressions", "retained_3s", "mid_views", "clicks", "orders")
            columns = ("version", "date", *count_fields)
            versions = {r["result"]["file"] for r in job_records(connection, workspace, project_id)
                        if r["kind"] == "export" and r["state"] == "done"}
            values = {(item["version"], item["date"]): item for item in data["metrics"]}
            try:
                header = reader.fieldnames or []
                missing_headers = [key for key in columns if key not in header]
                need(not missing_headers, "CSV 缺少列 " + "、".join(missing_headers))
                need(len(header) == len(set(header)), "CSV 含有重复列名")
                for record in reader:
                    line = f"CSV 第 {reader.line_num} 行"
                    need(None not in record, f"{line}含有多余的数据列")
                    missing = [key for key in columns if not (record[key] or "").strip()]
                    need(not missing, f"{line}缺少字段 " + "、".join(missing))
                    version, day = record["version"].strip(), record["date"].strip()
                    need(version in versions, f"{line}需要关联已导出的成片文件名")
                    try:
                        day = date.fromisoformat(day).isoformat()
                    except ValueError:
                        raise HTTPException(422, f"{line}的 date 无效，请使用 YYYY-MM-DD") from None
                    item = {}
                    for key in count_fields:
                        try:
                            item[key] = int(record[key])
                        except ValueError:
                            raise HTTPException(422, f"{line}的 {key} 必须是非负整数") from None
                        need(item[key] >= 0, f"{line}的 {key} 必须是非负整数")
                    values[version, day] = {"version": version, "date": day, **item}
            except csv.Error:
                raise HTTPException(422, f"CSV 第 {max(1, reader.line_num)} 行附近格式无效") from None
            data["metrics"] = list(values.values())
        elif action in {"resume", "settle"}:
            record = lookup(connection, jobs, (jobs.c.id == body.get("job")) & (jobs.c.workspace == workspace) & (jobs.c.project == project_id), True)
            need(record is not None, "任务不存在", 404)
            if action == "resume":
                need(record["state"] == "uncertain" and record["result"].get("order"), "此任务没有可查询的原订单", 409)
                connection.execute(jobs.update().where(jobs.c.id == record["id"]).values(state="queued", updated=now()))
            else:
                need(admin and record["state"] in {"done", "failed", "uncertain"} and record["reserved"] > 0, "此任务不可结算", 409)
                cents = body.get("cents")
                need(type(cents) is int and 0 <= cents <= 10_000_000, "结算金额无效")
                result = dict(record["result"])
                if cents > record["reserved"]:
                    result["message"] = "供应商账单超出预留，请调整价格表"
                    result["overrun"] = cents - record["reserved"]
                connection.execute(jobs.update().where(jobs.c.id == record["id"]).values(
                    reserved=0, spent=cents, updated=now(), result=result,
                    state="failed" if record["state"] == "uncertain" else record["state"]))
        else:
            raise HTTPException(404, "操作不存在")
        save_project(connection, row, data)
    return {"ok": True}


@app.get("/api/trends")
def get_trends(jx_session: str | None = Cookie(None)):
    workspace = identity(jx_session)[0]
    with engine.connect() as connection:
        row = lookup(connection, trends, trends.c.workspace == workspace)
        return row["data"] if row else []


def save_trends(workspace, entries):
    need(isinstance(entries, list) and len(entries) <= 100, "热梗列表无效")
    cleaned = []
    for entry in entries:
        need(isinstance(entry, dict) and isinstance(entry.get("tags", []), list), "热梗格式无效")
        day = date.fromisoformat(text(entry.get("date", ""), 10, True))
        expires = date.fromisoformat(text(entry.get("expires", ""), 10, True))
        need(expires >= day, "到期日期早于发布时间")
        cleaned.append({"text": text(entry.get("text", ""), 120, True), "source": text(entry.get("source", ""), 500, True),
                        "date": day.isoformat(), "expires": expires.isoformat(),
                        "tags": [text(tag, 30, True) for tag in entry.get("tags", [])[:12]]})
    with write() as connection:
        row = lookup(connection, trends, trends.c.workspace == workspace, True)
        current = {item["text"]: item for item in row["data"]} if row else {}
        current.update({item["text"]: item for item in cleaned})
        if row:
            connection.execute(trends.update().where(trends.c.workspace == workspace).values(data=list(current.values())))
        else:
            connection.execute(trends.insert().values(workspace=workspace, data=list(current.values())))
    return len(cleaned)


@app.post("/api/trends")
def add_trend(body: dict, jx_session: str | None = Cookie(None)):
    workspace, admin, _ = identity(jx_session)
    need(admin, "仅管理员可维护热梗", 403)
    if "url" in body:
        entries = assets.approved_source(text(body["url"], 1000, True), "JINGXU_TREND_SOURCES")
    else:
        entries = [body]
    return {"count": save_trends(workspace, entries)}
