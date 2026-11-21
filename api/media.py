import base64
import json
import math
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageEnhance, ImageOps
from sqlalchemy import select

from .assets import path_for, publish_file, restore_file
from .store import jobs, now, write
from . import voice

SAMPLE = Path(__file__).parent / "sample.jpg"
FRAME_SIZE = (1080, 1920)


class UnknownOrder(Exception):
    pass


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=360)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-600:])
    return result.stdout


def ffmpeg(*args):
    return run("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *map(str, args))


def provider():
    key = os.getenv("ARK_API_KEY")
    if not key:
        return None
    return httpx.Client(base_url=os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").rstrip("/") + "/",
                        headers={"Authorization": f"Bearer {key}"}, timeout=40)


def image_url(path):
    return "data:image/jpeg;base64," + base64.b64encode(path.read_bytes()).decode()


def fetch_media(url, limit=150 * 1024 * 1024):
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("供应商未返回有效媒体地址")
    with httpx.stream("GET", url, timeout=60, follow_redirects=False) as response:
        response.raise_for_status()
        result = bytearray()
        for chunk in response.iter_bytes():
            result.extend(chunk)
            if len(result) > limit:
                raise ValueError("供应商媒体文件超出大小限制")
    return result


def frame(job):
    inputs = job["payload"]
    target = path_for(job["project"], f'{job["id"]}.jpg')
    target.parent.mkdir(parents=True, exist_ok=True)
    reference = inputs.get("reference")
    local = restore_file(job["project"], path_for(job["project"], reference)) if reference else None
    beat = inputs["beat"]
    if (beat["product"] and local) or not os.getenv("ARK_API_KEY"):
        with Image.open(local or SAMPLE) as original:
            rgb = original.convert("RGB")
            if local:
                background = ImageEnhance.Brightness(ImageOps.fit(rgb, FRAME_SIZE)).enhance(.35)
                inset = ImageOps.contain(rgb, (960, 1300))
                background.paste(inset, ((1080 - inset.width)//2, (1920 - inset.height)//2))
            else:
                background = ImageOps.fit(rgb, FRAME_SIZE, centering=(.61, .5))
            background.save(target, quality=88)
    else:
        model = os.environ["ARK_IMAGE_MODEL"]
        with provider() as client:
            body = {"model": model, "prompt": beat["prompt"] + "，9:16 竖屏",
                    "size": os.getenv("ARK_IMAGE_SIZE", "2K"), "response_format": "b64_json", "watermark": False}
            if local:
                ref = target.with_suffix(".reference.jpg")
                with Image.open(local) as original:
                    original.convert("RGB").save(ref, quality=85)
                body["image"] = image_url(ref)
            response = client.post("images/generations", json=body)
            response.raise_for_status()
            item = response.json()["data"][0]
            source = target.with_suffix(".source")
            source.write_bytes(base64.b64decode(item["b64_json"]) if item.get("b64_json") else fetch_media(item["url"]))
            with Image.open(source) as original:
                ImageOps.fit(original.convert("RGB"), FRAME_SIZE).save(target, quality=88)
            source.unlink()
    publish_file(job["project"], target)
    return {"file": target.name}


def save_order(job_id, order):
    with write() as connection:
        connection.execute(jobs.update().where(jobs.c.id == job_id).values(result={"order": order}, updated=now()))


def clip(job):
    data = job["payload"]
    beat = data["beat"]
    project = job["project"]
    still = restore_file(project, path_for(project, beat["frame"]))
    target = path_for(project, f'{job["id"]}.mp4')
    segment = beat["end"] - beat["start"]
    moving = beat["dynamic"] and not beat["product"] and bool(os.getenv("ARK_API_KEY"))
    input_file = still
    if moving:
        with provider() as client:
            order = (job["result"] or {}).get("order")
            if not order:
                try:
                    response = client.post("contents/generations/tasks", json={
                        "model": os.environ["ARK_VIDEO_MODEL"],
                        "content": [{"type": "text", "text": beat["motion"]},
                                    {"type": "image_url", "image_url": {"url": image_url(still)}}],
                        "duration": segment, "ratio": "9:16", "resolution": "720p", "watermark": False,
                    })
                    response.raise_for_status()
                    order = response.json()["id"]
                except (httpx.TransportError, KeyError, ValueError) as error:
                    raise UnknownOrder("供应商接单结果未知，已保留额度") from error
                save_order(job["id"], order)
            for _ in range(60):
                response = client.get(f"contents/generations/tasks/{order}")
                response.raise_for_status()
                info = response.json()
                status = info["status"]
                if status == "succeeded":
                    input_file = target.with_suffix(".source.mp4")
                    input_file.write_bytes(fetch_media(info["content"]["video_url"]))
                    break
                if status in {"failed", "expired", "cancelled", "canceled"}:
                    raise RuntimeError(f"供应商任务状态：{status}")
                time.sleep(4)
            else:
                raise UnknownOrder("供应商任务仍在运行，可查询原订单")
    else:
        input_file = still

    scale = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
    if moving:
        video_input = ["-i", input_file]
        vf = scale + ",fps=25,tpad=stop_mode=clone:stop_duration=10"
    else:
        video_input = ["-i", input_file]
        vf = scale + ",zoompan=z='min(zoom+0.00022,1.065)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=250:s=1080x1920:fps=25"
    with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
        audio = Path(temporary) / "voice.wav"
        dialogue = beat["dialogue"].strip()
        if dialogue:
            voice.render(dialogue, audio)
        audio_input = ["-i", audio] if audio.exists() else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        caption = min(segment, max(2, len(dialogue) / 5))
        if audio.exists():
            probe = json.loads(run("ffprobe", "-v", "error", "-select_streams", "a:0",
                                   "-show_entries", "stream=duration:format=duration", "-of", "json", str(audio)))
            streams = probe.get("streams", [])
            if not streams:
                raise ValueError("配音文件中没有可读取的音轨")
            duration = streams[0].get("duration") or probe.get("format", {}).get("duration")
            try:
                audio_duration = float(duration)
            except (TypeError, ValueError) as error:
                raise ValueError("无法测量配音的时长") from error
            if not math.isfinite(audio_duration) or audio_duration <= 0:
                raise ValueError("配音时长无效")
            if audio_duration > segment:
                raise ValueError("配音超过镜头时长，请缩短台词")
            caption = audio_duration
        ffmpeg(*video_input, *audio_input, "-map", "0:v:0", "-map", "1:a:0",
               "-vf", vf, "-af", "apad", "-t", segment, "-c:v", "libx264", "-pix_fmt", "yuv420p",
               "-threads", "2", "-preset", "ultrafast", "-c:a", "aac", "-ar", "48000", "-ac", "2", target)
    if moving:
        input_file.unlink(missing_ok=True)
    publish_file(project, target)
    return {"file": target.name, "caption": caption}


def timestamp(value):
    ms = round(value * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def compose(job):
    project = job["project"]
    beats = job["payload"]["beats"]
    target = path_for(project, f'{job["id"]}.mp4')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent) as temporary:
        directory = Path(temporary)
        clips = directory / "clips.txt"
        subtitles = directory / "captions.srt"
        relative = []
        lines = []
        for i, beat in enumerate(beats, 1):
            source = restore_file(project, path_for(project, beat["clip"]))
            link = directory / f"{i:02}.mp4"
            link.symlink_to(source)
            relative.append(f"file '{link.name}'")
            dialogue = beat["dialogue"].strip()
            if dialogue:
                end = min(beat["end"], beat["start"] + beat["caption"])
                lines.append(f"{i}\n{timestamp(beat['start'])} --> {timestamp(end)}\n{dialogue}\n")
        clips.write_text("\n".join(relative))
        subtitles.write_text("\n".join(lines))
        merged = directory / "merged.mp4"
        ffmpeg("-f", "concat", "-safe", "0", "-i", clips, "-c", "copy", merged)
        options = ["-vf", f"subtitles='{subtitles}':force_style='FontName=Noto Sans CJK SC,FontSize=16,MarginV=46,Outline=2'",
                   "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2"] if lines else ["-c:v", "copy"]
        music = os.getenv("JINGXU_BGM_FILE")
        audio_options = ["-c:a", "copy"]
        if music:
            audio_options = ["-filter_complex", "[1:a]volume=0.15[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]",
                             "-map", "0:v:0", "-map", "[a]", "-c:a", "aac"]
        ffmpeg("-i", merged, *(["-stream_loop", "-1", "-i", music] if music else []),
               *options, *audio_options, "-t", 120, "-movflags", "+faststart", target)
    publish_file(project, target)
    return {"file": target.name}
