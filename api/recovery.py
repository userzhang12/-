"""Deliver one-time password recovery codes using a configured SMTP relay."""
import hmac
import logging
import os
import re
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from typing import NamedTuple

from .store import digest, lookup, now, password_resets, replace_password, users, write

CODE_LIFETIME = 15 * 60
RESEND_DELAY = 2 * 60
log = logging.getLogger(__name__)


class MailSettings(NamedTuple):
    host: str
    port: int
    sender: str
    username: str
    password: str


def settings():
    host = os.getenv("JINGXU_SMTP_HOST", "").strip()
    sender = os.getenv("JINGXU_SMTP_FROM", "").strip()
    username = os.getenv("JINGXU_SMTP_USER", "")
    password = os.getenv("JINGXU_SMTP_PASSWORD", "")
    port = os.getenv("JINGXU_SMTP_PORT", "465")
    if (not host or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", sender)
            or port not in ("465", "587") or bool(username) != bool(password)):
        return None
    return MailSettings(host, int(port), sender, username, password)


def send(config, email, code):
    message = EmailMessage()
    message["From"] = config.sender
    message["To"] = email
    message["Subject"] = "镜序密码重置码"
    message.set_content(f"在镜序的找回密码页面输入以下重置码。重置码 15 分钟内有效，仅可使用一次。\n\n{code}\n\n如果你没有发起请求，可以忽略此邮件。")
    context = ssl.create_default_context()
    if config.port == 465:
        connection = smtplib.SMTP_SSL(config.host, config.port, timeout=10, context=context)
    else:
        connection = smtplib.SMTP(config.host, config.port, timeout=10)
    with connection as relay:
        if config.port == 587:
            relay.starttls(context=context)
        if config.username:
            relay.login(config.username, config.password)
        relay.send_message(message)


def deliver(email, config):
    table = password_resets
    with write() as connection:
        if not lookup(connection, users, users.c.email == email, True):
            return
        current = now()
        connection.execute(table.delete().where(table.c.expires <= current))
        previous = lookup(connection, table, table.c.email == email)
        if previous and current - previous["created"] < RESEND_DELAY:
            return
        code = secrets.token_urlsafe(24)
        fingerprint = digest(code)
        if previous:
            connection.execute(table.delete().where(table.c.email == email))
        connection.execute(table.insert().values(email=email, code=fingerprint,
                                                 created=current, expires=current + CODE_LIFETIME))
    try:
        send(config, email, code)
    except (OSError, smtplib.SMTPException, ValueError) as error:
        log.warning("Password recovery mail failed (%s)", type(error).__name__)


def redeem(email, code, password):
    table = password_resets
    with write() as connection:
        if not lookup(connection, users, users.c.email == email, True):
            return False
        entry = lookup(connection, table, table.c.email == email)
        if not entry or entry["expires"] <= now() or not hmac.compare_digest(entry["code"], digest(code)):
            return False
        replace_password(connection, email, password)
        return True
