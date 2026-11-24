"""Issue a managed production invitation or set a workspace quota."""
import argparse
import json
import secrets

from sqlalchemy import func, select

from . import config
from .store import digest, init, jobs, live_invites, live_workspaces, lookup, now, workspaces, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    invite = commands.add_parser("issue")
    invite.add_argument("--cents", type=int, required=True)
    quota = commands.add_parser("quota")
    quota.add_argument("workspace")
    quota.add_argument("--cents", type=int, required=True)
    commands.add_parser("pending")
    settle = commands.add_parser("settle")
    settle.add_argument("job")
    settle.add_argument("--cents", type=int, required=True)
    args = parser.parse_args()
    if not config.managed_live_enabled():
        parser.error("当前服务未启用正式模型额度管理")
    if args.action != "pending" and not 0 <= args.cents <= 100_000_000:
        parser.error("额度必须是 0 至 100000000 整数分")
    config.check_deployment()
    init()
    with write() as connection:
        if args.action == "issue":
            code = secrets.token_urlsafe(24)
            connection.execute(live_invites.delete().where(live_invites.c.expires <= now()))
            connection.execute(live_invites.insert().values(id=digest(code), expires=now() + 86400, quota=args.cents))
        elif args.action == "quota":
            workspace = args.workspace
            if workspace == "demo" or not lookup(connection, workspaces, workspaces.c.id == workspace, True):
                parser.error("工作空间不存在或不可授权")
            used = connection.scalar(select(func.coalesce(func.sum(jobs.c.spent + jobs.c.reserved), 0))
                                     .where(jobs.c.workspace == workspace))
            if args.cents < used:
                parser.error("额度不能少于该空间已结算及预留用量")
            if not lookup(connection, live_workspaces, live_workspaces.c.workspace == workspace):
                connection.execute(live_workspaces.insert().values(workspace=workspace))
            connection.execute(workspaces.update().where(workspaces.c.id == workspace).values(quota=args.cents))
        elif args.action == "pending":
            query = (select(jobs.c.id, jobs.c.workspace, jobs.c.kind, jobs.c.state, jobs.c.reserved)
                     .where(jobs.c.state.in_(("done", "failed", "uncertain")), jobs.c.reserved > 0)
                     .order_by(jobs.c.created).limit(100))
            receipts = [dict(row) for row in connection.execute(query).mappings()]
        else:
            record = lookup(connection, jobs, jobs.c.id == args.job)
            if not record:
                parser.error("任务不存在")
            lookup(connection, workspaces, workspaces.c.id == record["workspace"], True)
            record = lookup(connection, jobs, jobs.c.id == args.job, True)
            if not record or record["reserved"] <= 0 or record["state"] not in ("done", "failed", "uncertain"):
                parser.error("任务不存在或没有待结算额度")
            result = dict(record["result"])
            if args.cents > record["reserved"]:
                result["message"] = "供应商账单超出预留，请调整价格表"
                result["overrun"] = args.cents - record["reserved"]
            connection.execute(jobs.update().where(jobs.c.id == args.job).values(
                reserved=0, spent=args.cents, result=result, updated=now(),
                state="failed" if record["state"] == "uncertain" else record["state"]))
    if args.action == "issue":
        print(code)
    elif args.action == "pending":
        print(json.dumps(receipts, ensure_ascii=True, indent=2))
    else:
        print("工作空间额度已更新" if args.action == "quota" else "任务费用已登记")


if __name__ == "__main__":
    main()
