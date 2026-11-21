"""Exercise legacy data migration and workspace isolation against a temporary database."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient


def check(root):
    os.environ.update(JINGXU_DATA=root, DATABASE_URL=f"sqlite:///{Path(root, 'test.sqlite3').as_posix()}",
                      JINGXU_PROVIDER="demo", JINGXU_DEMO="0", JINGXU_WORKSPACE_CODE="integration-test-only",
                      JINGXU_OPERATOR_EMAILS="", JINGXU_SECURE_COOKIE="0", JINGXU_DOWNLOAD_KEY="")
    from api.main import app
    from api.store import engine, init, now, password_hash, projects, schema, users, workspaces, write

    owner_email = "owner@example.test"
    password = "integration-test-password"
    legacy = "1" * 32
    legacy_project = "2" * 32
    schema.create_all(engine, tables=[workspaces, users, projects])
    with write() as connection:
        connection.execute(workspaces.insert().values(id=legacy, name="原工作室", quota=4400))
        connection.execute(users.insert().values(email=owner_email, password=password_hash(password), workspace=legacy, admin=True))
        connection.execute(projects.insert().values(id=legacy_project, workspace=legacy, updated=now(),
                                                   data={"name": "迁移前项目", "export": None, "script": None}))

    def ok(response):
        assert response.is_success, response.text
        return response.json()

    with TestClient(app) as owner, TestClient(app) as member, TestClient(app) as other:
        init()
        ok(owner.post("/api/login", json={"email": owner_email, "password": password}))
        original = ok(owner.get("/api/session"))
        assert original["workspace"] == legacy and original["role"] == "owner" and original["canCreateWorkspace"]
        assert ok(owner.get("/api/workspace"))["quota"] == 4400
        assert ok(owner.get("/api/projects"))[0]["id"] == legacy_project

        new = ok(owner.post("/api/workspaces", json={"name": "第二工作室"}))["id"]
        scope = {"workspace": new}
        selected = ok(owner.get("/api/session", params=scope))
        assert selected["workspace"] == new and {row["id"] for row in selected["workspaces"]} == {legacy, new}
        assert ok(owner.get("/api/workspace", params=scope))["quota"] == 0
        assert ok(owner.get("/api/projects", params=scope)) == []
        assert ok(owner.get("/api/session"))["workspace"] == legacy

        project = ok(owner.post("/api/projects", params=scope, json={"name": "新空间项目", "product": "测试商品"}))["id"]
        route = f"/api/projects/{project}"
        assert owner.get(route).status_code == 404
        assert ok(owner.get(route, params=scope))["id"] == project
        assert [row["id"] for row in ok(owner.get("/api/projects"))] == [legacy_project]

        old_code = ok(owner.post("/api/workspace/invites"))["code"]
        ok(member.post("/api/register", json={"email": "member@example.test", "password": password, "code": old_code}))
        assert not ok(member.get("/api/session"))["canCreateWorkspace"]
        assert member.post("/api/workspaces", json={"name": "无权创建"}).status_code == 403
        assert member.get("/api/projects", params=scope).status_code == 403
        assert member.get(route).status_code == 404
        assert member.get(route + "/events", params=scope).status_code == 403
        assert member.get(route + "/download", params=scope).status_code == 403
        assert member.get(route + "/media/" + "a" * 32 + ".jpg", params=scope).status_code == 403
        assert member.post(route + "/actions/script", params=scope, json={}).status_code == 403
        assert owner.patch(f"/api/operations/{new}/quota", json={"cents": 1000}).status_code == 403

        code = ok(owner.post("/api/workspace/invites", params=scope))["code"]
        ok(member.post("/api/workspaces/join", json={"code": code}))
        info = ok(member.get("/api/session", params=scope))
        assert info["role"] == "member" and not info["admin"] and not info["canCreateWorkspace"]
        assert ok(member.get(route, params=scope))["id"] == project
        assert member.get("/api/workspace", params=scope).status_code == 403
        assert member.post("/api/workspace/invites", params=scope).status_code == 403
        assert member.post("/api/workspaces/join", json={"code": code}).status_code == 403
        assert other.get("/api/session", params=scope).status_code == 401

    engine.dispose()


if __name__ == "__main__":
    with TemporaryDirectory() as root:
        check(root)
    print("PASS legacy migration, multiple workspaces, scoped projects and media, and invitation roles")
