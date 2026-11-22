import csv
import io
import hashlib
import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import date
from typing import Annotated, NamedTuple

import httpx
from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from sqlalchemy import select, text as sql_text

from . import assets, config, script, security, voice
from .store import (digest, engine, init, invites, jobs, lookup, memberships, now, operators, password_hash, project_row,
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


@app.middleware("http")
async def check_write_origin(request: Request, call_next):
    if not security.allowed_write(request):
        return JSONResponse(status_code=403, content={"detail": "请求来源不受信任"})
    return await call_next(request)


@app.exception_handler(ValueError)
async def value_error(_, error):
    return JSONResponse(status_code=422, content={"detail": str(error)})


def need(condition, message, status=422):
    if not condition:
        raise HTTPException(status_code=status, detail=message)


def text(value, limit=2000, required=False):
    need(isinstance(value, str), "请提供文本")
    value = value.strip()
    need(len(value) <= limit and (not required or value), "文本为空或超出长度")
    return value


def product_slot(value):
    need(value is None or (type(value) is int and value in range(0, script.DURATION, 10)), "商品首现时间无效")
    return value


WorkspaceSelector = Annotated[str | None, Query(alias="workspace", max_length=32)]


class WorkspaceIdentity(NamedTuple):
    workspace: str
    role: str
    email: str

    @property
    def admin(self):
        return self.role in {"owner", "admin"}


def identity(jx_session: Annotated[str | None, Cookie()] = None, selected_workspace: WorkspaceSelector = None):
    if jx_session:
        with engine.connect() as connection:
            row = lookup(connection, sessions, sessions.c.id == digest(jx_session))
            if row and row["expires"] > now():
                user = lookup(connection, users, users.c.email == row["email"])
                if user:
                    workspace = selected_workspace if selected_workspace is not None else user["workspace"]
                    membership = lookup(connection, memberships, (memberships.c.workspace == workspace) &
                                        (memberships.c.email == user["email"]))
                    need(membership, "你没有这个工作空间的访问权限", 403)
                    return WorkspaceIdentity(workspace, membership["role"], user["email"])
    if DEMO and not jx_session:
        need(selected_workspace in {None, "demo"}, "你没有这个工作空间的访问权限", 403)
        return WorkspaceIdentity("demo", "admin", "demo")
    raise HTTPException(401, "请先登录镜序")


Access = Annotated[WorkspaceIdentity, Depends(identity)]


def workspace_choices(connection, access):
    if access.email == "demo":
        return [{"id": "demo", "name": "镜序工作室", "role": "admin"}]
    query = (select(workspaces.c.id, workspaces.c.name, memberships.c.role)
             .join(memberships, memberships.c.workspace == workspaces.c.id)
             .where(memberships.c.email == access.email).order_by(workspaces.c.name, workspaces.c.id))
    return [dict(row) for row in connection.execute(query).mappings()]


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


@app.get("/api/health")
def health():
    with engine.connect() as connection:
        connection.execute(sql_text("SELECT 1"))
    return {"status": "ok"}


@app.get("/api/session")
def get_session(access: Access):
    with engine.connect() as connection:
        choices = workspace_choices(connection, access)
    record = next(row for row in choices if row["id"] == access.workspace)
    return {"workspace": access.workspace, "name": record["name"], "admin": access.admin, "role": access.role,
            "email": access.email, "live": LIVE, "operator": is_operator(access.email), "workspaces": choices,
            "canCreateWorkspace": any(row["role"] == "owner" for row in choices)}


@app.post("/api/workspaces", status_code=201)
def create_workspace(body: dict, access: Access):
    name = text(body.get("name", ""), 60, True)
    with write() as connection:
        owner = lookup(connection, memberships, (memberships.c.email == access.email) & (memberships.c.role == "owner"))
        need(owner, "仅工作空间主账号可创建空间", 403)
        workspace = uid()
        connection.execute(workspaces.insert().values(id=workspace, name=name, quota=0))
        connection.execute(memberships.insert().values(workspace=workspace, email=access.email, role="owner"))
    return {"id": workspace, "name": name, "role": "owner"}


@app.post("/api/workspaces/join")
def join_workspace(body: dict, access: Access, request: Request):
    security.limit_request(request, "join", 15)
    need(access.email != "demo", "请登录后加入工作空间", 403)
    code = text(body.get("code", ""), 150, True)
    with write() as connection:
        invitation = lookup(connection, invites, invites.c.id == digest(code), True)
        need(invitation and invitation["expires"] > now() and invitation["workspace"] != "demo", "邀请码无效或已过期", 403)
        workspace = invitation["workspace"]
        member = lookup(connection, memberships, (memberships.c.workspace == workspace) & (memberships.c.email == access.email))
        need(not member, "你已加入该工作空间", 409)
        connection.execute(memberships.insert().values(workspace=workspace, email=access.email, role="member"))
        connection.execute(invites.delete().where(invites.c.id == invitation["id"]))
    return {"id": workspace}


@app.post("/api/login")
def login(body: dict, response: Response, request: Request):
    email = text(body.get("email", ""), 254, True).lower()
    password = text(body.get("password", ""), 128, True)
    security.limit_request(request, "login", 30, account=email)
    with write() as connection:
        row = lookup(connection, users, users.c.email == email)
        need(row and verifies(password, row["password"]), "邮箱或密码错误", 401)
        session_cookie(connection, response, email)
    return {"ok": True}


@app.post("/api/register")
def register(body: dict, response: Response, request: Request):
    security.limit_request(request, "register", 15)
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
        connection.execute(memberships.insert().values(workspace=workspace, email=email, role="owner" if admin else "member"))
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
def workspace_info(access: Access):
    workspace = access.workspace
    need(access.admin, "仅管理员可查看用量", 403)
    with engine.connect() as connection:
        record = lookup(connection, workspaces, workspaces.c.id == workspace)
        members = connection.execute(select(memberships.c.email, memberships.c.role)
                                     .where(memberships.c.workspace == workspace).order_by(memberships.c.email)).mappings()
        return {"quota": record["quota"], **ledger(job_records(connection, workspace)),
                "members": [{**row, "admin": row["role"] != "member"} for row in members]}


@app.get("/api/operations")
def operations(access: Access):
    need(is_operator(access.email), "仅平台运营可访问", 403)
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
def update_quota(workspace_id: str, body: dict, access: Access):
    need(is_operator(access.email), "仅平台运营可访问", 403)
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
def invite(access: Access):
    workspace = access.workspace
    need(access.admin and workspace != "demo", "邀请需要独立管理员账号", 403)
    code = uid()
    with write() as connection:
        connection.execute(invites.insert().values(id=digest(code), workspace=workspace, expires=now() + 86400))
    return {"code": code}


def project_summary(row):
    data = row["data"]
    script_data = data.get("script") or {}
    thumbnail = next((beat["frame"] for beat in script_data.get("beats", []) if beat.get("frame")), None)
    return {"id": row["id"], "name": data["name"], "updated": row["updated"], "export": data["export"],
            "has_script": bool(script_data), "thumbnail": thumbnail}


@app.post("/api/voice/preview")
def preview_voice(body: dict, access: Access, request: Request):
    security.limit_request(request, "voice-preview", 30)
    dialogue = text(body.get("text", ""), 120, True)
    need(any(character.isalnum() for character in dialogue), "请输入可朗读的台词")
    audio = voice.local_wav(dialogue)
    return Response(audio, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@app.get("/api/projects")
def list_projects(access: Access):
    workspace = access.workspace
    with engine.connect() as connection:
        rows = connection.execute(select(projects).where(projects.c.workspace == workspace).order_by(projects.c.updated.desc())).mappings()
        return [project_summary(row) for row in rows]


@app.post("/api/projects")
def new_project(body: dict, access: Access):
    workspace = access.workspace
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
    data = {"name": name, "audience": audience, "direction": text(body.get("direction", "")),
            "product_start": product_slot(body.get("product_start")),
            "facts": facts, "assets": [], "script": None,
            "version": 0, "refinements": 0, "export": None, "metrics": []}
    project_id = uid()
    with write() as connection:
        connection.execute(projects.insert().values(id=project_id, workspace=workspace, data=data, updated=now()))
    return {"id": project_id}


def job_source(job):
    payload = job["payload"]
    if not payload.get("live"):
        return "demo"
    if job["kind"] == "script":
        return "deepseek"
    if payload.get("cloud_prompt"):
        return "cloud_image"
    if job["kind"] == "portrait":
        return "ark_video" if not payload.get("import_order") else "ark_reference"
    beat = payload.get("beat") or {}
    if job["kind"] == "frame" and not beat.get("product") and not payload.get("local_frame"):
        return "ark_image"
    if job["kind"] == "clip" and payload.get("dynamic_video", beat.get("dynamic") and not beat.get("product")):
        return "ark_video"
    return "local"


def snapshot(workspace, project_id):
    with engine.connect() as connection:
        row = owned(connection, workspace, project_id)
        records = job_records(connection, workspace, project_id)
    fields = ("id", "kind", "state", "reserved", "spent", "created", "updated", "result")
    data = row["data"]
    catalog = render_model_options() if LIVE and os.getenv("ARK_API_KEY") else None
    settings = config.render_settings(data, catalog) if catalog else None
    return {"id": project_id, **data, "budget": BUDGET, **ledger(records),
            "render_models": catalog, "render_settings": settings,
            "pacing_issues": script.pacing_issues(data["script"]["beats"]) if data["script"] else [],
            "jobs": [{**{key: j[key] for key in fields}, "source": job_source(j),
                      "model": j["payload"].get("model"), "resolution": j["payload"].get("resolution"),
                      "price_version": j["payload"].get("price_version", "legacy")} for j in records]}


@app.get("/api/projects/{project_id}")
def get_project(project_id: str, access: Access):
    return snapshot(access.workspace, project_id)


@app.get("/api/projects/{project_id}/events")
async def events(project_id: str, request: Request, access: Access):
    import asyncio
    workspace = access.workspace
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
          signature: str = "", jx_session: str | None = Cookie(None), selected_workspace: WorkspaceSelector = None):
    key = os.getenv("JINGXU_DOWNLOAD_KEY")
    signed = bool(key and expires >= now() and hmac.compare_digest(signature, sign_download(key, project_id, filename, expires)))
    workspace = identity(jx_session, selected_workspace).workspace if not signed else None
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
def download_link(project_id: str, access: Access):
    workspace = access.workspace
    with engine.connect() as connection:
        row = owned(connection, workspace, project_id)
    filename = row["data"]["export"]
    need(filename, "暂无可下载的成片", 409)
    url = f"/api/projects/{project_id}/media/{filename}?download=true&workspace={workspace}"
    key = os.getenv("JINGXU_DOWNLOAD_KEY")
    if key:
        expires = int(now()) + LINK_TTL
        url += f"&expires={expires}&signature={sign_download(key, project_id, filename, expires)}"
    return {"url": url}


@app.post("/api/projects/{project_id}/assets")
def upload(project_id: str, access: Access, file: UploadFile = File(), kind: str = Form("product"), view: str = Form("正面")):
    workspace = access.workspace
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


def render_model_options():
    try:
        return config.model_options(config.load_prices())
    except ValueError:
        return None


def choose_price(kind, beat=None, *, rate=None):
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
        if rate is None and (not beat["dynamic"] or beat["product"] or not os.getenv("ARK_API_KEY")):
            need(static > 0, "费用上限必须大于零", 409)
            return static
        key = "dynamic_clip_sec"
        need(key in prices, "尚未设置视频单价上限", 409)
        price = static + (rate if rate is not None else prices[key]) * (beat["end"] - beat["start"])
    else:
        key = "product_frame" if kind == "frame" and beat["product"] else kind
        need(key in prices, "尚未设置此任务的费用上限", 409)
        price = rate if rate is not None else prices[key]
    need(price > 0, "费用上限必须大于零", 409)
    return price


def enqueue(connection, row, kind, payload, amount):
    workspace = row["workspace"]
    ws = lookup(connection, workspaces, workspaces.c.id == workspace, True)
    records = job_records(connection, workspace)
    current = [r for r in records if r["project"] == row["id"]]
    target = payload.get("beat", {}).get("id")
    need(not any(r["kind"] == kind and (r["payload"].get("beat") or {}).get("id") == target and
                 (r["state"] in {"queued", "running"} or (r["state"] == "uncertain" and
                  (not r["payload"].get("cloud_prompt") or payload.get("cloud_prompt")))) for r in current),
         "已有相同任务正在处理或等待核对", 409)
    if payload.get("cloud_file"):
        need(not any(r["payload"].get("cloud_file") == payload["cloud_file"] and r["state"] in {"queued", "running", "uncertain"}
                     for r in current), "相同场景正在生成或等待核对，完成后可复用", 409)
    retry = any(r["kind"] == kind and (r["state"] in {"failed", "uncertain"} or
                (kind == "clip" and payload.get("full_dynamic") and r["state"] == "done" and r["payload"].get("full_dynamic"))) and
                (r["payload"].get("beat") or {}).get("id") == target for r in current)
    bucket = "retry" if retry else "clip" if kind == "portrait" else kind
    rate_basis = [os.getenv("JINGXU_PRICES_CENTS", "{}"), payload.get("model"), payload.get("resolution"), amount]
    rate_version = digest(json.dumps(rate_basis))[:12] if LIVE else "demo-v1"
    payload = {**payload, "bucket": bucket, "live": LIVE, "price_version": rate_version}
    category = sum(r["spent"] + r["reserved"] for r in current if r["payload"].get("bucket") == bucket)
    total = ledger(current)
    aggregate = ledger(records)
    category_limit = 3500 if bucket == "clip" and (row["data"].get("render_settings") or {}).get("full_dynamic") is True else LIMITS[bucket]
    need(category + amount <= category_limit and total["spent"] + total["committed"] + amount <= BUDGET,
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
    for field in ("frame", "clip", "caption", "clip_dynamic", "clip_reviewed", "frame_trusted_until"):
        beat.pop(field, None)
    data["export"] = None


def dynamic_project(data):
    return LIVE and data.get("render_settings", {}).get("full_dynamic") is True


def ready_clip(beat, full_dynamic):
    return beat.get("clip") and beat["approved"] and (not full_dynamic or beat.get("clip_dynamic") is True)


def enqueue_clip(connection, row, data, beat):
    need(beat["approved"] and beat.get("frame"), f"请先审核第 {beat['id']} 镜首帧", 409)
    full = dynamic_project(data)
    moving = LIVE and (full or (beat["dynamic"] and not beat["product"]))
    payload = {"beat": beat, "version": data["version"], "dynamic_video": moving, "full_dynamic": full}
    if moving:
        payload["visual_context"] = script.visual_context(data["script"], beat)
    rate = None
    if moving:
        options = render_model_options()
        need(os.getenv("ARK_API_KEY") and options, "请先配置方舟及模型计价", 409)
        settings = config.render_settings(data, options)
        need(settings["video"], "暂无已上线的视频模型", 409)
        context = payload.get("visual_context")
        character = beat.get("frame_subject") == "character"
        if context:
            character = character or (context["style"] == "realistic" and bool(context["characters"]))
        else:
            character = character or any(asset["id"] in beat["asset_ids"] and asset["kind"] == "character"
                                         for asset in data["assets"])
        if full and character:
            need(beat.get("frame_trusted_until", 0) > now(), "写实人物请绑定未过期的方舟尾帧，并重新审核首帧", 409)
            payload["trusted_until"] = beat["frame_trusted_until"]
        payload.update(model=settings["video"], resolution=settings["resolution"])
        rate = options["video"][payload["model"]]["rates"][payload["resolution"]]
    return enqueue(connection, row, "clip", payload, choose_price("clip", beat, rate=rate))


@app.post("/api/projects/{project_id}/actions/{action}")
def project_action(project_id: str, action: str, body: dict, access: Access):
    workspace, admin = access.workspace, access.admin
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
        if action == "render-models":
            need(LIVE and os.getenv("ARK_API_KEY"), "正式模式配置方舟后可选择模型", 409)
            options = render_model_options()
            need(options, "请先设置模型计价", 409)
            need(body and all((key in ("image", "video", "resolution") and isinstance(value, str)) or
                              (key == "full_dynamic" and isinstance(value, bool)) for key, value in body.items()), "模型设置无效")
            settings = {**config.render_settings(data, options), **body}
            need(settings["image"] in options["image"] and settings["video"] in options["video"], "请选择列表内的模型")
            need(options["image"][settings["image"]]["available"] and options["video"][settings["video"]]["available"],
                 "所选模型未上线，暂不可用", 409)
            need(settings["resolution"] in options["video"][settings["video"]]["rates"], "视频模型不支持此分辨率")
            if dynamic_project(data) != settings["full_dynamic"]:
                data["export"] = None
            data["render_settings"] = settings
        elif action == "render-all-dynamic":
            need(dynamic_project(data) and data["script"], "请先开启全动态并完成剧本", 409)
            beats = [beat for beat in data["script"]["beats"] if not ready_clip(beat, True)]
            need(beats, "全动态镜头已完成", 409)
            return {"jobs": [enqueue_clip(connection, row, data, beat) for beat in beats]}
        elif action == "portrait":
            need(LIVE and os.getenv("ARK_API_KEY"), "方舟未配置", 409)
            name = text(body.get("name", ""), 60, True)
            if body.get("order"):
                order = text(body["order"], 100, True)
                need(re.fullmatch(r"cgt-[a-zA-Z0-9-]{8,90}", order), "请填写方舟原始视频任务编号")
                payload = {"asset_name": name, "import_order": order}
                amount = 0
            else:
                need(body.get("confirmed") is True, "请确认虚构角色定妆的费用", 409)
                options = render_model_options()
                need(options, "请先设置模型计价", 409)
                model = config.render_settings(data, options)["video"]
                rate = options["video"].get(model, {}).get("rates", {}).get("480p")
                need(rate is not None, "当前模型未开放 480p 定妆", 409)
                amount = options["local_clip_cents"] + 4 * rate
                payload = {"asset_name": name, "description": text(body.get("description", ""), 700, True),
                           "model": model, "resolution": "480p"}
            return {"job": enqueue(connection, row, "portrait", payload, amount)}
        elif action == "direction":
            data["direction"] = text(body.get("direction", ""))
            if "product_start" in body:
                data["product_start"] = product_slot(body["product_start"])
        elif action == "fact":
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
            payload = {"document": data, "trends": pool["data"] if pool else []}
            if body.get("narrative_job"):
                source = lookup(connection, jobs, (jobs.c.id == body["narrative_job"]) & (jobs.c.workspace == workspace)
                                & (jobs.c.project == project_id) & (jobs.c.kind == "script") & (jobs.c.state == "failed"))
                narrative = (source["result"] or {}).get("narrative") if source else None
                need(narrative, "此任务没有可用的故事草稿", 404)
                payload["narrative"] = narrative
            job = enqueue(connection, row, "script", payload, choose_price("script"))
            if data["script"]:
                data["refinements"] += 1
                save_project(connection, row, data)
            return {"job": job}
        elif action in {"edit", "frame", "approve", "approve-clip", "clip"}:
            beat = selected(data, body.get("id"))
            if action == "edit":
                for key in ("title", "description", "dialogue", "prompt", "motion", "hook"):
                    if key in body:
                        beat[key] = text(body[key])
                if "dynamic" in body:
                    need(isinstance(body["dynamic"], bool), "镜头模式无效")
                    beat["dynamic"] = body["dynamic"]
                if "frame_subject" in body:
                    need(body["frame_subject"] in ("", "scene", "character"), "首帧用途无效")
                    beat["frame_subject"] = body["frame_subject"]
                if "cloud_prompt" in body:
                    beat["cloud_prompt"] = text(body["cloud_prompt"], 1200)
                if "asset_ids" in body:
                    refs = body["asset_ids"]
                    need(isinstance(refs, list) and all(isinstance(ref, str) and any(a["id"] == ref for a in data["assets"]) for ref in refs),
                         "引用的素材不存在")
                    beat["asset_ids"] = refs
                script.validate_script(data["script"]["beats"], data["facts"])
                invalidate(data, beat)
            elif action == "frame":
                bound = [a for a in data["assets"] if a["id"] in beat["asset_ids"]]
                trusted = next((a for a in bound if a.get("trusted_until", 0) > now()), None) if not beat["product"] else None
                reference = next((a["file"] for a in bound if a["kind"] == "product"), None) if beat["product"] else (
                    (trusted or bound[0])["file"] if bound else None)
                need(not LIVE or beat["product"] or os.getenv("ARK_API_KEY"),
                     "此镜需要配置火山引擎图像模型", 409)
                need(not (LIVE and beat["product"] and not reference), "商品镜头需要绑定实拍素材", 409)
                payload = {"beat": beat, "version": data["version"], "reference": reference}
                rate = None
                if LIVE and not beat["product"]:
                    options = render_model_options()
                    need(options, "请先设置模型计价", 409)
                    model = config.render_settings(data, options)["image"]
                    rate = options["image"][model]["cents"]
                    if trusted:
                        payload.update(local_frame=True, trusted_until=trusted["trusted_until"])
                        rate = options["image"][config.REFERENCE_FRAME]["cents"]
                    elif model == config.CLOUD_FRAME and beat.get("frame_subject") == "scene":
                        need(not beat.get("character_ids") and not any(a["kind"] in {"character", "product"} for a in bound),
                             "免费生图仅用于无人物场景或道具")
                        prompt = text(beat.get("cloud_prompt", ""), 1200, True)
                        fingerprint = digest("flux-schnell-frame-v1\n" + prompt)
                        payload.update(cloud_prompt=prompt, cloud_seed=int(fingerprint[:8], 16) & 0x7FFFFFFF or 1,
                                       cloud_file=fingerprint[:32] + ".jpg", model=config.CLOUD_MODEL)
                        return {"job": enqueue(connection, row, "frame", payload, 0)}
                    elif model in (config.REFERENCE_FRAME, config.CLOUD_FRAME):
                        need(reference, "请先上传参考图，在编辑分镜里勾选该素材，再生成首帧", 409)
                        payload["local_frame"] = True
                        rate = options["image"][config.REFERENCE_FRAME]["cents"]
                    else:
                        payload["model"] = model
                        payload["visual_context"] = script.visual_context(data["script"], beat)
                        if model == config.SEEDREAM_4:
                            payload["size"] = "1080x1920"
                        elif model in config.IMAGE_MODELS:
                            payload["size"] = "2K"
                return {"job": enqueue(connection, row, "frame", payload, choose_price("frame", beat, rate=rate))}
            elif action == "approve":
                need(beat.get("frame"), "需要先生成首帧", 409)
                beat["approved"] = True
            elif action == "approve-clip":
                need(dynamic_project(data) and ready_clip(beat, True) and body.get("clip") == beat["clip"],
                     "镜头已变更或没有可审核的动态片段", 409)
                beat["clip_reviewed"] = True
            else:
                return {"job": enqueue_clip(connection, row, data, beat)}
        elif action == "export":
            need(data["script"], "请先生成剧本", 409)
            beats = data["script"]["beats"]
            script.validate_script(beats, data["facts"])
            full = dynamic_project(data)
            if full:
                need(not any(j["kind"] in {"frame", "clip"} and j["state"] in {"queued", "running"}
                             for j in job_records(connection, workspace, project_id)), "请等待正在处理的首帧和片段", 409)
            need(all(ready_clip(b, full) and (not full or b.get("clip_reviewed") is True) for b in beats),
                 "请完成每个镜头并审核所需的动态片段", 409)
            payload = {"beats": beats, "version": data["version"], "full_dynamic": full, "subtitles": not full}
            return {"job": enqueue(connection, row, "export", payload, choose_price("export"))}
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
        elif action in {"resume", "settle", "resolve-cloud", "resolve-script"}:
            record = lookup(connection, jobs, (jobs.c.id == body.get("job")) & (jobs.c.workspace == workspace) & (jobs.c.project == project_id), True)
            need(record is not None, "任务不存在", 404)
            if action == "resume":
                need(record["state"] == "uncertain" and record["result"].get("order"), "此任务没有可查询的原订单", 409)
                connection.execute(jobs.update().where(jobs.c.id == record["id"]).values(state="queued", updated=now()))
            elif action == "resolve-script":
                need(record["kind"] == "script" and record["state"] == "uncertain" and not record["result"].get("order"),
                     "此任务无需解除阻塞", 409)
                connection.execute(jobs.update().where(jobs.c.id == record["id"]).values(state="failed", updated=now()))
            elif action == "resolve-cloud":
                need(record["state"] == "uncertain" and record["payload"].get("cloud_prompt"), "该任务不需要核对", 409)
                need(body.get("confirmed") is True, "请先核对免费生图结果", 409)
                connection.execute(jobs.update().where(jobs.c.id == record["id"]).values(state="failed", updated=now()))
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
def get_trends(access: Access):
    workspace = access.workspace
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
def add_trend(body: dict, access: Access):
    workspace, admin = access.workspace, access.admin
    need(admin, "仅管理员可维护热梗", 403)
    if "url" in body:
        entries = assets.approved_source(text(body["url"], 1000, True), "JINGXU_TREND_SOURCES")
    else:
        entries = [body]
    return {"count": save_trends(workspace, entries)}
