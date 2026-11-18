from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from app.db import engine, SessionLocal
from app.approval import approve
from app.models import Session, Proposal, AuditEvent, Room, Unavailability

def first_incident(client, prefix):
    return next(i for i in client.get("/api/disruptions").json() if i["title"].startswith(prefix))

def generate(client, auth, prefix="A ·"):
    incident = first_incident(client, prefix)
    response = client.post("/api/disruptions/" + str(incident["id"]) + "/recovery-plans", headers=auth)
    assert response.status_code == 200, response.text
    return response.json()

def test_health_real_postgresql(client):
    assert client.get("/api/health").json() == {"status":"ok", "database":"connected"}
    with engine.connect() as conn:
        assert "PostgreSQL" in conn.execute(text("select version()")).scalar()

def test_login_and_protected_write(client, auth):
    assert client.post("/api/disruptions/1/recovery-plans").status_code == 401
    assert client.post("/api/auth/login", json={"username":"bad","password":"bad"}).status_code == 401
    assert client.post("/api/disruptions/1/recovery-plans",
        headers={"Authorization":"Bearer invalid"}).status_code == 401
    assert client.post("/api/disruptions/1/recovery-plans", headers=auth).status_code == 200

def test_request_validation(client, auth):
    base = {"title":"Malformed incident","kind":"closure","room_id":1,
            "start_at":"2027-02-09T12:00:00","end_at":"2027-02-09T13:00:00"}
    assert client.post("/api/disruptions",json=base,headers=auth).status_code == 422
    base["start_at"]="2027-02-09T12:00:00+08:00"
    base["end_at"]="2027-02-09T11:00:00+08:00"
    assert client.post("/api/disruptions",json=base,headers=auth).status_code == 422
    base["end_at"]="2027-02-09T13:00:00+08:00"
    base["building_id"]=1
    assert client.post("/api/disruptions",json=base,headers=auth).status_code == 422
    base["building_id"]=None
    assert client.post("/api/disruptions",json=base,headers=auth).status_code == 201

def test_impact_api_is_not_hardcoded(client):
    a = first_incident(client,"A ·")
    b = first_incident(client,"B ·")
    c = first_incident(client,"C ·")
    assert len(client.get("/api/disruptions/" + str(a["id"]) + "/impacts").json()) == 1
    assert len(client.get("/api/disruptions/" + str(b["id"]) + "/impacts").json()) == 2
    assert len(client.get("/api/disruptions/" + str(c["id"]) + "/impacts").json()) == 1

def test_proposals_persist_and_are_complete(client, auth):
    result = generate(client, auth, "B ·")
    assert len(result["plans"]) == 3
    assert len(result["plans"][0]["assignments"]) == 2
    stored = client.get("/api/disruptions/" + str(first_incident(client,"B ·")["id"]) +
                        "/recovery-plans").json()
    assert len(stored) == 3
    assert [p["score"] for p in stored] == sorted(
        [p["score"] for p in stored], reverse=True)
    assert all(len(x["details"]["explanations"]) == 2 for x in stored)

def test_atomic_approval_history_and_duplicate_prevention(client, auth):
    result = generate(client, auth)
    plan = result["plans"][0]
    response = client.post("/api/recovery-plans/" + str(plan["id"]) + "/approve", headers=auth)
    assert response.status_code == 200, response.text
    with SessionLocal() as db:
        changed = db.get(Session, plan["assignments"][0]["session_id"])
        assert changed.room_id == plan["assignments"][0]["new_room_id"]
        assert changed.original_room_id == plan["assignments"][0]["original_room_id"]
        event = db.scalar(select(AuditEvent).where(AuditEvent.action == "recovery_approved"))
        assert event is not None
    assert client.post("/api/recovery-plans/" + str(plan["id"]) + "/approve",
                       headers=auth).status_code == 409
    assert any(s["recovered"] for s in client.get("/api/sessions").json())

def test_stale_approval_rejects_whole_change(client, auth):
    result = generate(client, auth)
    plan = result["plans"][0]
    a = plan["assignments"][0]
    with SessionLocal.begin() as db:
        s = db.get(Session, a["session_id"])
        db.add(Unavailability(room_id=a["new_room_id"], start_at=s.start_at,
                              end_at=s.end_at, reason="New maintenance"))
    response = client.post("/api/recovery-plans/" + str(plan["id"]) + "/approve", headers=auth)
    assert response.status_code == 409
    assert "no longer feasible" in response.json()["detail"].lower()
    with SessionLocal() as db:
        s = db.get(Session, a["session_id"])
        assert s.room_id == a["original_room_id"]
        assert db.get(Proposal, plan["id"]).status == "pending"

def test_conflicting_booking_rejects_and_rolls_back(client, auth):
    plan = generate(client, auth, "B ·")["plans"][0]
    a = plan["assignments"][0]
    with SessionLocal.begin() as db:
        target = db.get(Session, a["session_id"])
        db.add(Session(code="LATE-BOOKING", title="Urgent reservation",
              room_id=a["new_room_id"], original_room_id=a["new_room_id"],
              start_at=target.start_at, end_at=target.end_at,
              attendees=5, needs_network=False, is_active=True))
    response = client.post("/api/recovery-plans/" + str(plan["id"]) + "/approve", headers=auth)
    assert response.status_code == 409
    with SessionLocal() as db:
        for item in plan["assignments"]:
            assert db.get(Session, item["session_id"]).room_id == item["original_room_id"]

def test_postgresql_exclusion_constraint_blocks_double_booking():
    with SessionLocal.begin() as db:
        old = db.scalar(select(Session).where(Session.code=="A-OS"))
        same = Session(code="ILLEGAL", title="Double booking",room_id=old.room_id,
            original_room_id=old.room_id,start_at=old.start_at,end_at=old.end_at,
            attendees=5,needs_network=False,is_active=True)
        db.add(same)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
        else:
            raise AssertionError("PostgreSQL accepted overlapping active bookings")

def test_postgresql_accepts_adjacent_booking():
    with SessionLocal.begin() as db:
        old = db.scalar(select(Session).where(Session.code=="A-OS"))
        db.add(Session(code="LEGAL-ADJACENT",title="Adjacent class",
            room_id=old.room_id,original_room_id=old.room_id,
            start_at=old.end_at,end_at=old.end_at + timedelta(hours=1),
            attendees=5,needs_network=False,is_active=True))
    with SessionLocal() as db:
        assert db.scalar(select(Session).where(Session.code=="LEGAL-ADJACENT"))

def test_concurrent_competing_approvals_are_serialized(client, auth):
    plans = generate(client, auth)["plans"]
    actor_id = 1
    def worker(pid):
        try:
            return approve(pid, actor_id)["status"]
        except HTTPException as exc:
            return exc.status_code
    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(worker, [plans[0]["id"], plans[1]["id"]]))
    assert sorted(outcomes, key=str) == sorted(["approved", 409], key=str)
    with SessionLocal() as db:
        approved = list(db.scalars(select(Proposal).where(Proposal.status=="approved")))
        assert len(approved) == 1
        assert db.scalar(select(text("count(*)")).select_from(text("sessions"))) >= 24

def test_no_partial_plan_presented_as_feasible(client, auth):
    result = generate(client, auth, "D ·")
    assert result["plans"] == []
    assert result["impacts"]
    assert "no feasible" in result["message"].lower()
