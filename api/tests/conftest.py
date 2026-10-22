import pytest

from app import db
from fakes import DB_FUNCTIONS, FakeDB


@pytest.fixture
def store(monkeypatch):
    """Swap app.db's data functions for an in-memory fake; dev env so read routes resolve."""
    fake = FakeDB()
    for name in DB_FUNCTIONS:
        monkeypatch.setattr(db, name, getattr(fake, name))
    monkeypatch.setenv("ENV", "dev")
    monkeypatch.setenv("DEV_WORKSPACE_ID", "ws-a")
    return fake
