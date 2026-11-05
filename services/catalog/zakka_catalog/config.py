"""Environment configuration.

Only the variable names listed in the repo-root ``.env.example`` are read
(contract rule). A tiny ``.env`` loader is included so ``python -m zakka_catalog``
works from a checkout without extra dependencies; real environment variables
always win over the file.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

PHASE1_LOCALES: tuple[str, ...] = ("en", "es", "fr", "pt", "ar", "zh", "hi", "sw", "de", "id")


def load_dotenv(path: Path | None = None) -> None:
    """Load KEY=VALUE lines from the repo-root .env without overriding os.environ."""
    path = path or REPO_ROOT / ".env"
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def database_url() -> str:
    return env("DATABASE_URL")


def catalog_api_token() -> str:
    """Bearer token required on state-changing catalog routes (CATALOG_API_TOKEN)."""
    return env("CATALOG_API_TOKEN")


def catalog_port() -> int:
    """Port comes from CATALOG_API_URL (contract default http://localhost:4020)."""
    from urllib.parse import urlparse

    url = env("CATALOG_API_URL", "http://localhost:4020")
    return urlparse(url).port or 4020
