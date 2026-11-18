"""Idempotent, synthetic university scenarios. Never resets or erases existing data."""
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import select
from .db import SessionLocal
from .models import (User, Building, Room, RoomEquipment, Session, SessionRequirement,
                     Disruption, Unavailability)
from .security import hasher

LOCAL = ZoneInfo("Asia/Kuala_Lumpur")
BASE = datetime(2027, 2, 9, 9, tzinfo=LOCAL)

def time(day, hour=9, minute=0):
    return (BASE + timedelta(days=day)).replace(hour=hour, minute=minute)

def seed():
    username, password = os.environ.get("DEMO_ADMIN_USERNAME"), os.environ.get("DEMO_ADMIN_PASSWORD")
    if not username or not password or len(password) < 12:
        raise RuntimeError("Set DEMO_ADMIN_USERNAME and DEMO_ADMIN_PASSWORD (12+ chars)")
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.username == username))
        if not user:
            db.add(User(username=username, password_hash=hasher.hash(password), role="admin"))
        buildings = {}
        for code, name in [("A", "Academic Block"), ("B", "Innovation Centre"),
                           ("C", "Technology Annex")]:
            b = db.scalar(select(Building).where(Building.code == code))
            if not b:
                b = Building(code=code, name=name)
                db.add(b)
                db.flush()
            buildings[code] = b

        specs = [
            ("A-LAB1", "A", 36, True, {"computer":36, "projector":1}),
            ("A-LAB2", "A", 40, True, {"computer":40, "projector":1}),
            ("A-HALL", "A", 500, True, {"projector":2, "microphone":2}),
            ("A-R101", "A", 48, True, {"projector":1}),
            ("A-R102", "A", 32, False, {}),
            ("B-LAB1", "B", 40, True, {"computer":40, "projector":1}),
            ("B-LAB2", "B", 45, True, {"computer":45, "projector":1}),
            ("B-LAB3", "B", 35, True, {"computer":35, "projector":1}),
            ("B-R101", "B", 60, True, {"projector":2}),
            ("B-R102", "B", 38, False, {"projector":1}),
            ("C-LAB1", "C", 50, True, {"computer":50, "projector":2}),
            ("C-LAB2", "C", 40, True, {"computer":40, "projector":1}),
            ("C-HALL", "C", 220, True, {"projector":2, "microphone":1}),
            ("C-R101", "C", 50, True, {"projector":1}),
        ]
        rooms = {}
        for code, building, cap, network, equipment in specs:
            room = db.scalar(select(Room).where(Room.code == code))
            if not room:
                room = Room(code=code, building_id=buildings[building].id,
                            capacity=cap, network=network)
                db.add(room)
                db.flush()
                for kind, qty in equipment.items():
                    db.add(RoomEquipment(room_id=room.id, kind=kind, quantity=qty))
            rooms[code] = room

        def make_session(code, title, day, room_code, attendees, network=False,
                         req=None, hour=9, duration=2):
            if db.scalar(select(Session).where(Session.code == code)):
                return
            s = Session(code=code, title=title, room_id=rooms[room_code].id,
                        original_room_id=rooms[room_code].id, start_at=time(day, hour),
                        end_at=time(day, hour + duration), attendees=attendees,
                        needs_network=network, is_active=True)
            db.add(s)
            db.flush()
            for kind, qty in (req or {}).items():
                db.add(SessionRequirement(session_id=s.id, kind=kind, quantity=qty))

        # A: 1 closed lab; many feasible alternatives.
        make_session("A-OS", "Operating Systems Lab", 0, "A-LAB1", 32, True,
                     {"computer":30, "projector":1})
        make_session("A-ETHICS", "Professional Ethics", 0, "A-R102", 25)
        # B: 2 simultaneous network-dependent classes; one independent class is NOT impacted.
        make_session("B-DB", "Database Systems Lab", 1, "A-LAB1", 31, True, {"computer":30})
        make_session("B-NET", "Networking Lab", 1, "A-LAB2", 33, True, {"computer":30})
        make_session("B-MATH", "Discrete Mathematics", 1, "A-R102", 25)
        # C: projector failure affects only classes that actually need it.
        make_session("C-GRAPH", "Computer Graphics", 2, "A-LAB1", 29, True,
                     {"computer":25, "projector":1})
        make_session("C-WRITE", "Academic Writing", 2, "A-R102", 25)
        # D: deliberately impossible because no alternative hall can fit 490 students.
        make_session("D-CEREMONY", "University Assembly", 3, "A-HALL", 490, False,
                     {"projector":1})
        fillers = [
            ("Algorithms", "B-LAB1", 34, True, {"computer":30}),
            ("Cloud Fundamentals", "C-LAB1", 38, True, {"computer":35}),
            ("Software Testing", "B-LAB2", 36, True, {"computer":30}),
            ("Technical Writing", "C-R101", 36, False, {"projector":1}),
            ("Data Analytics", "C-LAB2", 33, True, {"computer":30}),
            ("Project Management", "B-R101", 48, False, {"projector":1}),
            ("Statistics", "A-R101", 42, False, {"projector":1}),
            ("IoT Workshop", "A-LAB2", 32, True, {"computer":25}),
            ("User Experience", "B-LAB3", 31, True, {"computer":25}),
            ("Entrepreneurship", "C-HALL", 100, False, {"microphone":1}),
            ("Computer Security", "A-LAB1", 30, True, {"computer":25}),
            ("Networks II", "B-LAB1", 34, True, {"computer":25}),
            ("AI Foundations", "C-LAB1", 44, True, {"computer":40}),
            ("Web Development", "C-LAB2", 32, True, {"computer":25}),
            ("Intro Programming", "B-LAB2", 35, True, {"computer":30}),
            ("Human Computer Interaction", "C-R101", 39, False, {"projector":1}),
        ]
        for idx, (title, room, attendance, net, req) in enumerate(fillers, start=1):
            make_session(f"EX-{idx:02d}", title, 4 + (idx - 1) // 4,
                         room, attendance, net, req, hour=9 + 2 * ((idx - 1) % 4),
                         duration=2)

        incidents = [
            ("SCENARIO-A", "A · Internet lab room closure", "closure", "A-LAB1", None, None, None, 0),
            ("SCENARIO-B", "B · Building A network outage", "network", None, "A", None, None, 1),
            ("SCENARIO-C", "C · Projector unavailable", "equipment", "A-LAB1", None, "projector", 1, 2),
            ("SCENARIO-D", "D · No alternative large enough", "closure", "A-HALL", None, None, None, 3),
        ]
        for marker, title, kind, room_code, building_code, equipment, lost, day in incidents:
            if not db.scalar(select(Disruption).where(Disruption.title == title)):
                db.add(Disruption(title=title, kind=kind,
                    room_id=rooms[room_code].id if room_code else None,
                    building_id=buildings[building_code].id if building_code else None,
                    equipment_kind=equipment, quantity_lost=lost,
                    start_at=time(day, 8), end_at=time(day, 13), status="active"))
        # Exclude one candidate for Scenario B to demonstrate maintenance reasoning.
        room = rooms["B-LAB3"]
        if not db.scalar(select(Unavailability).where(Unavailability.room_id == room.id)):
            db.add(Unavailability(room_id=room.id, start_at=time(1, 8), end_at=time(1, 12),
                                  reason="Planned projector calibration"))
    print("Synthetic campus seed checked; existing records preserved.")

if __name__ == "__main__":
    seed()
