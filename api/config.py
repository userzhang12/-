import json
import os
import re
import subprocess
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

PROVIDER_KEYS = ("DEEPSEEK_API_KEY", "ARK_API_KEY", "JINGXU_TTS_URL")
LIVE_FIELDS = ("DEEPSEEK_API_KEY", "ARK_API_KEY", "ARK_IMAGE_MODEL", "ARK_VIDEO_MODEL", "JINGXU_PRICES_CENTS")
PRICE_FIELDS = ("script", "frame", "product_frame", "static_clip", "dynamic_clip_sec", "export")

# Ark Beijing on-demand estimates, in cents. Image reserves cover a 2K output
# and one input image. Video requests use a first frame and no input video.
SEEDREAM_4 = "doubao-seedream-4-0-20260415"
IMAGE_MODELS = {
    SEEDREAM_4: ("火山方舟 · Seedream 4.0", 20),
    "doubao-seedream-5-0-flash-260915": ("Seedream 5.0 Flash", 12),
    "doubao-seedream-5-0-260128": ("Seedream 5.0 Lite", 22),
    "doubao-seedream-5-5-261028": ("Seedream 5.5", 28),
    "doubao-seedream-5-0-pro-260628": ("Seedream 5.0 Pro", 60),
}
VIDEO_MODELS = {
    "doubao-seedance-2-0-mini-260615": ("Seedance 2.0 Mini", {"480p": 25, "720p": 52}),
    "doubao-seedance-2-0-fast-260128": ("Seedance 2.0 Fast", {"480p": 39, "720p": 82}),
    "doubao-seedance-2-0-260128": ("Seedance 2.0", {"480p": 48, "720p": 102}),
}
MODEL_ENV = {"frame": "ARK_IMAGE_MODEL", "clip": "ARK_VIDEO_MODEL"}
REFERENCE_FRAME = "reference"
CLOUD_FRAME = "cloudflare-flux"
CLOUD_MODEL = "@cf/black-forest-labs/flux-1-schnell"


class ModelUnavailable(ValueError):
    pass


def enabled_ark_models():
    raw = os.getenv("JINGXU_ARK_ENABLED_MODELS")
    if raw is None:
        return None
    models = json.loads(raw)
    if not isinstance(models, list) or any(not isinstance(model, str) or not model for model in models):
        raise ValueError("已上线方舟模型需配置为模型 ID 数组")
    return set(models)


def require_available_model(model):
    enabled = enabled_ark_models()
    if not model or (enabled is not None and model not in enabled):
        raise ModelUnavailable("该方舟模型未上线，暂不可用")


def cloud_credentials():
    account = os.getenv("JINGXU_CLOUDFLARE_ACCOUNT_ID", "")
    token = os.getenv("JINGXU_CLOUDFLARE_API_TOKEN", "")
    if os.getenv("JINGXU_CLOUDFLARE_FREE") == "1" and re.fullmatch(r"[a-fA-F0-9]{32}", account) and token:
        return account, token
    vault = os.getenv("JINGXU_CLOUDFLARE_VAULT")
    if os.name == "nt" and vault:
        try:
            return read_cloud_vault(Path(vault).read_text(encoding="utf-8"))
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
    return None


@lru_cache(maxsize=1)
def read_cloud_vault(raw):
    saved = json.loads(raw)
    if not isinstance(saved, dict):
        return None
    account, cipher = saved.get("account"), saved.get("cipher")
    if not isinstance(account, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", account):
        return None
    if not isinstance(cipher, str) or not re.fullmatch(r"[a-fA-F0-9]{1,8192}", cipher):
        return None
    command = ('$ErrorActionPreference="Stop"; $token=ConvertTo-SecureString ([Console]::In.ReadToEnd()); '
               '[Console]::Write([Net.NetworkCredential]::new("",$token).Password)')
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    env = {name: value for name, value in os.environ.items() if name.lower() != "psmodulepath"}
    result = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", command],
                            input=cipher.encode("ascii"), capture_output=True, timeout=10, env=env,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    return (account, result.stdout.decode("ascii")) if result.returncode == 0 and result.stdout else None


def job_model(kind, payload):
    return payload.get("model") or os.getenv(MODEL_ENV[kind])


def model_options(prices):
    images = {key: {"label": label, "cents": max(prices["frame"], cents)}
              for key, (label, cents) in IMAGE_MODELS.items()}
    # Match the app's 496 × 864 and 720 × 1280 vertical output sizes.
    pixels_720p = 720 * 1280
    video_floor = {"480p": (prices["dynamic_clip_sec"] * 496 * 864 + pixels_720p - 1) // pixels_720p,
                   "720p": prices["dynamic_clip_sec"]}
    videos = {key: {"label": label, "rates": {size: max(video_floor[size], cents) for size, cents in rates.items()}}
              for key, (label, rates) in VIDEO_MODELS.items()}
    default_image, default_video = (os.getenv(MODEL_ENV[kind]) for kind in ("frame", "clip"))
    if default_image:
        images.setdefault(default_image, {"label": "服务端配置的生图模型", "cents": prices["frame"]})
    if default_video:
        videos.setdefault(default_video, {"label": "服务端配置的视频模型", "rates": {"720p": prices["dynamic_clip_sec"]}})
    enabled = enabled_ark_models()
    for key, option in [*images.items(), *videos.items()]:
        option["available"] = enabled is None or key in enabled
    if not images[SEEDREAM_4]["available"]:
        images[SEEDREAM_4]["unavailable_reason"] = "待方舟开通"
    images[REFERENCE_FRAME] = {"label": "使用绑定参考图", "cents": prices["product_frame"], "available": True}
    images[CLOUD_FRAME] = {"label": "免费生图 · FLUX.1 Schnell", "cents": 0,
                           "available": cloud_credentials() is not None, "unavailable_reason": "待配置 Workers Free"}
    return {"image": images, "video": videos, "local_clip_cents": prices["static_clip"]}


def render_settings(project, options):
    saved = project.get("render_settings", {})
    active_images = [key for key, option in options["image"].items() if option["available"]]
    active_videos = [key for key, option in options["video"].items() if option["available"]]
    image = next((key for key in (saved.get("image"), os.getenv(MODEL_ENV["frame"])) if key in active_images), REFERENCE_FRAME)
    video = next((key for key in (saved.get("video"), os.getenv(MODEL_ENV["clip"])) if key in active_videos), next(iter(active_videos), None))
    rates = options["video"].get(video, {}).get("rates", {})
    resolution = saved.get("resolution") if saved.get("resolution") in rates else "720p"
    return {"image": image, "video": video, "resolution": resolution,
            "full_dynamic": saved.get("full_dynamic") is True}


def live_enabled():
    return any(os.getenv(key) for key in PROVIDER_KEYS)


def load_prices():
    prices = json.loads(os.getenv("JINGXU_PRICES_CENTS", "{}"))
    if not isinstance(prices, dict):
        raise ValueError("计价配置必须是 JSON 对象")
    for field in PRICE_FIELDS:
        if type(prices.get(field)) is not int or prices[field] <= 0:
            raise ValueError(f"计价项 {field} 必须是大于零的整数分")
    return prices


def check_live():
    missing = [name for name in LIVE_FIELDS if not os.getenv(name)]
    if missing:
        raise ValueError("真实出片缺少配置 " + ", ".join(missing))
    endpoint = os.getenv("JINGXU_TTS_URL")
    if endpoint and (urlsplit(endpoint).scheme != "https" or not urlsplit(endpoint).hostname):
        raise ValueError("配音端点应使用 HTTPS")
    load_prices()
    enabled_ark_models()


if __name__ == "__main__":
    try:
        check_live()
    except (ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
    print("真实出片配置格式已通过检查")
