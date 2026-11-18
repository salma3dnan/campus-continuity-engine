"""Portfolio UX invariants tested against isolated PostgreSQL, never the demo DB."""
import os
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import select, func
from app.db import SessionLocal
from app.main import generate_recovery
from app.models import Proposal, ProposedAssignment, AuditEvent, Unavailability, Session, User


def incident(client, prefix):
    return next(item for item in client.get("/api/disruptions").json()
                if item["title"].startswith(prefix))


def generate(client, auth, incident_id):
    result = client.post(f"/api/disruptions/{incident_id}/recovery-plans", headers=auth)
    assert result.status_code == 200, result.text
    return result.json()


def test_repeated_search_is_idempotent_and_keeps_only_distinct_pending_plans(client, auth):
    item = incident(client, "B ·")
    first = generate(client, auth, item["id"])
    assert len(first["plans"]) == 3
    original_ids = [p["id"] for p in first["plans"]]
    second = generate(client, auth, item["id"])
    assert [p["id"] for p in second["plans"]] == original_ids
    displayed = client.get(f"/api/disruptions/{item['id']}/recovery-plans").json()
    assert [p["id"] for p in displayed] == original_ids
    assert len({tuple((a["session_id"], a["new_room_id"]) for a in p["assignments"])
                for p in displayed}) == 3
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Proposal.id)).where(Proposal.status == "pending")) == 3
        assert db.scalar(select(func.count(AuditEvent.id)).where(
            AuditEvent.action == "recovery_generated")) == 1


def test_concurrent_generations_share_one_unique_set(client):
    item = incident(client, "B ·")
    def worker():
        with SessionLocal() as db:
            admin = db.get(User, 1)
            return [p["id"] for p in generate_recovery(item["id"], admin, db)["plans"]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        left, right = list(pool.map(lambda _: worker(), range(2)))
    assert left == right
    assert len(left) == 3
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Proposal.id)).where(
            Proposal.disruption_id == item["id"], Proposal.status == "pending")) == 3


def test_old_duplicated_pending_plans_are_preserved_but_not_shown_twice(client, auth):
    item = incident(client, "B ·")
    initial = generate(client, auth, item["id"])
    original = initial["plans"][0]
    with SessionLocal.begin() as db:
        for _ in range(3):
            copy = Proposal(disruption_id=item["id"], status="pending",
                            score=original["score"],
                            details=db.get(Proposal, original["id"]).details,
                            generated_at=db.get(Proposal, original["id"]).generated_at)
            db.add(copy)
            db.flush()
            for a in original["assignments"]:
                db.add(ProposedAssignment(proposal_id=copy.id,
                    session_id=a["session_id"], original_room_id=a["original_room_id"],
                    new_room_id=a["new_room_id"]))
    # Public view is deduplicated even before old records are normalized.
    before = client.get(f"/api/disruptions/{item['id']}/recovery-plans").json()
    assert len(before) == 3
    generated = generate(client, auth, item["id"])
    assert len(generated["plans"]) == 3
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Proposal.id)).where(
            Proposal.disruption_id == item["id"], Proposal.status == "pending")) == 3
        assert db.scalar(select(func.count(Proposal.id)).where(
            Proposal.disruption_id == item["id"], Proposal.status == "superseded")) == 3
        # Every historical assignment remains intact.
        assert db.scalar(select(func.count(ProposedAssignment.id))) == 12


def test_changed_availability_retires_obsolete_choice_without_reset(client, auth):
    item = incident(client, "A ·")
    first = generate(client, auth, item["id"])
    chosen = first["plans"][0]
    with SessionLocal.begin() as db:
        s = db.get(Session, chosen["assignments"][0]["session_id"])
        db.add(Unavailability(room_id=chosen["assignments"][0]["new_room_id"],
                              start_at=s.start_at, end_at=s.end_at, reason="New repair"))
    revised = generate(client, auth, item["id"])
    assert all(p["id"] != chosen["id"] for p in revised["plans"])
    with SessionLocal() as db:
        assert db.get(Proposal, chosen["id"]).status == "superseded"


def test_impossible_case_returns_no_approval_choices(client, auth):
    item = incident(client, "D ·")
    result = generate(client, auth, item["id"])
    assert result["plans"] == []
    assert "no feasible" in result["message"].lower()
    assert client.get(f"/api/disruptions/{item['id']}/recovery-plans").json() == []


def test_audit_exposes_readable_change_for_admin_but_not_private_username_to_guests(client, auth):
    item = incident(client, "A ·")
    plan = generate(client, auth, item["id"])["plans"][0]
    approved = client.post(f"/api/recovery-plans/{plan['id']}/approve", headers=auth)
    assert approved.status_code == 200, approved.text
    entries = client.get("/api/audit-events", headers=auth).json()
    event = next(e for e in entries if e["action"] == "recovery_approved")
    assert event["actor_display"] == os.environ["DEMO_ADMIN_USERNAME"]
    assert event["changes"] == [{
        "session_id": plan["assignments"][0]["session_id"],
        "session_code": "A-OS",
        "session_title": "Operating Systems Lab",
        "from_room": "A-LAB1",
        "to_room": "A-LAB2"
    }]
    anonymous = client.get("/api/audit-events").json()
    matching = next(e for e in anonymous if e["id"] == event["id"])
    assert matching["actor_display"] == "Administrator"
    assert matching["changes"] == event["changes"]
    assert os.environ["DEMO_ADMIN_USERNAME"] not in str(anonymous)
