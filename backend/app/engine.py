"""Deterministic, explainable, bounded exact room reassignment.

All time ranges are half-open. Solutions move rooms only, not session times.
"""
from collections import defaultdict
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from .models import (
    Room, Session, SessionRequirement, RoomEquipment, Unavailability, Disruption
)

MAX_IMPACTED = 6
MAX_SEARCH_NODES = 25000

class SolverLimit(Exception):
    pass

def overlaps(a_start, a_end, b_start, b_end):
    return a_start < b_end and a_end > b_start

def affects_room(disruption, room):
    return (disruption.room_id == room.id if disruption.room_id is not None
            else disruption.building_id == room.building_id)

def active_disruptions(db, start_at, end_at):
    return list(db.scalars(select(Disruption).where(
        Disruption.status == "active",
        Disruption.start_at < end_at, Disruption.end_at > start_at
    )))

def requirements(db, session_id):
    return {r.kind: r.quantity for r in db.scalars(
        select(SessionRequirement).where(SessionRequirement.session_id == session_id)
    )}

def inventory(db, room_id):
    return {e.kind: e.quantity for e in db.scalars(
        select(RoomEquipment).where(RoomEquipment.room_id == room_id)
    )}

def effective_resources(db, room, session):
    equipment = inventory(db, room.id)
    network = room.network
    closed = False
    notes = []
    for incident in active_disruptions(db, session.start_at, session.end_at):
        if not affects_room(incident, room):
            continue
        if incident.kind == "closure":
            closed = True
            notes.append(f"Room closed by incident #{incident.id}")
        elif incident.kind == "network":
            network = False
            notes.append(f"Network unavailable from incident #{incident.id}")
        elif incident.kind == "equipment" and incident.equipment_kind:
            kind = incident.equipment_kind
            equipment[kind] = max(0, equipment.get(kind, 0) - (incident.quantity_lost or 0))
            notes.append(f"{kind} reduced by incident #{incident.id}")
    return closed, network, equipment, notes

def get_impacts(db: DbSession, incident: Disruption):
    rooms = {r.id: r for r in db.scalars(select(Room))}
    results = []
    sessions = db.scalars(select(Session).where(
        Session.is_active.is_(True), Session.start_at < incident.end_at,
        Session.end_at > incident.start_at
    )).all()
    for session in sessions:
        room = rooms[session.room_id]
        if not affects_room(incident, room):
            continue
        reason = None
        if incident.kind == "closure":
            reason = f"{room.code} is closed during the class time"
        elif incident.kind == "network" and session.needs_network:
            reason = "Class requires network service unavailable at its current room"
        elif incident.kind == "equipment" and incident.equipment_kind:
            need = requirements(db, session.id).get(incident.equipment_kind, 0)
            if need > 0:
                _, _, available, _ = effective_resources(db, room, session)
                if available.get(incident.equipment_kind, 0) < need:
                    reason = (f"Requires {need} {incident.equipment_kind}; "
                              f"only {available.get(incident.equipment_kind, 0)} available")
        if reason:
            results.append({
                "session_id": session.id, "code": session.code,
                "title": session.title, "original_room_id": session.room_id,
                "original_room": room.code, "reason": reason,
                "incident_id": incident.id,
                "start_at": session.start_at.isoformat(),
                "end_at": session.end_at.isoformat()
            })
    return sorted(results, key=lambda i: (i["start_at"], i["session_id"]))

def reject_reasons(db, session, room, moving_ids):
    reasons = []
    if room.id == session.room_id:
        reasons.append("Original affected room cannot be reused")
    if room.capacity < session.attendees:
        reasons.append(f"Capacity {room.capacity} < attendance {session.attendees}")
    closed, network, equipment, incident_notes = effective_resources(db, room, session)
    if closed:
        reasons.append("Room closed by active disruption")
    if session.needs_network and not network:
        reasons.append("Required network unavailable")
    for kind, quantity in sorted(requirements(db, session.id).items()):
        available = equipment.get(kind, 0)
        if available < quantity:
            reasons.append(f"Insufficient {kind}: {available} available, {quantity} required")
    for maint in db.scalars(select(Unavailability).where(
        Unavailability.room_id == room.id, Unavailability.start_at < session.end_at,
        Unavailability.end_at > session.start_at
    )):
        reasons.append(f"Under maintenance: {maint.reason}")
    other = db.scalar(select(Session).where(
        Session.room_id == room.id, Session.is_active.is_(True),
        Session.start_at < session.end_at, Session.end_at > session.start_at,
        Session.id.not_in(moving_ids)
    ).limit(1))
    if other:
        reasons.append(f"Already booked for {other.code}")
    return reasons

def room_score(original_room, room, session, db):
    same_building = 45 if original_room.building_id == room.building_id else 0
    capacity_fit = -min(40, room.capacity - session.attendees)
    inventory_surplus = inventory(db, room.id)
    extras = sum(max(0, inventory_surplus.get(k, 0) - q)
                 for k, q in requirements(db, session.id).items())
    resource_fit = -min(20, extras * 2)
    return {
        "same_building": same_building,
        "unused_capacity": capacity_fit,
        "excess_equipment": resource_fit,
        "total": 100 + same_building + capacity_fit + resource_fit
    }

def find_plans(db, incident):
    impact = get_impacts(db, incident)
    if not impact:
        return {"impacts": [], "candidates": {}, "rejected": {}, "plans": [],
                "message": "No sessions require recovery for this incident"}
    if len(impact) > MAX_IMPACTED:
        raise SolverLimit(f"{len(impact)} impacted sessions exceeds safety limit {MAX_IMPACTED}")
    sessions = [db.get(Session, i["session_id"]) for i in impact]
    moving_ids = [s.id for s in sessions]
    rooms = list(db.scalars(select(Room).order_by(Room.code)))
    room_by_id = {r.id: r for r in rooms}
    candidates, rejected = {}, {}
    for s in sessions:
        allowed, denied = [], []
        for r in rooms:
            reasons = reject_reasons(db, s, r, moving_ids)
            if reasons:
                denied.append({"room_id": r.id, "room": r.code, "reasons": reasons})
            else:
                allowed.append({"room_id": r.id, "room": r.code,
                                "score": room_score(room_by_id[s.room_id], r, s, db)})
        candidates[s.id] = sorted(allowed, key=lambda c: (-c["score"]["total"], c["room"]))
        rejected[s.id] = denied
    if any(not candidates[s.id] for s in sessions):
        return {"impacts": impact, "candidates": candidates, "rejected": rejected,
                "plans": [], "message": "At least one affected session has no feasible replacement room"}
    search_order = sorted(sessions, key=lambda s: (len(candidates[s.id]), s.start_at, s.id))
    solutions, chosen = [], {}
    nodes = 0

    def walk(idx):
        nonlocal nodes
        nodes += 1
        if nodes > MAX_SEARCH_NODES:
            raise SolverLimit(f"Search exceeded {MAX_SEARCH_NODES} nodes; no optimality claim made")
        if idx == len(search_order):
            ordered = sorted(sessions, key=lambda s: s.id)
            assignment = [{"session_id": s.id, "code": s.code,
                           "old_room_id": s.room_id, "old_room": room_by_id[s.room_id].code,
                           "new_room_id": chosen[s.id]["room_id"], "new_room": chosen[s.id]["room"],
                           "score": chosen[s.id]["score"]} for s in ordered]
            solutions.append({"score": sum(a["score"]["total"] for a in assignment),
                              "assignments": assignment})
            return
        s = search_order[idx]
        for candidate in candidates[s.id]:
            if any(chosen[prior.id]["room_id"] == candidate["room_id"] and
                   overlaps(s.start_at, s.end_at, prior.start_at, prior.end_at)
                   for prior in search_order[:idx]):
                continue
            chosen[s.id] = candidate
            walk(idx + 1)
            del chosen[s.id]

    walk(0)
    solutions.sort(key=lambda p: (-p["score"], tuple(a["new_room"] for a in p["assignments"])))
    message = "Feasible complete recovery plans" if solutions else (
        "Rooms are feasible individually but simultaneous assignments conflict")
    return {"impacts": impact, "candidates": candidates, "rejected": rejected,
            "plans": solutions[:3], "message": message}

def verify_assignments(db, pairs):
    """Recheck every candidate under a transaction before any write."""
    sessions = {s.id: s for s in db.scalars(select(Session).where(
        Session.id.in_([sid for sid, _ in pairs])
    ))}
    all_ids = list(sessions)
    if len(sessions) != len(pairs) or len(set(sid for sid, _ in pairs)) != len(pairs):
        return "One or more sessions no longer exist or are duplicated"
    for sid, rid in pairs:
        s = sessions[sid]
        room = db.get(Room, rid)
        if not room or not s.is_active:
            return f"Session {sid} or room {rid} is unavailable"
        reasons = reject_reasons(db, s, room, all_ids)
        if reasons:
            return f"{s.code}: {'; '.join(reasons)}"
    for i, (sid, rid) in enumerate(pairs):
        for other_sid, other_rid in pairs[i + 1:]:
            if rid == other_rid and overlaps(
                sessions[sid].start_at, sessions[sid].end_at,
                sessions[other_sid].start_at, sessions[other_sid].end_at
            ):
                return f"Assignments for {sessions[sid].code} and {sessions[other_sid].code} overlap"
    return None
