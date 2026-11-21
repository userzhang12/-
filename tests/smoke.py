"""Run against an isolated API and Worker in demo mode."""
import io
import wave
from array import array
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

import httpx
from PIL import Image

base = os.getenv("JINGXU_TEST_URL", "http://127.0.0.1:8000")
client = httpx.Client(base_url=base, timeout=30)
assert client.get("/api/session").json()["live"] is False
assert client.post("/api/voice/preview", json={"text": "？！"}).status_code == 422
preview = client.post("/api/voice/preview", json={"text": "这是一段普通话配音。"})
assert preview.is_success and preview.headers["content-type"] == "audio/wav"
with wave.open(io.BytesIO(preview.content)) as spoken:
    assert spoken.getnframes() / spoken.getframerate() > 1
    assert max(map(abs, array("h", spoken.readframes(spoken.getnframes())))) > 500


def checked(response):
    assert response.is_success, (response.status_code, response.text)
    return response.json()


project = checked(client.post("/api/projects", json={"name": "验收样片", "product": "示例包装容量 300 mL"}))["id"]
root = f"/api/projects/{project}"


def action(name, **body):
    return checked(client.post(f"{root}/actions/{name}", json=body))


def snapshot():
    return checked(client.get(root))


def wait(ids):
    end = time.monotonic() + 240
    while time.monotonic() < end:
        data = snapshot()
        states = {job["id"]: job["state"] for job in data["jobs"] if job["id"] in ids}
        assert not set(states.values()) & {"failed", "uncertain"}, data["jobs"]
        if len(states) == len(ids) and set(states.values()) == {"done"}:
            return data
        time.sleep(1)
    raise AssertionError(states)


assert client.post(f"{root}/actions/script", json={}).status_code == 409
fact = snapshot()["facts"][0]
action("confirm", id=fact["id"])
raw = io.BytesIO()
Image.new("RGB", (260, 320), (234, 213, 182)).save(raw, "PNG")
asset = checked(client.post(f"{root}/assets", files={"file": ("product.png", raw.getvalue())}, data={"view": "正面"}))
assert client.get(f"{root}/media/{asset['cutout']}").is_success
data = wait([action("script")["job"]])
beats = data["script"]["beats"]
assert len(beats) == 12 and beats[-1]["end"] == 120 and beats[4]["asset_ids"] == [asset["id"]]
assert client.post(f"{root}/actions/clip", json={"id": "01"}).status_code == 409
frames = [action("frame", id=b["id"])["job"] for b in beats]
wait(frames)
for b in beats:
    action("approve", id=b["id"])
clips = [action("clip", id=b["id"])["job"] for b in beats]
data = wait(clips)
second_clip = data["script"]["beats"][1]["clip"]
action("edit", id="01", dialogue="等一下，这是谁放在这儿的？")
wait([action("frame", id="01")["job"]])
action("approve", id="01")
data = wait([action("clip", id="01")["job"]])
assert data["script"]["beats"][1]["clip"] == second_clip
data = wait([action("export")["job"]])
assert data["export"] and 0 < data["spent"] < 5000 and not data["committed"]
with tempfile.TemporaryDirectory() as folder:
    target = Path(folder) / "final.mp4"
    url = checked(client.get(f"{root}/download"))["url"]
    with client.stream("GET", url) as response, target.open("wb") as output:
        assert response.is_success
        for chunk in response.iter_bytes():
            output.write(chunk)
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(target)]))
    video = next(stream for stream in probe["streams"] if stream["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert abs(float(probe["format"]["duration"]) - 120) < .05
    assert any(stream["codec_type"] == "audio" for stream in probe["streams"])
    first = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(target), "-t", "4", "-vn", "-f", "s16le", "-"])
    assert max(map(abs, array("h", first))) > 500
    opening = data["script"]["beats"][0]
    preview = client.post("/api/voice/preview", json={"text": opening["dialogue"]})
    with wave.open(io.BytesIO(preview.content)) as spoken:
        seconds = spoken.getnframes() / spoken.getframerate()
    assert abs(seconds - opening["caption"]) < 1 / 25
csv = f"version,date,impressions,retained_3s,mid_views,clicks,orders\n{data['export']},2026-11-21,100,60,40,12,2"
action("metrics", csv=csv)
action("metrics", csv=csv)
assert len(snapshot()["metrics"]) == 1
short_row = csv + f"\n{data['export']},2026-11-22,100"
bad = client.post(f"{root}/actions/metrics", json={"csv": short_row})
assert bad.status_code == 422 and "第 3 行" in bad.json()["detail"] and "orders" in bad.json()["detail"], bad.text
assert len(snapshot()["metrics"]) == 1
bad_date = csv.replace("2026-11-21", "2026-99-99")
bad = client.post(f"{root}/actions/metrics", json={"csv": bad_date})
assert bad.status_code == 422 and "第 2 行" in bad.json()["detail"] and "date" in bad.json()["detail"], bad.text

print(f"PASS {project}: 1080x1920, {probe['format']['duration']} s, mock cost {data['spent']} cents, single-shot edit, deduplicated metrics")
