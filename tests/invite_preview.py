"""Verify the preview signup cap and separation against an isolated database."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient


def check(root):
    os.environ.update(JINGXU_DATA=root, DATABASE_URL=f"sqlite:///{Path(root, 'preview.sqlite3')}",
                      JINGXU_INVITE_PREVIEW="1", JINGXU_WORKSPACE_CODE="previous-admin-code",
                      JINGXU_DEMO="1", JINGXU_SECURE_COOKIE="0")
    from api import config, preview
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
        assert preview.revoke_unused() == 8
        assert signup(anonymous, "third@example.test", codes[2]).status_code == 403
        assert len(preview.issue(8)) == 8


if __name__ == "__main__":
    with TemporaryDirectory() as directory:
        check(directory)
    print("PASS preview caps, single-use invites, revocation and workspace isolation")
