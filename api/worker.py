import logging
import os
import time
from contextlib import contextmanager
from threading import Event, Thread
from datetime import date

from sqlalchemy import select

from . import assets, config, media, script
from .store import engine, init, jobs, lookup, now, project_row, save_project, trends, workspaces, write

log = logging.getLogger("jingxu.worker")
LEASE = 120


def next_job():
    with write() as connection:
        stale = select(jobs).where(jobs.c.state == "running", jobs.c.updated < now() - LEASE).with_for_update(skip_locked=True)
        for job in connection.execute(stale).mappings():
            result = job["result"] or {}
            safe = not job["payload"]["live"] or result.get("order")
            connection.execute(jobs.update().where(jobs.c.id == job["id"]).values(
                state="queued" if safe else "uncertain", updated=now(),
                result={**result, "message": "工作进程中断，需核对供应商订单"}))
        query = select(jobs).where(jobs.c.state == "queued").order_by(jobs.c.created).limit(1).with_for_update(skip_locked=True)
        job = connection.execute(query).mappings().first()
        if job:
            connection.execute(jobs.update().where(jobs.c.id == job["id"]).values(state="running", updated=now()))
        return job


def apply_result(connection, job, result):
    row = project_row(connection, job["workspace"], job["project"], True)
    data = row["data"]
    payload = job["payload"]
    if job["kind"] == "script" and not payload.get("beat"):
        data["script"] = result
        data["version"] += 1
        data["export"] = None
    elif data["version"] != payload["version"]:
        return
    elif job["kind"] == "script":
        proposed = result["beat"]
        index = next(i for i, beat in enumerate(data["script"]["beats"]) if beat["id"] == proposed["id"])
        if data["script"]["beats"][index]["revision"] != payload["beat"]["revision"]:
            return
        data["script"]["beats"][index] = proposed
        data["export"] = None
    elif job["kind"] == "export":
        if any(a.get("clip") != b.get("clip") for a, b in zip(data["script"]["beats"], payload["beats"])):
            return
        data["export"] = result["file"]
    else:
        original = payload["beat"]
        beat = next(b for b in data["script"]["beats"] if b["id"] == original["id"])
        if beat["revision"] != original["revision"]:
            return
        if job["kind"] == "frame":
            beat.update(frame=result["file"], approved=False)
            beat.pop("clip", None)
        elif beat.get("frame") == original.get("frame") and beat["approved"]:
            beat.update(clip=result["file"], caption=result["caption"])
        else:
            return
        data["export"] = None
    save_project(connection, row, data)


def complete(job, state, result):
    with write() as connection:
        row = project_row(connection, job["workspace"], job["project"], True)
        if not row:
            return
        lookup(connection, workspaces, workspaces.c.id == job["workspace"], True)
        current = lookup(connection, jobs, jobs.c.id == job["id"], True)
        if current["state"] != "running":
            return
        if state == "done":
            apply_result(connection, job, result)
        live = job["payload"]["live"]
        connection.execute(jobs.update().where(jobs.c.id == job["id"]).values(
            state=state, result={**(current["result"] or {}), **result}, updated=now(),
            reserved=current["reserved"] if live else 0,
            spent=current["reserved"] if not live and state == "done" else 0))


@contextmanager
def heartbeat(job_id):
    stop = Event()

    def touch():
        while not stop.wait(20):
            try:
                with write() as connection:
                    connection.execute(jobs.update().where(jobs.c.id == job_id, jobs.c.state == "running").values(updated=now()))
            except Exception:
                log.exception("failed to renew job lease (%s)", job_id)

    thread = Thread(target=touch, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join()


def process(job):
    handlers = {"frame": media.frame, "clip": media.clip, "export": media.compose}
    try:
        payload = job["payload"]
        if payload["live"] != config.live_enabled():
            raise ValueError("任务计费模式与 Worker 配置不一致，未调用供应商")
        with heartbeat(job["id"]):
            if job["kind"] == "script":
                result = script.draft(payload["document"], payload["trends"], (payload.get("beat") or {}).get("id"), payload.get("notes", ""))
            else:
                result = handlers[job["kind"]](job)
        complete(job, "done", result)
    except Exception as error:
        log.warning("%s %s failed (%s)", job["kind"], job["id"], type(error).__name__)
        live = job["payload"]["live"]
        known_error = isinstance(error, (ValueError, media.UnknownOrder))
        message = str(error)[:250] if known_error else "生成失败，请检查供应商状态及 Worker 日志"
        complete(job, "uncertain" if live else "failed", {"message": message})


def refresh_trends():
    from .main import save_trends
    import json
    sources = json.loads(os.getenv("JINGXU_TREND_SOURCES", "{}"))
    with engine.connect() as connection:
        workspaces_ids = list(connection.execute(select(workspaces.c.id)).scalars())
    for source in sources:
        entries = assets.approved_source(source, "JINGXU_TREND_SOURCES")
        for workspace in workspaces_ids:
            save_trends(workspace, entries)


def main():
    logging.basicConfig(level=logging.INFO)
    init()
    last_refresh = 0
    while True:
        if now() - last_refresh > 3600:
            try:
                refresh_trends()
            except Exception as error:
                log.warning("趋势同步失败 (%s)", type(error).__name__)
            last_refresh = now()
        job = next_job()
        if job:
            process(job)
        else:
            time.sleep(.5)


if __name__ == "__main__":
    main()
