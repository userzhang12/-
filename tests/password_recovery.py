"""Exercise email recovery against an isolated database without contacting a relay."""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient


with TemporaryDirectory() as directory:
    os.environ.update(JINGXU_DATA=directory, DATABASE_URL=f"sqlite:///{Path(directory, 'recovery.sqlite3')}",
                      JINGXU_INVITE_PREVIEW="1", JINGXU_SECURE_COOKIE="0")
    from api import preview, recovery
    from api.main import app
    from api.store import engine, password_resets

    with TestClient(app) as account, TestClient(app) as visitor:
        email, previous, updated = "test@example.test", "previous-test-password", "updated-test-password"
        endpoint = "/api/account/recovery"
        assert visitor.get(endpoint).json() == {"enabled": False}
        invitation = preview.issue(1)[0]
        assert account.post("/api/register", json={"email": email, "password": previous, "code": invitation}).is_success
        with patch.dict(os.environ, {"JINGXU_SMTP_HOST": "smtp.example.test", "JINGXU_SMTP_FROM": "help@example.test"}):
            with patch.object(recovery, "send") as send, patch.object(recovery, "now") as clock:
                assert visitor.get(endpoint).json() == {"enabled": True}
                clock.return_value = 10_000
                known = visitor.post(endpoint + "/request", json={"email": email})
                unknown = visitor.post(endpoint + "/request", json={"email": "unknown@example.test"})
                assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
                assert send.call_count == 1
                first = send.call_args.args[2]
                with engine.connect() as connection:
                    saved = connection.execute(password_resets.select()).one()
                    assert saved.code != first and len(saved.code) == 64
                visitor.post(endpoint + "/request", json={"email": email})
                assert send.call_count == 1
                clock.return_value += recovery.CODE_LIFETIME
                request = {"email": email, "code": first, "password": updated}
                assert visitor.post(endpoint + "/reset", json=request).status_code == 422
                visitor.post(endpoint + "/request", json={"email": email})
                assert send.call_count == 2
                second = send.call_args.args[2]
                assert second != first
                assert visitor.post(endpoint + "/reset", json={**request, "code": second}).is_success
                assert visitor.post(endpoint + "/reset", json={**request, "code": second}).status_code == 422
                assert account.get("/api/session").status_code == 401
                assert account.post("/api/login", json={"email": email, "password": previous}).status_code == 401
                assert account.post("/api/login", json={"email": email, "password": updated}).is_success

print("PASS generic responses, hashed codes, resend delay, expiration, one-time redemption and session revocation")
