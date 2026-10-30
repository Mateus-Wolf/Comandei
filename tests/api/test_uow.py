from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from comandei.core.auth import Identity
from comandei.core.errors import APIError
from comandei.core.repository import Repository
from comandei.core.uow import UnitOfWork


def unit(role="owner"):
    return UnitOfWork(None, Identity(uuid4(), {}), {"id": uuid4(), "status": "active"}, role, uuid4())


def test_read_permission_never_loads_the_plan(monkeypatch):
    def unexpected(*args, **kwargs):
        raise AssertionError("Read-only authorization must not query plan limits")

    monkeypatch.setattr(Repository, "query", unexpected)
    unit().allow("read")
    with pytest.raises(APIError) as error:
        unit("waiter").allow("members.manage")
    assert error.value.status == 403


def test_plan_snapshot_is_scoped_to_one_request(monkeypatch):
    plan = {"status": "active", "ends_at": None}
    calls = []

    def query(*args, **kwargs):
        calls.append(1)
        return SimpleNamespace(mappings=lambda: SimpleNamespace(first=lambda: plan))

    monkeypatch.setattr(Repository, "query", query)
    first = unit()
    first.allow("tables.write", new_operation=True)
    first.allow("tables.write", new_operation=True)
    assert len(calls) == 1
    plan["status"] = "suspended"
    with pytest.raises(APIError) as error:
        unit().allow("tables.write", new_operation=True)
    assert error.value.code == "PLAN_RESTRICTED"
    assert len(calls) == 2


def test_expired_plan_still_blocks_new_operations(monkeypatch):
    plan = {"status": "active", "ends_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    monkeypatch.setattr(
        Repository,
        "query",
        lambda *a, **k: SimpleNamespace(mappings=lambda: SimpleNamespace(first=lambda: plan)),
    )
    with pytest.raises(APIError) as error:
        unit().allow("tables.write", new_operation=True)
    assert error.value.code == "PLAN_RESTRICTED"


def test_unknown_tenants_share_global_budget(monkeypatch):
    from contextlib import contextmanager
    from comandei.core import uow as module
    keys = []
    @contextmanager
    def connection():
        yield object()
    class Connection:
        def execution_options(self, **kw): return self
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(module, "engine", SimpleNamespace(connect=Connection, begin=connection))
    def execute(conn, sql, params=None):
        if "consume_rate_limit" in sql:
            keys.append(params["key"])
            return SimpleNamespace(scalar_one=lambda: len(keys) <= 2)
        return SimpleNamespace(mappings=lambda: SimpleNamespace(first=lambda: None))
    monkeypatch.setattr(module, "execute", execute)
    identity = Identity(uuid4(), {})
    request = SimpleNamespace(method="GET")
    for expected in (404, 404, 429):
        with pytest.raises(APIError) as error:
            next(module.get_uow(request, uuid4(), identity))
        assert error.value.status == expected
    assert len(set(keys)) == 1
