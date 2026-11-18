"""Account onboarding and privilege boundaries on the real isolated PostgreSQL test DB."""
from sqlalchemy import select
from app.db import SessionLocal
from app.models import User

STAFF_EMAIL = "planning.staff@example.edu"
PASSWORD = "A-demonstration-password-2027"

def register(client, **overrides):
    body = {"username": STAFF_EMAIL, "password": PASSWORD}
    body.update(overrides)
    return client.post("/api/auth/register", json=body)

def test_staff_self_registration_creates_database_account(client):
    result = register(client)
    assert result.status_code == 201, result.text
    payload = result.json()
    assert payload["role"] == "staff"
    assert payload["username"] == STAFF_EMAIL
    assert payload["access_token"]
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.username == STAFF_EMAIL))
        assert user is not None and user.role == "staff"
        assert user.password_hash != PASSWORD
        assert PASSWORD not in user.password_hash

def test_staff_login_and_account_lookup(client):
    token = register(client).json()["access_token"]
    headers = {"Authorization": "Bearer " + token}
    assert client.get("/api/auth/me", headers=headers).json() == {
        "username": STAFF_EMAIL, "role": "staff"
    }
    session = client.post("/api/auth/login", json={
        "username": STAFF_EMAIL.upper(), "password": PASSWORD
    })
    assert session.status_code == 200
    assert session.json()["role"] == "staff"

def test_staff_cannot_create_generate_or_approve(client):
    headers = {"Authorization": "Bearer " + register(client).json()["access_token"]}
    incident = client.get("/api/disruptions").json()[0]
    assert client.post("/api/disruptions/" + str(incident["id"]) + "/recovery-plans",
                       headers=headers).status_code == 403
    assert client.post("/api/recovery-plans/1/approve", headers=headers).status_code == 403
    assert client.post("/api/disruptions", headers=headers, json={
        "title": "Disallowed closure", "kind": "closure", "room_id": 1,
        "start_at": "2027-02-09T08:00:00+08:00",
        "end_at": "2027-02-09T10:00:00+08:00"
    }).status_code == 403

def test_duplicate_email_and_case_insensitive_registration(client):
    assert register(client).status_code == 201
    assert register(client, username=STAFF_EMAIL.upper()).status_code == 409

def test_user_cannot_choose_admin_role(client):
    result = register(client, role="admin")
    assert result.status_code == 422
    with SessionLocal() as db:
        assert not db.scalar(select(User).where(User.username == STAFF_EMAIL))

def test_invalid_email_and_weak_password_are_rejected(client):
    assert register(client, username="this-is-not-an-email").status_code == 422
    assert register(client, password="short").status_code == 422

def test_admin_login_still_has_admin_role(client, auth):
    result = client.get("/api/auth/me", headers=auth)
    assert result.status_code == 200
    assert result.json()["role"] == "admin"

def test_me_requires_valid_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me",
                      headers={"Authorization": "Bearer invalid"}).status_code == 401
