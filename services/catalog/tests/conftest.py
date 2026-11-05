import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from zakka_catalog.connectors import all_connectors  # noqa: E402
from zakka_catalog.enrich import MockEnricher  # noqa: E402
from zakka_catalog.store import MemoryStore  # noqa: E402
from zakka_catalog.sync import sync_many  # noqa: E402


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Contract rule 4: tests never touch the network."""

    real_connect = socket.socket.connect
    loopback = {"127.0.0.1", "::1", "localhost"}

    def guard(sock, address, *args, **kwargs):
        # asyncio's self-pipe (used by TestClient on Windows) connects over loopback.
        host = address[0] if isinstance(address, tuple) else address
        if host in loopback:
            return real_connect(sock, address, *args, **kwargs)
        raise RuntimeError(f"network access attempted in tests: {address!r}")

    def no_create(address, *args, **kwargs):
        raise RuntimeError(f"network access attempted in tests: {address!r}")

    monkeypatch.setattr(socket.socket, "connect", guard)
    monkeypatch.setattr(socket, "create_connection", no_create)


@pytest.fixture
def connectors():
    return all_connectors(env={})  # no keys -> every connector in mock mode


@pytest.fixture
def store():
    return MemoryStore()


@pytest.fixture
def synced(store, connectors):
    sync_many(store, connectors.values(), MockEnricher())
    return store
