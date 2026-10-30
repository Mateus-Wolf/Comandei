from dataclasses import dataclass
import time
import logging
from uuid import UUID

import httpx
import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from . import config
from .errors import APIError, forbidden

bearer = HTTPBearer(auto_error=False)
jwks = jwt.PyJWKClient(config.ISSUER + "/.well-known/jwks.json", cache_jwk_set=True, lifespan=300, timeout=5)
http = httpx.Client(timeout=5, follow_redirects=False)


@dataclass(frozen=True)
class Identity:
    user_id: UUID
    claims: dict
    token: str = ""


def verify_token(token: str) -> Identity:
    try:
        if len(token) > 16384:
            raise ValueError("token length")
        header = jwt.get_unverified_header(token)
        alg = header.get("alg")
        if alg in ("ES256", "RS256"):
            key = jwks.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                key,
                algorithms=["ES256", "RS256"],
                issuer=config.ISSUER,
                audience=config.AUDIENCE,
                options={"require": ["exp", "iat", "sub", "iss", "aud"]},
            )
        elif alg == "HS256":
            # Legacy projects: Supabase verifies the signature; no JWT signing secret in API.
            response = http.get(
                config.ISSUER + "/user",
                headers={"Authorization": f"Bearer {token}", "apikey": config.PUBLISHABLE_KEY},
            )
            if response.status_code >= 500 or response.status_code == 429:
                raise APIError(503, "AUTH_UNAVAILABLE", "Autenticação temporariamente indisponível.")
            if response.status_code != 200:
                raise ValueError("invalid auth")
            claims = jwt.decode(
                token,
                algorithms=["HS256"],
                issuer=config.ISSUER,
                audience=config.AUDIENCE,
                options={
                    "verify_signature": False,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iat": True,
                    "verify_iss": True,
                    "verify_aud": True,
                    "require": ["exp", "iat", "sub", "iss", "aud"],
                },
            )
            if response.json().get("id") != claims["sub"]:
                raise ValueError("subject mismatch")
        else:
            raise ValueError("algorithm")
        if claims.get("role") != "authenticated" or claims.get("is_anonymous", False):
            raise ValueError("role")
        return Identity(UUID(claims["sub"]), claims, token)
    except APIError:
        raise
    except (httpx.HTTPError, jwt.PyJWKClientConnectionError) as exc:
        raise APIError(503, "AUTH_UNAVAILABLE", "Autenticação temporariamente indisponível.") from exc
    except (jwt.PyJWTError, ValueError, KeyError, TypeError) as exc:
        logging.getLogger(__name__).warning("Token rejected: %s", type(exc).__name__)
        raise APIError(401, "INVALID_TOKEN", "Sessão inválida ou expirada.") from exc


def current_identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Identity:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise APIError(401, "AUTH_REQUIRED", "Faça login para continuar.")
    return verify_token(credentials.credentials)


def require_sensitive(identity: Identity, connection):
    """Require recent MFA and a currently live Supabase Auth session."""
    claims = identity.claims
    methods = claims.get("amr", [])
    if not isinstance(methods, list):
        methods = []
    recent = any(
        isinstance(x, dict)
        and x.get("method") in ("totp", "phone", "mfa/totp", "mfa/phone")
        and type(x.get("timestamp")) in (int, float)
        and 0 <= time.time() - x.get("timestamp", 0) <= 900
        for x in methods
    )
    if claims.get("aal") != "aal2" or not recent or not claims.get("session_id"):
        raise APIError(403, "RECENT_MFA_REQUIRED", "Confirme sua identidade com MFA nos últimos 15 minutos.")
    from sqlalchemy import text

    try:
        session_id = UUID(claims["session_id"])
    except (ValueError, TypeError):
        forbidden()
    active = connection.execute(
        text("select app.session_is_active(:session_id)"), {"session_id": session_id}
    ).scalar_one()
    if not active:
        raise APIError(401, "SESSION_REVOKED", "Sua sessão foi encerrada. Faça login novamente.")

