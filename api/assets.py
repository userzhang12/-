import io
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageChops, ImageOps

from .store import ROOT

MAX_BYTES = 12 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 30_000_000


def image_asset(raw, target):
    if len(raw) > MAX_BYTES:
        raise ValueError("图片不得超过 12 MB")
    with Image.open(io.BytesIO(raw)) as source:
        if source.width * source.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError("图片像素过大")
        image = ImageOps.exif_transpose(source).convert("RGBA")
    image.thumbnail((1600, 1600))
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)
    # Preserve the original and derive a cutout for solid studio backgrounds.
    if image.getchannel("A").getextrema() == (255, 255):
        rgb = image.convert("RGB")
        background = Image.new("RGB", image.size, rgb.getpixel((0, 0)))
        difference = ImageChops.difference(rgb, background).convert("L")
        alpha = difference.point(lambda value: max(0, min(255, (value - 12) * 10)))
        if alpha.getbbox() and alpha.histogram()[0] > image.width * image.height / 8:
            image.putalpha(alpha)
    bounds = image.getbbox()
    cutout = image.crop(bounds) if bounds else image
    cutout.save(target.with_name(target.stem + "-cutout.png"))


def approved_source(url, setting):
    # Exact, operator-configured HTTPS endpoints. Redirects and arbitrary path/query components are excluded.
    approved = json.loads(os.getenv(setting, "{}"))
    target = approved.get(url)
    if not isinstance(target, str):
        raise ValueError("此来源尚未授权，请手动录入资料")
    parts = urlsplit(target)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise ValueError("授权来源必须为 HTTPS")
    with httpx.Client(timeout=12, follow_redirects=False) as client:
        with client.stream("GET", target) as response:
            response.raise_for_status()
            chunks = bytearray()
            for chunk in response.iter_bytes():
                chunks.extend(chunk)
                if len(chunks) > 256 * 1024:
                    raise ValueError("来源响应过大")
    return json.loads(chunks)


def path_for(project, name):
    if Path(name).name != name or name in {".", ".."}:
        raise ValueError("无效的文件名")
    return ROOT / "media" / project / name


def object_client():
    import boto3
    return boto3.client("s3", endpoint_url=os.getenv("S3_ENDPOINT_URL"))


def publish_file(project, path):
    bucket = os.getenv("S3_BUCKET")
    if bucket:
        object_client().upload_file(str(path), bucket, f"{project}/{path.name}")


def restore_file(project, path):
    bucket = os.getenv("S3_BUCKET")
    if bucket and not path.is_file():
        path.parent.mkdir(parents=True, exist_ok=True)
        object_client().download_file(bucket, f"{project}/{path.name}", str(path))
    return path
