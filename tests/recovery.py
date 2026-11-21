"""Exercise lease expiration with a fresh JINGXU_DATA directory."""
from api.store import engine, init, jobs, lookup, now, write
from api.worker import LEASE, next_job

init()
with write() as connection:
    for i, (live, order) in enumerate(((False, ""), (True, ""), (True, "provider-job-id"))):
        connection.execute(jobs.insert().values(
            id=str(i), project="test", workspace="test", kind="clip", state="running", reserved=200,
            spent=0, updated=now() - LEASE - 10, created=now() + i, payload={"live": live},
            result={"order": order} if order else {}))
assert next_job()["id"] == "0"
resumed = next_job()
assert resumed["id"] == "2" and resumed["result"]["order"] == "provider-job-id"
with engine.connect() as connection:
    unknown = lookup(connection, jobs, jobs.c.id == "1")
    assert unknown["state"] == "uncertain" and unknown["reserved"] == 200
print("PASS lease recovery, original-order polling and unknown-charge hold")
