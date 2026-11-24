"""Review and close user data requests in the deployment console."""
import argparse
import json

from sqlalchemy import select

from .store import data_requests, engine, now, write


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("list", help="List the oldest pending requests")
    close = commands.add_parser("close", help="Record the outcome after processing a request")
    close.add_argument("id")
    close.add_argument("outcome", choices=("completed", "declined"))
    args = parser.parse_args()
    table = data_requests
    if args.command == "list":
        with engine.connect() as connection:
            query = select(table).where(table.c.state == "pending").order_by(table.c.created).limit(100)
            records = [dict(row) for row in connection.execute(query).mappings()]
        print(json.dumps(records, ensure_ascii=True, indent=2))
        return
    with write() as connection:
        result = connection.execute(table.update().where(table.c.id == args.id, table.c.state == "pending")
                                    .values(state=args.outcome, updated=now()))
        if result.rowcount != 1:
            parser.error("找不到待处理的申请")
    print("已记录申请处理结果。")


if __name__ == "__main__":
    main()
