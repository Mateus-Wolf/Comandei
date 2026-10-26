from sqlalchemy.engine import make_url
import pytest
from comandei.core.config import db_connect_args


def test_remote_database_requires_verified_tls(monkeypatch):
    monkeypatch.delenv("TEST_ALLOW_LOCAL_PLAINTEXT", raising=False)
    args = db_connect_args(make_url("postgresql://comandei_api@db.example.invalid/postgres"))
    assert args["sslmode"] == "verify-full"
    assert args["sslrootcert"]
    assert args["prepare_threshold"] is None


def test_plaintext_forbidden_outside_local_tests(monkeypatch):
    monkeypatch.setenv("TEST_ALLOW_LOCAL_PLAINTEXT", "1")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError):
        db_connect_args(make_url("postgresql://comandei_api@localhost/postgres"))
    monkeypatch.setenv("APP_ENV", "test")
    with pytest.raises(RuntimeError):
        db_connect_args(make_url("postgresql://comandei_api@remote.example.invalid/postgres"))
    assert (
        db_connect_args(make_url("postgresql://comandei_api@127.0.0.1/comandei_test"))["sslmode"] == "disable"
    )
