"""Verify the preview signup cap and separation against an isolated database."""

import io
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image


def check(root):
    os.environ.update(JINGXU_DATA=root, DATABASE_URL=f"sqlite:///{Path(root, 'preview.sqlite3')}",
                      JINGXU_INVITE_PREVIEW="1", JINGXU_WORKSPACE_CODE="previous-admin-code",
                      JINGXU_DEMO="1", JINGXU_SECURE_COOKIE="0")
    from api import config, preview
    from api import main
    from api.main import app

    def signup(client, email, code):
        return client.post("/api/register", json={
            "email": email, "password": "integration-password", "code": code, "workspace": "Preview",
        })

    for setting in ("DEEPSEEK_API_KEY", "ARK_API_KEY", "JINGXU_TTS_URL", "S3_BUCKET",
                    "JINGXU_CLOUDFLARE_API_TOKEN", "JINGXU_PRODUCT_SOURCES"):
        with patch.dict(os.environ, {setting: "test"}):
            try:
                config.check_invite_preview()
            except ValueError as error:
                assert setting in str(error)
            else:
                raise AssertionError(f"Preview allowed external service {setting}")

    with TestClient(app) as first, TestClient(app) as second, TestClient(app) as anonymous:
        codes = preview.issue(10)
        try:
            preview.issue(1)
        except ValueError:
            pass
        else:
            raise AssertionError("Preview allowed an eleventh invite")

        assert anonymous.get("/api/session").status_code == 401
        assert signup(anonymous, "third@example.test", "previous-admin-code").status_code == 403
        assert signup(first, "first@example.test", codes[0]).is_success
        assert signup(anonymous, "third@example.test", codes[0]).status_code == 403
        assert signup(second, "second@example.test", codes[1]).is_success
        first_session, second_session = [client.get("/api/session").json() for client in (first, second)]
        assert first_session["workspace"] != second_session["workspace"]
        assert first_session["invitePreview"] and not first_session["live"] and not first_session["canCreateWorkspace"]
        assert first.get("/api/workspace").json()["quota"] == 5000
        assert first.post("/api/workspace/invites").status_code == 403
        assert first.post("/api/workspaces", json={"name": "Other"}).status_code == 403
        assert first.post("/api/workspaces/join", json={"code": codes[2]}).status_code == 403
        assert second.get("/api/projects", params={"workspace": first_session["workspace"]}).status_code == 403
        draft = {"name": "Demo", "product": "商品：水杯"}
        assert first.post("/api/projects", json={**draft, "product": "\n".join(["水杯"] * 21)}).status_code == 422
        with patch.object(main, "PREVIEW_PROJECT_LIMIT", 1):
            created = first.post("/api/projects", json=draft)
            assert created.is_success
            assert first.post("/api/projects", json=draft).status_code == 409
            assert second.post("/api/projects", json=draft).is_success
        project = created.json()["id"]
        upload = f"/api/projects/{project}/assets"
        image = io.BytesIO()
        Image.new("RGB", (8, 8), "white").save(image, "PNG")
        file = {"file": ("cup.png", image.getvalue(), "image/png")}
        with patch.object(main, "PREVIEW_UPLOAD_BYTES", 1):
            assert first.post(upload, files=file).status_code == 409
            assert not list(Path(root, "media", project).glob("*"))
        with patch.object(main, "PREVIEW_ASSET_LIMIT", 1):
            assert first.post(upload, files=file).is_success
            assert first.post(upload, files=file).status_code == 409
            assert len(list(Path(root, "media", project).glob("*"))) == 2
        detail = first.get(f"/api/projects/{project}").json()
        assert first.post(f"/api/projects/{project}/actions/confirm", json={"id": detail["facts"][0]["id"]}).is_success
        assert first.post(f"/api/projects/{project}/actions/script", json={}).is_success
        assert first.get("/api/tasks").json()[0]["project"] == project
        assert second.get("/api/tasks").json() == []
        with TestClient(app) as other_device:
            login = {"email": "first@example.test", "password": "integration-password"}
            assert other_device.post("/api/login", json=login).is_success
            draft_password = {"current": "wrong-password", "password": "updated-password"}
            assert first.post("/api/account/password", json=draft_password).status_code == 422
            assert other_device.get("/api/session").is_success
            draft_password["current"] = login["password"]
            assert first.post("/api/account/password", json=draft_password).is_success
            assert first.get("/api/session").is_success
            assert other_device.get("/api/session").status_code == 401
            assert other_device.post("/api/login", json=login).status_code == 401
            login["password"] = draft_password["password"]
            assert other_device.post("/api/login", json=login).is_success
        requests = "/api/account/data-requests"
        assert anonymous.get(requests).status_code == 401
        assert second.post(requests, json={"kind": "project-delete", "project": project}).status_code == 404
        account_request = {"kind": "account-export"}
        assert first.post(requests, json=account_request).status_code == 201
        assert first.post(requests, json=account_request).status_code == 409
        matched = first.post(requests, json={"kind": "project-delete", "project": project})
        assert matched.status_code == 201
        assert first.get(f"/api/projects/{project}").is_success
        assert len(first.get(requests).json()) == 2
        assert second.get(requests).json() == []
        from api.data_requests import main as process_requests
        with patch("sys.argv", ["data_requests", "close", matched.json()["id"], "declined"]):
            process_requests()
        assert first.get(requests).json()[0]["state"] == "declined"
        assert preview.revoke_unused() == 8
        assert signup(anonymous, "third@example.test", codes[2]).status_code == 403
        assert len(preview.issue(8)) == 8


if __name__ == "__main__":
    with TemporaryDirectory() as directory:
        check(directory)
    print("PASS preview caps, single-use invites, revocation and workspace isolation")
