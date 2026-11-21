"""Verify workspace boundaries, invitation roles and reservation races on PostgreSQL."""
import os
from concurrent.futures import ThreadPoolExecutor

import httpx

from api.store import now, workspaces, write

origin = os.getenv("JINGXU_TEST_URL", "http://127.0.0.1:8001")
seed = str(int(now() * 1000))
password = "local-isolation-test-only"


def register(nickname, code):
    client = httpx.Client(base_url=origin, timeout=20)
    response = client.post("/api/register", json={
        "email": f"{nickname}-{seed}@example.test", "password": password, "code": code,
    })
    assert response.is_success, response.text
    return client


first = register("owner", os.environ["JINGXU_WORKSPACE_CODE"])
second = register("outsider", os.environ["JINGXU_WORKSPACE_CODE"])
workspace = first.get("/api/session").json()["workspace"]
code = first.post("/api/workspace/invites").json()["code"]
member = register("member", code)
assert member.post("/api/workspace/invites").status_code == 403
assert member.get("/api/workspace").status_code == 403

def project(name):
    result = first.post("/api/projects", json={"name": name, "product": "容量：300 mL"}).json()
    root = f"/api/projects/{result['id']}"
    fact = first.get(root).json()["facts"][0]
    assert first.post(root + "/actions/confirm", json={"id": fact["id"]}).is_success
    return root


targets = [project("并发测试 1"), project("并发测试 2")]
assert member.get(targets[0]).is_success
assert second.get(targets[0]).status_code == 404
assert second.post(targets[0] + "/actions/script", json={}).status_code == 404
with write() as connection:
    connection.execute(workspaces.update().where(workspaces.c.id == workspace).values(quota=10))


def submit(url):
    return first.post(url + "/actions/script", json={})


with ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(submit, targets))
assert sorted(result.status_code for result in results) == [200, 409], [x.text for x in results]
assert first.get("/api/workspace").json()["spent"] + first.get("/api/workspace").json()["committed"] == 10
print("PASS workspace isolation, one-use invitation roles and concurrent quota reservation")
