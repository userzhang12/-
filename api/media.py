import base64
import io
import json
import math
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageEnhance, ImageOps
from sqlalchemy import select

from .assets import MAX_BYTES, path_for, publish_file, restore_file
from .store import jobs, now, write
from . import cloud_image, config, script, voice

SAMPLE = Path(__file__).parent / "sample.jpg"
FRAME_SIZE = (1080, 1920)


class UnknownOrder(Exception):
    pass


def run(*args, cwd=None):
    result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=360)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-600:])
    return result.stdout


def ffmpeg(*args, cwd=None):
    return run("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *map(str, args), cwd=cwd)


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
    beat = inputs["beat"]
    receipt = {}
    if inputs.get("cloud_prompt"):
        target = path_for(job["project"], inputs["cloud_file"])
        cached = target.is_file()
        request = None
        if not cached:
            with tempfile.TemporaryDirectory(dir=target.parent) as directory:
                draft = Path(directory) / "frame.jpg"
                prompt = "空场景或道具特写，竖构图，无人物、无品牌和可读文字。" + inputs["cloud_prompt"]
                request = cloud_image.generate(prompt, inputs["cloud_seed"], draft)
                draft.replace(target)
        publish_file(job["project"], target)
        asset = {"id": target.stem, "file": target.name, "cutout": target.name,
                 "kind": "scene", "view": beat["title"], "version": 1, "source": "Cloudflare FLUX.1 Schnell"}
        return {"file": target.name, "asset": asset, "provider": {"model": config.CLOUD_MODEL, "request_id": request},
                **({"message": "复用已生成的场景图，未再次使用免费额度"} if cached else {})}
    reference = inputs.get("reference")
    local = restore_file(job["project"], path_for(job["project"], reference)) if reference else None
    if inputs.get("local_frame") and (not local or not local.is_file()):
        raise ValueError("绑定的参考图不可读取，请重新上传")
    if inputs.get("trusted_until"):
        if inputs["trusted_until"] <= now():
            raise ValueError("方舟尾帧已过期，请绑定新的可信素材")
        return {"file": local.name, "trusted_until": inputs["trusted_until"]}
    if inputs.get("local_frame") or (beat["product"] and local) or not os.getenv("ARK_API_KEY"):
        with Image.open(local or SAMPLE) as original:
            rgb = original.convert("RGB")
            if local and not inputs.get("local_frame"):
                background = ImageEnhance.Brightness(ImageOps.fit(rgb, FRAME_SIZE)).enhance(.35)
                inset = ImageOps.contain(rgb, (960, 1300))
                background.paste(inset, ((1080 - inset.width)//2, (1920 - inset.height)//2))
            elif not local:
                background = ImageOps.fit(rgb, FRAME_SIZE, centering=(.61, .5))
            else:
                background = ImageOps.fit(rgb, FRAME_SIZE)
            background.save(target, quality=88)
    else:
        model = config.job_model("frame", inputs)
        config.require_available_model(model)
        with provider() as client:
            body = {"model": model, "prompt": script.production_prompt(inputs.get("visual_context"), beat) + "，9:16 竖屏",
                    "size": inputs.get("size") or os.getenv("ARK_IMAGE_SIZE", "2K"),
                    "response_format": "b64_json", "watermark": False}
            if model == config.SEEDREAM_4:
                body["sequential_image_generation"] = "disabled"
            if local:
                ref = target.with_suffix(".reference.jpg")
                with Image.open(local) as original:
                    original.convert("RGB").save(ref, quality=85)
                body["image"] = image_url(ref)
            response = client.post("images/generations", json=body)
            response.raise_for_status()
            output = response.json()
            item = output["data"][0]
            receipt = {"provider": {"model": output.get("model") or model,
                                    "request_id": response.headers.get("x-tt-logid") or response.headers.get("x-request-id")}}
            source = target.with_suffix(".source")
            source.write_bytes(base64.b64decode(item["b64_json"]) if item.get("b64_json") else fetch_media(item["url"]))
            with Image.open(source) as original:
                ImageOps.fit(original.convert("RGB"), FRAME_SIZE).save(target, quality=88)
            source.unlink()
    publish_file(job["project"], target)
    return {"file": target.name, **receipt}


def save_order(job_id, order):
    with write() as connection:
        connection.execute(jobs.update().where(jobs.c.id == job_id).values(result={"order": order}, updated=now()))


def video_order(client, job, body):
    order = (job["result"] or {}).get("order")
    if not order:
        config.require_available_model(body["model"])
        try:
            response = client.post("contents/generations/tasks", json=body)
            response.raise_for_status()
            order = response.json()["id"]
        except (httpx.TransportError, KeyError, ValueError) as error:
            raise UnknownOrder("供应商接单结果未知，已保留额度") from error
        save_order(job["id"], order)
    for _ in range(60):
        info = query_video(client, order)
        if info["status"] == "succeeded":
            return order, info
        if info["status"] in {"failed", "expired", "cancelled", "canceled"}:
            raise ValueError(f"方舟订单状态为 {info['status']}，请核对原订单")
        time.sleep(4)
    raise UnknownOrder("供应商任务仍在运行，可查询原订单")


def query_video(client, order):
    response = client.get(f"contents/generations/tasks/{order}")
    response.raise_for_status()
    return response.json()


def video_receipt(order, info, model):
    return {"model": info.get("model") or model, "request_id": order,
            "tokens": (info.get("usage") or {}).get("total_tokens")}


def portrait(job):
    data = job["payload"]
    order = data.get("import_order")
    with provider() as client:
        if order:
            info = query_video(client, order)
        else:
            prompt = "9:16 真人质感虚构人物定妆。单人胸像，面部可辨，自然表情，轻微呼吸和眨眼，固定机位，无对白和文字。"
            order, info = video_order(client, job, {"model": data["model"], "duration": 4, "ratio": "9:16",
                "resolution": "480p", "generate_audio": False, "return_last_frame": True,
                "content": [{"type": "text", "text": prompt + data["description"]}]})
    created = info.get("created_at")
    model = info.get("model") or data.get("model")
    valid_model = isinstance(model, str) and model.startswith(("doubao-seedance-2-0-", "doubao-seedance-2-5-"))
    url = (info.get("content") or {}).get("last_frame_url")
    if (info.get("status") != "succeeded" or not valid_model or not url or type(created) not in (int, float)
            or not now() - 30 * 86400 < created <= now() + 300):
        raise ValueError("方舟没有返回有效的原始尾帧。请核对模型、订单归属和有效期")
    raw = fetch_media(url, limit=MAX_BYTES)
    with Image.open(io.BytesIO(raw)) as image:
        if image.format != "JPEG":
            raise ValueError("方舟尾帧格式不符合原始 JPEG 要求")
        image.verify()
    target = path_for(job["project"], f'{job["id"]}.jpg')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw)
    publish_file(job["project"], target)
    asset = {"id": job["id"], "file": target.name, "cutout": target.name, "kind": "character", "version": 1,
             "view": data["asset_name"], "source": "方舟原始尾帧", "trusted_until": created + 30 * 86400}
    return {"file": target.name, "asset": asset, "provider": video_receipt(order, info, model)}


def clip(job):
    data = job["payload"]
    beat = data["beat"]
    project = job["project"]
    still = restore_file(project, path_for(project, beat["frame"]))
    target = path_for(project, f'{job["id"]}.mp4')
    segment = beat["end"] - beat["start"]
    moving = data.get("dynamic_video", beat["dynamic"] and not beat["product"] and bool(os.getenv("ARK_API_KEY")))
    full = data.get("full_dynamic") is True
    input_file = still
    receipt = {}
    if moving:
        if data.get("trusted_until") and data["trusted_until"] <= now() and not (job.get("result") or {}).get("order"):
            raise config.ModelUnavailable("方舟角色参考在排队期间过期，请更新首帧")
        model = config.job_model("clip", data)
        context = data.get("visual_context")
        motion = script.production_prompt(context, beat, moving=True)
        if full:
            line = beat["dialogue"].strip()
            motion += '。保持同一角色、商品与环境，动作连续，无字幕和背景音乐。'
            speaker = context and context.get("speaker")
            delivery = f"{speaker['name']}用设定的语言和声线（{speaker['voice']}）说" if speaker else "按角色用自然普通话说"
            motion += f'{delivery}：“{line}”' if line else '镜头无人说话，保留自然环境声。'
        with provider() as client:
            order, info = video_order(client, job, {
                "model": model, "content": [{"type": "text", "text": motion},
                    {"type": "image_url", "image_url": {"url": image_url(still)}}],
                "duration": segment, "ratio": "9:16", "resolution": data.get("resolution", "720p"),
                "watermark": False, **({"generate_audio": True} if full else {}),
            })
        input_file = target.with_suffix(".source.mp4")
        input_file.write_bytes(fetch_media(info["content"]["video_url"]))
        receipt = {"provider": video_receipt(order, info, model)}

    scale = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
    if full:
        if not moving:
            raise ValueError("全动态镜头必须使用方舟生成的视频")
        normalize_dynamic(input_file, target, segment, scale, bool(beat["dialogue"].strip()))
        input_file.unlink(missing_ok=True)
        publish_file(project, target)
        return {"file": target.name, "caption": 0, "dynamic": True, **receipt}
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
    return {"file": target.name, "caption": caption, "dynamic": moving, **receipt}


def normalize_dynamic(source, target, segment, scale, dialogue):
    probe = json.loads(run("ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration,nb_frames:stream_disposition=attached_pic:format=duration",
                           "-of", "json", str(source)))
    streams = probe.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    duration = (video or {}).get("duration") or probe.get("format", {}).get("duration")
    try:
        seconds = float(duration)
    except (TypeError, ValueError) as error:
        raise ValueError("方舟返回的镜头时长无法验证") from error
    if (not video or video.get("disposition", {}).get("attached_pic") or video.get("nb_frames") == "1"
            or not math.isfinite(seconds) or seconds < segment - 0.04):
        raise ValueError("方舟返回的动态画面时长不足，请审核原订单")
    has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
    if dialogue and not has_audio:
        raise ValueError("有台词的镜头缺少方舟原声音轨，请检查原订单")
    audio_input = [] if has_audio else ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    ffmpeg("-i", source, *audio_input, "-map", "0:v:0", "-map", "0:a:0" if has_audio else "1:a:0",
           "-vf", scale + ",fps=25", "-af", "apad", "-t", segment, "-c:v", "libx264", "-threads", "2",
           "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", target)


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
            if os.name == "nt":
                shutil.copyfile(source, link)
            else:
                link.symlink_to(source)
            relative.append(f"file '{link.name}'")
            dialogue = beat["dialogue"].strip()
            if dialogue and job["payload"].get("subtitles", True):
                end = min(beat["end"], beat["start"] + beat["caption"])
                lines.append(f"{i}\n{timestamp(beat['start'])} --> {timestamp(end)}\n{dialogue}\n")
        clips.write_text("\n".join(relative))
        subtitles.write_text("\n".join(lines))
        merged = directory / "merged.mp4"
        ffmpeg("-f", "concat", "-safe", "0", "-i", clips.name, "-c", "copy", merged.name, cwd=directory)
        options = ["-vf", f"subtitles='{subtitles.name}':force_style='FontName=Noto Sans CJK SC,FontSize=16,MarginV=46,Outline=2'",
                   "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2"] if lines else ["-c:v", "copy"]
        music = os.getenv("JINGXU_BGM_FILE")
        audio_options = ["-c:a", "copy"]
        if music:
            audio_options = ["-filter_complex", "[1:a]volume=0.15[bg];[0:a][bg]amix=inputs=2:duration=first:normalize=0[a]",
                             "-map", "0:v:0", "-map", "[a]", "-c:a", "aac"]
        ffmpeg("-i", merged, *(["-stream_loop", "-1", "-i", music] if music else []),
               *options, *audio_options, "-t", 120, "-movflags", "+faststart", target, cwd=directory)
    publish_file(project, target)
    return {"file": target.name}
