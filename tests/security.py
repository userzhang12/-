"""Run with an isolated JINGXU_DATA directory and PYTHONPATH=."""
import os

from fastapi.testclient import TestClient

os.environ["JINGXU_PUBLIC_HOST"] = "jingxu.example.test"
os.environ["JINGXU_TRUST_PROXY"] = "0"

from api.main import app
from api import security


with TestClient(app) as client:
    base = 1200
    security.now = lambda: base + 1
    login = {"email": "owner@example.test", "password": "test-password"}
    route = "/api/login"
    assert client.post(route, json=login, headers={"Origin": "https://another.example.test"}).status_code == 403
    assert client.post(route, json=login, headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    trusted = {"Origin": "https://jingxu.example.test"}
    for _ in range(12):
        assert client.post(route, json=login, headers=trusted).status_code == 401
    limited = client.post(route, json=login, headers={**trusted, "X-Jingxu-Client-IP": "198.51.100.2"})
    assert limited.status_code == 429 and limited.headers["Retry-After"] == "59"
    security.now = lambda: base + 61
    assert client.post(route, json=login, headers=trusted).status_code == 401

    for index in range(30):
        payload = {**login, "email": f"other-{index}@example.test"}
        response = client.post(route, json=payload, headers={"X-Jingxu-Client-IP": f"198.51.100.{index + 1}"})
        assert response.status_code == (429 if index == 29 else 401), response.text

print("PASS cross-origin writes blocked, per-account and per-IP limits, reset and proxy spoof isolation")
