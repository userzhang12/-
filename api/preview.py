"""Issue or withdraw invitations for the invitation preview deployment."""

import argparse
import secrets

from sqlalchemy import func, or_, select

from . import config
from .store import digest, init, now, preview_invites, write

MAX_TESTERS = 10


def issue(count):
    if not 1 <= count <= MAX_TESTERS:
        raise ValueError(f"每次可生成 1 至 {MAX_TESTERS} 个邀请码")
    with write() as connection:
        if connection.dialect.name == "postgresql":
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(76129016)")
        issued = connection.scalar(select(func.count()).select_from(preview_invites).where(
            or_(preview_invites.c.used.is_(True), preview_invites.c.expires > now())))
        if issued + count > MAX_TESTERS:
            raise ValueError(f"已注册和仍有效的邀请码合计最多 {MAX_TESTERS} 个")
        codes = [secrets.token_urlsafe(24) for _ in range(count)]
        connection.execute(preview_invites.insert(), [
            {"id": digest(code), "expires": now() + 86400, "used": False} for code in codes
        ])
    return codes


def revoke_unused():
    with write() as connection:
        return connection.execute(preview_invites.delete().where(preview_invites.c.used.is_(False))).rowcount


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--count", type=int)
    action.add_argument("--revoke-unused", action="store_true")
    args = parser.parse_args()
    if not config.invite_preview_enabled():
        parser.error("请在邀请预览环境中执行")
    try:
        config.check_invite_preview()
        init()
        if args.revoke_unused:
            print(f"已撤销 {revoke_unused()} 个未使用的邀请码")
        else:
            print("\n".join(issue(args.count)))
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
