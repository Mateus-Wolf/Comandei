import time
from types import SimpleNamespace
from uuid import uuid4
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from comandei.core import auth, config
from comandei.core.errors import APIError
from comandei.main import app


@pytest.fixture
def token_factory(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(
        auth.jwks, "get_signing_key_from_jwt", lambda token: SimpleNamespace(key=key.public_key())
    )

    def make(**overrides):
        claims = {
            "iss": config.ISSUER,
            "aud": "authenticated",
            "sub": str(uuid4()),
            "role": "authenticated",
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
            **overrides,
        }
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-only"})

    return make


def test_signed_token(token_factory):
    token = token_factory()
    assert auth.verify_token(token).claims["role"] == "authenticated"


@pytest.mark.parametrize(
    "override",
    [
        {"exp": 1},
        {"nbf": 9999999999},
        {"iss": "https://attacker.invalid"},
        {"aud": "elsewhere"},
        {"sub": "not-a-uuid"},
        {"role": "service_role"},
        {"is_anonymous": True},
    ],
)
def test_bad_claims(token_factory, override):
    with pytest.raises(APIError) as error:
        auth.verify_token(token_factory(**override))
    assert error.value.status == 401


def test_tampered_signature(token_factory):
    token = token_factory()
    parts = token.split(".")
    parts[2] = ("A" if parts[2][0] != "A" else "B") + parts[2][1:]
    with pytest.raises(APIError):
        auth.verify_token(".".join(parts))


def test_missing_and_invalid_token_http():
    client = TestClient(app)
    for headers in ({}, {"Authorization": "Bearer malformed"}, {"Authorization": "Basic abc"}):
        response = client.get("/v1/me/tenants", headers=headers)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert response.json()["error"]["request_id"]
        assert "malformed" not in response.text


def test_unknown_key_denied(monkeypatch, token_factory):
    token = token_factory()

    def unknown(_):
        raise jwt.PyJWKClientError("No matching key")

    monkeypatch.setattr(auth.jwks, "get_signing_key_from_jwt", unknown)
    with pytest.raises(APIError) as error:
        auth.verify_token(token)
    assert error.value.status == 401


def test_jwks_unavailable(monkeypatch, token_factory):
    token = token_factory()

    def down(_):
        raise jwt.PyJWKClientConnectionError("Network unavailable")

    monkeypatch.setattr(auth.jwks, "get_signing_key_from_jwt", down)
    with pytest.raises(APIError) as error:
        auth.verify_token(token)
    assert error.value.status == 503


def test_legacy_verification_requires_auth_server(monkeypatch):
    user = str(uuid4())
    token = jwt.encode(
        {
            "iss": config.ISSUER,
            "aud": "authenticated",
            "sub": user,
            "role": "authenticated",
            "iat": int(time.time()),
            "exp": int(time.time()) + 300,
        },
        "test-signing-key-at-least-32-bytes!!",
        algorithm="HS256",
    )
    mock = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(401, json={})))
    monkeypatch.setattr(auth, "http", mock)
    with pytest.raises(APIError):
        auth.verify_token(token)
    mock = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"id": user})))
    monkeypatch.setattr(auth, "http", mock)
    assert str(auth.verify_token(token).user_id) == user


def test_mfa_required():
    with pytest.raises(APIError) as error:
        auth.require_sensitive(auth.Identity(uuid4(), {"aal": "aal1"}), None)
    assert error.value.code == "RECENT_MFA_REQUIRED"


def test_health_and_body_limit():
    client = TestClient(app)
    assert client.get("/health/live").status_code == 200
    assert client.post("/v1/invitations/accept", content="x" * 262145).status_code == 413
    assert client.get("/internal/metrics").status_code == 404


def test_oversized_and_unsupported_tokens():
    for token in (
        "x" * 16385,
        jwt.encode(
            {"sub": str(uuid4())}, "unsupported-test-key-at-least-48-bytes-long-for-hs384", algorithm="HS384"
        ),
    ):
        with pytest.raises(APIError) as error:
            auth.verify_token(token)
        assert error.value.status == 401


@pytest.mark.parametrize("status", [429, 503])
def test_legacy_auth_outage(monkeypatch, status):
    token = jwt.encode(
        {"sub": str(uuid4())}, "legacy-test-key-longer-than-thirty-two-bytes", algorithm="HS256"
    )
    monkeypatch.setattr(
        auth, "http", httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(status)))
    )
    with pytest.raises(APIError) as error:
        auth.verify_token(token)
    assert error.value.status == 503


def test_sensitive_session_validation():
    identity = auth.Identity(
        uuid4(),
        {
            "aal": "aal2",
            "session_id": str(uuid4()),
            "amr": [{"method": "totp", "timestamp": int(time.time())}],
        },
    )
    for active in (False, True):
        connection = SimpleNamespace(execute=lambda *a, **kw: SimpleNamespace(scalar_one=lambda: active))
        if active:
            auth.require_sensitive(identity, connection)
        else:
            with pytest.raises(APIError) as error:
                auth.require_sensitive(identity, connection)
            assert error.value.code == "SESSION_REVOKED"


@pytest.mark.parametrize(
    "amr",
    [
        None,
        "invalid",
        [{"method": "totp", "timestamp": "invalid"}],
        [{"method": "totp", "timestamp": 1}],
        [{"method": "password", "timestamp": int(time.time())}],
    ],
)
def test_malformed_or_stale_mfa(amr):
    identity = auth.Identity(uuid4(), {"aal": "aal2", "session_id": str(uuid4()), "amr": amr})
    with pytest.raises(APIError) as error:
        auth.require_sensitive(identity, None)
    assert error.value.code == "RECENT_MFA_REQUIRED"
