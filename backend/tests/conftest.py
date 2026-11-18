import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.db import DATABASE_URL, engine
from app.seed import seed
from app.main import app

@pytest.fixture(autouse=True)
def fresh_test_data():
    if make_url(DATABASE_URL).database != "continuity_test":
        raise RuntimeError("Refusing to reset anything except the isolated continuity_test database")
    with engine.begin() as conn:
        conn.execute(text(
            "TRUNCATE audit_events, proposed_assignments, proposals, disruptions, "
            "unavailability, session_requirements, sessions, room_equipment, "
            "rooms, buildings, users RESTART IDENTITY CASCADE"
        ))
    seed()

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture
def auth(client):
    response = client.post("/api/auth/login", json={
        "username": os.environ["DEMO_ADMIN_USERNAME"],
        "password": os.environ["DEMO_ADMIN_PASSWORD"]
    })
    assert response.status_code == 200, response.text
    return {"Authorization": "Bearer " + response.json()["access_token"]}
