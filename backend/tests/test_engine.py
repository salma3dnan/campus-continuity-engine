from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from app.db import SessionLocal
from app.engine import overlaps, get_impacts, find_plans, reject_reasons
from app.models import Disruption, Session, Room, Unavailability

def scenario(db, prefix):
    return db.scalar(select(Disruption).where(Disruption.title.like(prefix + "%")))

def test_half_open_boundaries():
    a = datetime(2027, 2, 9, 1, tzinfo=timezone.utc)
    b = a + timedelta(hours=2)
    assert overlaps(a, b, b - timedelta(minutes=1), b + timedelta(hours=1))
    assert not overlaps(a, b, b, b + timedelta(hours=1))
    assert not overlaps(a, b, a - timedelta(hours=1), a)

def test_room_closure_impact():
    with SessionLocal() as db:
        impact = get_impacts(db, scenario(db, "A ·"))
        assert [x["code"] for x in impact] == ["A-OS"]

def test_network_outage_only_affects_network_dependent_sessions():
    with SessionLocal() as db:
        impact = get_impacts(db, scenario(db, "B ·"))
        assert {x["code"] for x in impact} == {"B-DB", "B-NET"}
        assert "B-MATH" not in [x["code"] for x in impact]

def test_equipment_shortage_respects_quantity():
    with SessionLocal() as db:
        impact = get_impacts(db, scenario(db, "C ·"))
        assert [x["code"] for x in impact] == ["C-GRAPH"]
        assert "only 0 available" in impact[0]["reason"]

def test_complete_plans_rank_deterministically():
    with SessionLocal() as db:
        incident = scenario(db, "B ·")
        first, second = find_plans(db, incident), find_plans(db, incident)
        assert first["plans"] == second["plans"]
        assert 1 <= len(first["plans"]) <= 3
        assert len(first["plans"][0]["assignments"]) == 2
        assert len({a["new_room_id"] for a in first["plans"][0]["assignments"]}) == 2
        assert all(p["score"] == sum(a["score"]["total"] for a in p["assignments"])
                   for p in first["plans"])
        assert [p["score"] for p in first["plans"]] == sorted(
            [p["score"] for p in first["plans"]], reverse=True)

def test_capacity_equipment_network_and_original_room_rejections():
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.code == "A-OS"))
        # A-R102 has 32 seats. The seed's A-OS attendance is 32,
        # so increase attendance within this read-only transaction to
        # explicitly test a strict capacity failure (35 > 32).
        s.attendees = 35
        rooms = {r.code: r for r in db.scalars(select(Room))}
        moving = [s.id]
        assert any("Capacity" in x for x in reject_reasons(db,s,rooms["A-R102"],moving))
        assert any("network" in x.lower() for x in reject_reasons(db,s,rooms["A-R102"],moving))
        assert any("computer" in x for x in reject_reasons(db,s,rooms["A-R101"],moving))
        assert any("Original" in x for x in reject_reasons(db,s,rooms["A-LAB1"],moving))

def test_room_maintenance_rejected():
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.code == "B-DB"))
        room = db.scalar(select(Room).where(Room.code == "B-LAB3"))
        reasons = reject_reasons(db, s, room, [s.id])
        assert any("maintenance" in r.lower() for r in reasons)

def test_existing_booking_rejected_and_adjacent_not_rejected():
    with SessionLocal.begin() as db:
        s = db.scalar(select(Session).where(Session.code == "B-DB"))
        target = db.scalar(select(Room).where(Room.code == "B-LAB1"))
        competing = Session(code="BLOCKER", title="Reserved",
              room_id=target.id, original_room_id=target.id,
              start_at=s.start_at, end_at=s.end_at, attendees=5,
              needs_network=False, is_active=True)
        db.add(competing)
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.code == "B-DB"))
        target = db.scalar(select(Room).where(Room.code == "B-LAB1"))
        assert any("booked" in x for x in reject_reasons(db, s, target, [s.id]))
    with SessionLocal.begin() as db:
        s = db.scalar(select(Session).where(Session.code == "B-DB"))
        target = db.scalar(select(Room).where(Room.code == "B-LAB2"))
        db.add(Session(code="ADJACENT", title="Adjacent", room_id=target.id,
              original_room_id=target.id, start_at=s.end_at,
              end_at=s.end_at + timedelta(hours=1), attendees=5,
              needs_network=False, is_active=True))
    with SessionLocal() as db:
        s = db.scalar(select(Session).where(Session.code == "B-DB"))
        target = db.scalar(select(Room).where(Room.code == "B-LAB2"))
        assert not any("booked" in x for x in reject_reasons(db, s, target, [s.id]))

def test_closure_disruption_at_boundary_does_not_impact():
    with SessionLocal.begin() as db:
        incident = scenario(db, "A ·")
        incident.start_at = incident.end_at
        incident.end_at = incident.end_at + timedelta(minutes=30)
    with SessionLocal() as db:
        assert get_impacts(db, scenario(db, "A ·")) == []

def test_no_solution_explanations():
    with SessionLocal() as db:
        result = find_plans(db, scenario(db, "D ·"))
        assert result["impacts"][0]["code"] == "D-CEREMONY"
        assert result["plans"] == []
        assert "no feasible" in result["message"].lower()
        reasons = [x for rejected in result["rejected"].values() for item in rejected
                   for x in item["reasons"]]
        assert any("Capacity" in r for r in reasons)
