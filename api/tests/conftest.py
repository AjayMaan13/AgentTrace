import pytest

from app import db
from app.auth import Principal, get_principal
from app.main import app
from fakes import DB_FUNCTIONS, FakeDB


@pytest.fixture
def store(monkeypatch):
    """Swap app.db's data functions for an in-memory fake."""
    fake = FakeDB()
    for name in DB_FUNCTIONS:
        monkeypatch.setattr(db, name, getattr(fake, name))
    return fake


@pytest.fixture
def login():
    """Act as a signed-in member of an organization (the workspace). Overrides get_principal;
    the real JWT verification is covered by test_auth.py. Not logged in unless called."""
    def _login(org_id: str = "ws-a", role: str = "member") -> None:
        app.dependency_overrides[get_principal] = lambda: Principal("user_1", org_id, role)

    yield _login
    app.dependency_overrides.pop(get_principal, None)
