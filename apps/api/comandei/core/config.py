import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[4]
load_dotenv(ROOT / ".env.local", encoding="utf-8-sig")
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
PUBLISHABLE_KEY = os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
ISSUER = SUPABASE_URL + "/auth/v1"
AUDIENCE = "authenticated"
CORS_ORIGINS = [s.strip() for s in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if s.strip()]
PLATFORM_OPERATORS = frozenset(
    s.strip() for s in os.getenv("PLATFORM_OPERATOR_IDS", "").split(",") if s.strip()
)


def ca_path():
    path = Path(os.getenv("SUPABASE_DB_CA", "certs/supabase-ca.crt"))
    return str(path if path.is_absolute() else ROOT / path)


def db_connect_args(url):
    # Plaintext is allowed only for an explicitly isolated loopback test database.
    if os.getenv("TEST_ALLOW_LOCAL_PLAINTEXT") == "1":
        if os.getenv("APP_ENV") != "test" or url.host not in ("localhost", "127.0.0.1"):
            raise RuntimeError("Plaintext database access is restricted to loopback tests.")
        return {"sslmode": "disable", "connect_timeout": 10, "prepare_threshold": None}
    return {
        "sslmode": "verify-full",
        "sslrootcert": ca_path(),
        "connect_timeout": 10,
        "prepare_threshold": None,
    }
