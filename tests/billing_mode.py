"""Verify price validation and that mixed-mode workers never reach suppliers."""
import json
import os
from unittest.mock import patch

from api import config, worker

valid = dict.fromkeys(config.PRICE_FIELDS, 1)
for invalid in (0, -1, True, "1", 1.5):
    with patch.dict(os.environ, {"JINGXU_PRICES_CENTS": json.dumps({**valid, "static_clip": invalid})}):
        try:
            config.load_prices()
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted invalid price {invalid!r}")

for live in (True, False):
    with patch.object(worker.config, "live_enabled", return_value=not live):
        with patch.object(worker.script, "draft") as provider, patch.object(worker, "complete") as complete:
            worker.process({"id": "test", "kind": "script", "payload": {"live": live}})
            provider.assert_not_called()
            expected = "uncertain" if live else "failed"
            assert complete.call_args.args[1] == expected

print("PASS invalid price rejection and cross-mode supplier calls blocked")
