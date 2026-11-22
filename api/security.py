import ipaddress
import math
import os

from fastapi import HTTPException
from sqlalchemy import text

from .store import digest, now, write

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_RESERVE = text("""
    INSERT INTO request_limits (scope, bucket, hits)
    VALUES (:scope, :bucket, 1)
    ON CONFLICT (scope, bucket) DO UPDATE SET hits = request_limits.hits + 1
    WHERE request_limits.hits < :limit
    RETURNING hits
""")


def allowed_write(request):
    if request.method not in _WRITE_METHODS or not request.url.path.startswith("/api/"):
        return True
    host = os.getenv("JINGXU_PUBLIC_HOST")
    if not host:
        return True
    if request.headers.get("sec-fetch-site") == "cross-site":
        return False
    origin = request.headers.get("origin")
    return origin is None or origin == f"https://{host}"


def client_ip(request):
    # Caddy replaces this header. The production API has no published port.
    address = request.headers.get("x-jingxu-client-ip") if os.getenv("JINGXU_TRUST_PROXY") == "1" else None
    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return request.client.host if request.client else "unknown"


def limit_request(request, action, attempts, *, account=None):
    timestamp = now()
    bucket = int(timestamp // 60)
    scopes = [(digest(f"{action}:ip:{client_ip(request)}"), attempts)]
    if account:
        scopes += [(digest(f"{action}:account:{account}"), 12)]
    blocked = False
    with write() as connection:
        connection.execute(text("DELETE FROM request_limits WHERE bucket < :cutoff"), {"cutoff": bucket - 2})
        for scope, limit in scopes:
            result = connection.execute(_RESERVE, {"scope": scope, "bucket": bucket, "limit": limit})
            if result.scalar_one_or_none() is None:
                blocked = True
                break
    if blocked:
        retry_after = max(1, math.ceil((bucket + 1) * 60 - timestamp))
        raise HTTPException(429, "操作过于频繁，请稍后再试", headers={"Retry-After": str(retry_after)})
