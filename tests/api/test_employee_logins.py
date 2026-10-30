from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError
from comandei.schemas import EmployeeLoginCreate
from comandei.core.errors import APIError
from comandei.core.permissions import require
from comandei.modules.identity import create_employee_login


def test_employee_credentials_validation():
    body = EmployeeLoginCreate(display_name='Ana', username='ana.caixa', password=' password ', role='cashier')
    assert body.password == ' password '
    for patch in ({'role': 'owner'}, {'username': 'Ana@casa'}, {'password': '123'}):
        with pytest.raises(ValidationError):
            EmployeeLoginCreate(**(body.model_dump() | patch))


def test_staff_permissions():
    for role in ('waiter', 'cashier'):
        require(role, 'tabs.open')
        require(role, 'orders.submit')
        for action in ('members.manage', 'catalog.write', 'reports.read'):
            with pytest.raises(APIError):
                require(role, action)
    require('cashier', 'cash.write')
    with pytest.raises(APIError):
        require('waiter', 'cash.write')


def test_create_employee_uses_server_auth_and_registers_compensation(monkeypatch):
    from comandei.core import config, auth
    monkeypatch.setattr(config, 'SUPABASE_SECRET_KEY', 'test-secret')
    user = uuid4()
    sent = []
    monkeypatch.setattr(auth.http, 'post', lambda *a, **k: (sent.append(k) or SimpleNamespace(status_code=200, json=lambda: {'id': str(user)})))
    cleanup = []
    monkeypatch.setattr(auth.http, 'delete', lambda *a, **k: (cleanup.append(a[0]) or SimpleNamespace(raise_for_status=lambda: None)))
    queries = []
    def query(sql, **kwargs):
        queries.append((sql, kwargs))
        return SimpleNamespace(scalar_one=lambda: uuid4())
    events = []
    uow = SimpleNamespace(allow=lambda *a, **k: None, repo=SimpleNamespace(query=query), rollback_actions=[], event=lambda *a, **k: events.append(k))
    body = EmployeeLoginCreate(display_name='Ana', username='ana', password='secret123', role='waiter')
    result = create_employee_login(uow, body)
    assert result['user_id'] == user
    assert sent[0]['json']['email'] == 'ana@staff.comandei.internal'
    assert sent[0]['json']['email_confirm'] is True
    assert 'password' not in str(events)
    assert queries[1][1]['role'] == 'waiter'
    uow.rollback_actions[0]()
    assert cleanup[0].endswith(str(user))


def test_duplicate_username_is_not_attached(monkeypatch):
    from comandei.core import config, auth
    monkeypatch.setattr(config, 'SUPABASE_SECRET_KEY', 'test-secret')
    monkeypatch.setattr(auth.http, 'post', lambda *a, **k: SimpleNamespace(status_code=422, json=lambda: {'code': 'email_exists'}))
    queries = []
    uow = SimpleNamespace(allow=lambda *a, **k: None, repo=SimpleNamespace(query=lambda *a, **k: (queries.append(a) or SimpleNamespace(scalar_one=lambda: True))), rollback_actions=[])
    with pytest.raises(APIError) as error:
        create_employee_login(uow, EmployeeLoginCreate(display_name='Ana', username='ana', password='secret123', role='cashier'))
    assert error.value.code == 'USERNAME_TAKEN'
    assert len(queries) == 1
    assert not uow.rollback_actions
