"""Transaction-level approval with row locks and PostgreSQL exclusion safety."""
import json
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from .db import SessionLocal
from .models import Proposal, ProposedAssignment, Session, Room, Disruption, AuditEvent
from .engine import get_impacts, verify_assignments

def approve(proposal_id: int, actor_id: int):
    try:
        with SessionLocal.begin() as db:
            # Lock the shared incident BEFORE either competing proposal.
            # Otherwise one approval can hold proposal A while waiting for B
            # and another approval holds B while waiting for the incident.
            incident_id = db.scalar(select(Proposal.disruption_id).where(
                Proposal.id == proposal_id
            ))
            if incident_id is None:
                raise HTTPException(404, "Proposal not found")
            incident = db.scalar(select(Disruption).where(
                Disruption.id == incident_id
            ).with_for_update())
            proposal = db.scalar(select(Proposal).where(
                Proposal.id == proposal_id
            ).with_for_update())
            if not proposal:
                raise HTTPException(404, "Proposal not found")
            if proposal.status != "pending":
                raise HTTPException(409, f"Proposal is {proposal.status}, not pending")
            if not incident or incident.status != "active":
                raise HTTPException(409, "Incident is no longer active")
            proposed = list(db.scalars(select(ProposedAssignment).where(
                ProposedAssignment.proposal_id == proposal_id
            ).order_by(ProposedAssignment.session_id)))
            if not proposed:
                raise HTTPException(409, "Empty proposal cannot be approved")

            session_ids = [a.session_id for a in proposed]
            # Consistent lock order prevents competing approvals from interleaving writes.
            sessions = list(db.scalars(select(Session).where(
                Session.id.in_(session_ids)
            ).order_by(Session.id).with_for_update()))
            room_ids = sorted({a.new_room_id for a in proposed})
            list(db.scalars(select(Room).where(
                Room.id.in_(room_ids)
            ).order_by(Room.id).with_for_update()))
            current = {s.id: s for s in sessions}
            if len(current) != len(proposed):
                raise HTTPException(409, "One or more sessions were deleted")
            for a in proposed:
                if current[a.session_id].room_id != a.original_room_id:
                    raise HTTPException(409, f"{current[a.session_id].code} changed rooms after generation")
            # An incident may have been resolved, moved, or changed since generation.
            now_impacted = {x["session_id"] for x in get_impacts(db, incident)}
            if set(session_ids) != now_impacted:
                raise HTTPException(409, "Incident impact changed: regenerate recovery plans")
            pairs = [(a.session_id, a.new_room_id) for a in proposed]
            error = verify_assignments(db, pairs)
            if error:
                raise HTTPException(409, f"Plan is no longer feasible: {error}")
            changes = []
            for a in proposed:
                current[a.session_id].room_id = a.new_room_id
                changes.append({"session_id": a.session_id,
                                "from_room": a.original_room_id, "to_room": a.new_room_id})
            # Flush triggers PostgreSQL EXCLUDE checking before declaring success.
            db.flush()
            proposal.status = "approved"
            proposal.approved_by = actor_id
            proposal.approved_at = datetime.now(timezone.utc)
            db.execute(update(Proposal).where(
                Proposal.disruption_id == incident.id, Proposal.id != proposal_id,
                Proposal.status == "pending"
            ).values(status="superseded"))
            db.add(AuditEvent(
                occurred_at=datetime.now(timezone.utc), actor_id=actor_id,
                action="recovery_approved", incident_id=incident.id, proposal_id=proposal.id,
                details=json.dumps(changes, sort_keys=True)
            ))
            return {"status": "approved", "proposal_id": proposal.id,
                    "incident_id": incident.id, "changes": changes}
    except IntegrityError:
        # Transaction context manager rolls back ALL assignments.
        raise HTTPException(409, "Database booking conflict: no schedule changes applied")
    except OperationalError as exc:
        # Only known PostgreSQL concurrency conflicts are client-visible 409s.
        # An unexpected database outage remains an operational error.
        if getattr(exc.orig, "sqlstate", None) in {"40P01", "40001"}:
            raise HTTPException(409, "Concurrent schedule update detected; regenerate plans")
        raise
