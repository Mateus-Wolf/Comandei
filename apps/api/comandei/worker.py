"""Durable outbox and export worker. Run separately from the HTTP API."""

import argparse
import json
import logging
import time
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy.exc import DBAPIError
from .core.repository import execute
from .core.service_db import service_engine
from .modules.reports import render_csv

logger = logging.getLogger("comandei.worker")


def run_once(db=None, tenant_id=None):
    db = db or service_engine("worker")
    owner = uuid4()
    processed = 0
    # Exports do not depend on the Realtime provider being available.
    with db.begin() as c:
        jobs = [
            dict(r)
            for r in execute(
                c, "select * from app.claim_jobs(:owner,:tenant)", {"owner": owner, "tenant": tenant_id}
            ).mappings()
        ]
    for job in jobs:
        data, error = None, None
        try:
            with db.begin() as c:
                rows = [
                    dict(r)
                    for r in execute(
                        c, "select * from app.export_rows(:id,:owner)", {"id": job["id"], "owner": owner}
                    ).mappings()
                ]
            data = render_csv(rows)
        except DBAPIError as exc:
            state = getattr(exc.orig, "sqlstate", None)
            error = "RETRY" if state is None or state[:2] in ("08", "40", "55", "57") else "EXPORT_FAILED"
        with db.begin() as c:
            execute(
                c,
                "select app.finish_job(:id,:owner,:data,:error)",
                {"id": job["id"], "owner": owner, "data": data, "error": error},
            )
        processed += 1
    with db.begin() as c:
        events = [
            dict(r)
            for r in execute(
                c, "select * from app.claim_outbox(:owner,:tenant)", {"owner": owner, "tenant": tenant_id}
            ).mappings()
        ]
    for event in events:
        delivered = False
        try:
            with db.begin() as c:
                delivered = execute(
                    c, "select app.publish_outbox(:id,:owner)", {"id": event["id"], "owner": owner}
                ).scalar_one()
        except DBAPIError as exc:
            logger.warning(
                json.dumps(
                    {
                        "event": "broadcast_failure",
                        "event_id": str(event["event_id"]),
                        "sqlstate": getattr(exc.orig, "sqlstate", None),
                        "attempt": event["attempts"],
                    }
                )
            )
            with db.begin() as c:
                execute(c, "select app.finish_outbox(:id,:owner,false)", {"id": event["id"], "owner": owner})
        logger.info(
            json.dumps(
                {
                    "event": "outbox_delivery",
                    "event_id": str(event["event_id"]),
                    "delivered": delivered,
                    "attempt": event["attempts"],
                    "age_seconds": max(
                        0, int((datetime.now(timezone.utc) - event["created_at"]).total_seconds())
                    ),
                }
            )
        )
        processed += 1
    return processed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            count = run_once()
        except DBAPIError:
            logger.error("Worker database unavailable; retrying.")
            count = 0
        if args.once:
            return
        time.sleep(1 if count else 5)


if __name__ == "__main__":
    main()
