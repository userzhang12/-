"""Reset an account password from the deployment console."""
import argparse
import getpass
import sys
import warnings

from .store import lookup, replace_password, users, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email", help="Registered email verified by the deployment administrator")
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.error("请在交互式终端输入新密码")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = getpass.getpass("输入临时密码：").strip()
            confirm = getpass.getpass("确认临时密码：").strip()
    except (getpass.GetPassWarning, EOFError):
        parser.error("终端无法隐藏密码输入")
    if not 10 <= len(password) <= 128 or password != confirm:
        parser.error("密码须为 10–128 个字符，且两次输入一致")
    email = args.email.strip().lower()
    with write() as connection:
        account = lookup(connection, users, users.c.email == email, True)
        if not account:
            parser.error("未找到此账号")
        replace_password(connection, email, password)
    print("密码已重置，旧会话已撤销。")


if __name__ == "__main__":
    main()
