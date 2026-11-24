"""Verify managed onboarding and server-side spending controls without calling suppliers."""
import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

with TemporaryDirectory() as root:
    os.environ.update(
        JINGXU_DATA=root, DATABASE_URL=f"sqlite:///{Path(root, 'managed.sqlite3')}",
        JINGXU_MANAGED_LIVE="1", JINGXU_INVITE_PREVIEW="0", JINGXU_DEMO="0",
        JINGXU_WORKSPACE_CODE="old-reusable-code", JINGXU_SECURE_COOKIE="0",
        DEEPSEEK_API_KEY="fixture", ARK_API_KEY="fixture",
        ARK_IMAGE_MODEL="doubao-seedream-4-0-20260415", ARK_VIDEO_MODEL="doubao-seedance-2-0-mini-260615",
        JINGXU_MEDIA_HOSTS="cdn.example.test",
        JINGXU_PRICES_CENTS=json.dumps(dict.fromkeys(
            ("script", "frame", "product_frame", "static_clip", "dynamic_clip_sec", "export"), 10)),
    )
    from api import live_admin, worker
    from api.main import app
    from api.store import live_workspaces, write

    def admin(*args):
        output = io.StringIO()
        with patch("sys.argv", ["live_admin", *args]), redirect_stdout(output):
            live_admin.main()
        return output.getvalue().strip()

    with TestClient(app) as client, TestClient(app) as visitor:
        account = {"email": "owner@example.test", "password": "local-managed-password"}
        assert visitor.post("/api/register", json={**account, "code": "old-reusable-code"}).status_code == 403
        code = admin("issue", "--cents", "9")
        assert client.post("/api/register", json={**account, "code": code}).is_success
        assert visitor.post("/api/register", json={**account, "email": "other@example.test", "code": code}).status_code == 403
        session = client.get("/api/session").json()
        assert session["live"] and session["managedLive"] and not session["invitePreview"]
        assert client.post("/api/workspace/invites").status_code == 403
        assert client.post("/api/workspaces", json={"name": "Another"}).status_code == 403
        assert client.get("/api/workspace").json()["quota"] == 9
        project = client.post("/api/projects", json={"name": "杯子", "product": "陶瓷杯"}).json()["id"]
        url = f"/api/projects/{project}"
        fact = client.get(url).json()["facts"][0]["id"]
        assert client.post(url + "/actions/confirm", json={"id": fact}).is_success
        assert client.post(url + "/actions/script", json={}).status_code == 409
        workspace = session["workspace"]
        with write() as connection:
            connection.execute(live_workspaces.delete().where(live_workspaces.c.workspace == workspace))
        assert client.post(url + "/actions/script", json={}).status_code == 403
        admin("quota", workspace, "--cents", "10")
        job = client.post(url + "/actions/script", json={}).json()["job"]
        assert client.get("/api/workspace").json()["committed"] == 10
        queued = worker.next_job()
        assert queued["id"] == job and queued["payload"]["live"] is True
        with patch.object(worker.script, "draft", return_value={"beats": [], "provider": {"request_id": "fixture"}}) as draft:
            worker.process(queued)
            draft.assert_called_once()
        assert client.post(url + "/actions/settle", json={"job": job, "cents": 0}).status_code == 409
        admin("settle", job, "--cents", "6")
        assert client.get("/api/workspace").json()["spent"] == 6
print("PASS managed invite, old workspace deny, allowance cap and user settlement restriction")
