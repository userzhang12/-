import json
import os
from urllib.parse import urlsplit

PROVIDER_KEYS = ("DEEPSEEK_API_KEY", "ARK_API_KEY", "JINGXU_TTS_URL")
LIVE_FIELDS = ("DEEPSEEK_API_KEY", "ARK_API_KEY", "ARK_IMAGE_MODEL", "ARK_VIDEO_MODEL", "JINGXU_PRICES_CENTS")
PRICE_FIELDS = ("script", "frame", "product_frame", "static_clip", "dynamic_clip_sec", "export")


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


if __name__ == "__main__":
    try:
        check_live()
    except (ValueError, KeyError) as error:
        raise SystemExit(str(error)) from None
    print("真实出片配置格式已通过检查")
