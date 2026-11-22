import hashlib
import hmac
import os
import secrets
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import JSON, Boolean, Column, Float, ForeignKey, Integer, MetaData, String, Table, case, create_engine, select

ROOT = Path(os.getenv("JINGXU_DATA", str(Path(__file__).resolve().parents[1] / "data"))).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
DATABASE = os.getenv("DATABASE_URL", f"sqlite:///{ROOT / 'jingxu.sqlite3'}")
engine = create_engine(DATABASE, pool_pre_ping=True)
schema = MetaData()
workspaces = Table("workspaces", schema, Column("id", String, primary_key=True),
                   Column("name", String), Column("quota", Integer, nullable=False))
users = Table("users", schema, Column("email", String, primary_key=True),
              Column("password", String), Column("workspace", String, nullable=False), Column("admin", Boolean))
memberships = Table("workspace_memberships", schema,
                    Column("workspace", String, ForeignKey("workspaces.id"), primary_key=True),
                    Column("email", String, ForeignKey("users.email"), primary_key=True, index=True),
                    Column("role", String, nullable=False))
migrations = Table("schema_migrations", schema, Column("name", String, primary_key=True))
operators = Table("operators", schema, Column("email", String, primary_key=True))
sessions = Table("sessions", schema, Column("id", String, primary_key=True),
                 Column("email", String), Column("expires", Float))
invites = Table("invites", schema, Column("id", String, primary_key=True),
                Column("workspace", String), Column("expires", Float))
projects = Table("projects", schema, Column("id", String, primary_key=True),
                 Column("workspace", String, nullable=False, index=True), Column("data", JSON, nullable=False),
                 Column("updated", Float, nullable=False))
jobs = Table("jobs", schema, Column("id", String, primary_key=True), Column("project", String, nullable=False),
             Column("workspace", String, nullable=False, index=True), Column("kind", String), Column("state", String),
             Column("reserved", Integer, nullable=False), Column("spent", Integer, nullable=False),
             Column("created", Float), Column("updated", Float), Column("payload", JSON), Column("result", JSON))
trends = Table("trends", schema, Column("workspace", String, primary_key=True), Column("data", JSON))
request_limits = Table("request_limits", schema,
                       Column("scope", String, primary_key=True),
                       Column("bucket", Integer, primary_key=True, index=True),
                       Column("hits", Integer, nullable=False))


def init():
    with write() as connection:
        if engine.dialect.name == "postgresql":
            # API and Worker may both initialize the shared database during startup.
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(76129015)")
        schema.create_all(connection)
        revision = "workspace_memberships_v1"
        if not lookup(connection, migrations, migrations.c.name == revision):
            legacy = select(users.c.workspace, users.c.email,
                            case((users.c.admin.is_(True), "owner"), else_="member"))
            connection.execute(memberships.insert().from_select(["workspace", "email", "role"], legacy))
            connection.execute(migrations.insert().values(name=revision))


@contextmanager
def write():
    with engine.connect() as connection:
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise


def lookup(connection, table, predicate, lock=False):
    query = select(table).where(predicate)
    if lock:
        query = query.with_for_update()
    return connection.execute(query).mappings().first()


def uid():
    return uuid.uuid4().hex


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ":" + hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()


def verifies(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(":")[0]), stored)


def now():
    return time.time()


def project_row(connection, workspace, project_id, lock=False):
    return lookup(connection, projects, (projects.c.id == project_id) & (projects.c.workspace == workspace), lock)


def save_project(connection, row, data):
    connection.execute(projects.update().where(projects.c.id == row["id"]).values(data=data, updated=now()))
