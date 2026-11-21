import base64
import binascii
import io

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from . import assets, config


class CloudImageRejected(ValueError):
    pass


def generate(prompt, seed, target):
    credentials = config.cloud_credentials()
    if not credentials:
        raise CloudImageRejected("免费生图尚未完成 Workers Free 配置")
    account, token = credentials
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{config.CLOUD_MODEL}"
    try:
        response = httpx.post(url, headers={"Authorization": f"Bearer {token}"},
                              json={"prompt": prompt, "seed": seed, "steps": 4}, timeout=40)
    except httpx.TransportError as error:
        raise ValueError("免费生图连接中断，结果待核对。可先改用绑定参考图") from error
    try:
        data = response.json()
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    errors = data.get("errors")
    codes = [item.get("code") for item in errors if isinstance(item, dict)] if isinstance(errors, list) else []
    if response.status_code == 429:
        message = "今日免费额度已用完，北京时间 08:00 重置" if 3036 in codes else "免费生图暂时限流，请稍后重试"
        raise CloudImageRejected(message + "，也可改用绑定参考图")
    if response.status_code in (400, 401, 402, 403, 404, 410, 413):
        raise CloudImageRejected(f"免费生图拒绝了请求（HTTP {response.status_code}），请核对模型和 Workers Free 配置")
    if not response.is_success or not data.get("success"):
        raise ValueError("免费生图未确认成功。请核对后重试，或改用绑定参考图")
    result = data.get("result")
    encoded = result.get("image") if isinstance(result, dict) else None
    if not isinstance(encoded, str) or len(encoded) > (assets.MAX_BYTES * 4 + 2) // 3 + 4:
        raise CloudImageRejected("免费生图没有返回可用图像")
    try:
        with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as original:
            if original.width * original.height > Image.MAX_IMAGE_PIXELS:
                raise CloudImageRejected("免费生图像素过大")
            # A cropped preview is local to the project and will be manually reviewed.
            ImageOps.fit(ImageOps.exif_transpose(original).convert("RGB"), (1080, 1920)).save(target, quality=88)
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise CloudImageRejected("免费生图返回了损坏或无法读取的图像") from error
    return response.headers.get("cf-ray")
