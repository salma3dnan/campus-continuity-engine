"""Campus Continuity Engine API; write operations require real admin authentication."""
import json
from datetime import datetime, timezone
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select, func, text
from sqlalchemy.orm import Session as DbSession
from .db import get_db
from .models import (
    User, Building, Room, RoomEquipment, Session, SessionRequirement,
    Disruption, Proposal, ProposedAssignment, AuditEvent
)
from .security import hasher, create_token, require_admin, require_user
from .engine import get_impacts, find_plans, SolverLimit
from .approval import approve

app = FastAPI(title="Campus Continuity Engine", version="1.0.0",
              description="Explainable constraint-based university disruption recovery")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                   allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])

class LoginPayload(BaseModel):
    username: str
    password: str

class RegistrationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=5, max_length=80, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
    password: str = Field(min_length=12, max_length=128)

class DisruptionInput(BaseModel):
    title: str = Field(min_length=4, max_length=180)
    kind: Literal["closure", "network", "equipment"]
    room_id: int | None = None
    building_id: int | None = None
    equipment_kind: str | None = None
    quantity_lost: int | None = Field(default=None, gt=0)
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def validate_incident(self):
        if (self.room_id is None) == (self.building_id is None):
            raise ValueError("Choose exactly one target: room or building")
        if not self.start_at.tzinfo or not self.end_at.tzinfo:
            raise ValueError("Timestamps must include a timezone offset")
        if self.start_at >= self.end_at:
            raise ValueError("End time must be after start time")
        if self.kind == "equipment":
            if self.room_id is None or not self.equipment_kind or self.quantity_lost is None:
                raise ValueError("Equipment incidents need room, type and quantity lost")
        elif self.equipment_kind is not None or self.quantity_lost is not None:
            raise ValueError("Only equipment incidents may specify lost equipment")
        return self

def iso(dt):
    return dt.isoformat() if dt else None

@app.get("/api/health")
def health(db: DbSession = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}

@app.post("/api/auth/register", status_code=201)
def register(data: RegistrationPayload, db: DbSession = Depends(get_db)):
    # Self-registration is read-only. Admin accounts are provisioned separately.
    email = data.username.strip().lower()
    if db.scalar(select(User.id).where(User.username == email)):
        raise HTTPException(status_code=409, detail="This email is already registered")
    account = User(username=email, password_hash=hasher.hash(data.password), role="staff")
    db.add(account)
    try:
        db.commit()
        db.refresh(account)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This email is already registered")
    return {"access_token": create_token(account), "token_type": "bearer",
            "username": account.username, "role": account.role}

@app.post("/api/auth/login")
def login(data: LoginPayload, db: DbSession = Depends(get_db)):
    username = data.username.strip()
    if "@" in username:
        username = username.lower()
    user = db.scalar(select(User).where(User.username == username))
    if not user or not hasher.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {"access_token": create_token(user), "token_type": "bearer",
            "username": user.username, "role": user.role}

@app.get("/api/auth/me")
def who_am_i(user: User = Depends(require_user)):
    return {"username": user.username, "role": user.role}

@app.get("/api/buildings")
def buildings(db: DbSession = Depends(get_db)):
    return [{"id": b.id, "code": b.code, "name": b.name} for b in db.scalars(
        select(Building).order_by(Building.code))]

@app.get("/api/rooms")
def rooms(db: DbSession = Depends(get_db)):
    equipment = {}
    for item in db.scalars(select(RoomEquipment)):
        equipment.setdefault(item.room_id, {})[item.kind] = item.quantity
    return [{"id": r.id, "code": r.code, "building_id": r.building_id,
             "capacity": r.capacity, "network": r.network,
             "equipment": equipment.get(r.id, {})}
            for r in db.scalars(select(Room).order_by(Room.code))]

@app.get("/api/sessions")
def sessions(db: DbSession = Depends(get_db), limit: int = Query(default=100, ge=1, le=200)):
    rooms_by_id = {r.id: r.code for r in db.scalars(select(Room))}
    return [{"id": s.id, "code": s.code, "title": s.title,
             "start_at": iso(s.start_at), "end_at": iso(s.end_at),
             "attendees": s.attendees, "needs_network": s.needs_network,
             "room_id": s.room_id, "room": rooms_by_id[s.room_id],
             "original_room_id": s.original_room_id,
             "original_room": rooms_by_id[s.original_room_id],
             "recovered": s.room_id != s.original_room_id}
            for s in db.scalars(select(Session).where(Session.is_active.is_(True)).order_by(
                Session.start_at, Session.id).limit(limit))]

@app.get("/api/disruptions")
def disruptions(db: DbSession = Depends(get_db)):
    return [serialize_incident(i) for i in db.scalars(
        select(Disruption).order_by(Disruption.id.desc()).limit(100))]

def serialize_incident(i):
    return {"id": i.id, "title": i.title, "kind": i.kind,
            "room_id": i.room_id, "building_id": i.building_id,
            "equipment_kind": i.equipment_kind, "quantity_lost": i.quantity_lost,
            "start_at": iso(i.start_at), "end_at": iso(i.end_at), "status": i.status}

@app.post("/api/disruptions", status_code=201)
def create_disruption(
    payload: DisruptionInput, admin: User = Depends(require_admin),
    db: DbSession = Depends(get_db)
):
    if payload.room_id is not None and not db.get(Room, payload.room_id):
        raise HTTPException(404, "Target room not found")
    if payload.building_id is not None and not db.get(Building, payload.building_id):
        raise HTTPException(404, "Target building not found")
    incident = Disruption(**payload.model_dump(), status="active", created_by=admin.id)
    db.add(incident)
    db.flush()
    db.add(AuditEvent(occurred_at=datetime.now(timezone.utc), actor_id=admin.id,
                      action="disruption_created", incident_id=incident.id,
                      details=json.dumps(payload.model_dump(mode="json"))))
    db.commit()
    return serialize_incident(incident)

@app.get("/api/disruptions/{incident_id}/impacts")
def impacts(incident_id: int, db: DbSession = Depends(get_db)):
    incident = db.get(Disruption, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    return get_impacts(db, incident)

def serialize_proposal(db, proposal):
    items = list(db.scalars(select(ProposedAssignment).where(
        ProposedAssignment.proposal_id == proposal.id).order_by(ProposedAssignment.session_id)))
    extra = json.loads(proposal.details)
    return {"id": proposal.id, "incident_id": proposal.disruption_id, "status": proposal.status,
            "score": proposal.score, "details": extra,
            "generated_at": iso(proposal.generated_at), "approved_at": iso(proposal.approved_at),
            "assignments": [{"session_id": a.session_id, "original_room_id": a.original_room_id,
                             "new_room_id": a.new_room_id} for a in items]}

@app.get("/api/disruptions/{incident_id}/recovery-plans")
def recovery_plans(incident_id: int, db: DbSession = Depends(get_db)):
    if not db.get(Disruption, incident_id):
        raise HTTPException(404, "Incident not found")
    proposals = list(db.scalars(select(Proposal).where(
        Proposal.disruption_id == incident_id).order_by(Proposal.score.desc(), Proposal.id.asc()).limit(30)))
    return [serialize_proposal(db, p) for p in proposals]

@app.post("/api/disruptions/{incident_id}/recovery-plans")
def generate_recovery(
    incident_id: int, admin: User = Depends(require_admin),
    db: DbSession = Depends(get_db)
):
    incident = db.get(Disruption, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    if incident.status != "active":
        raise HTTPException(409, "Incident is not active")
    try:
        results = find_plans(db, incident)
    except SolverLimit as e:
        raise HTTPException(422, str(e))
    created = []
    for plan in results["plans"]:
        details = {"score_breakdown": [a["score"] for a in plan["assignments"]],
                   "explanations": plan["assignments"],
                   "rejected": results["rejected"], "candidates": results["candidates"],
                   "message": results["message"]}
        proposal = Proposal(disruption_id=incident_id, status="pending", score=plan["score"],
                            details=json.dumps(details, sort_keys=True),
                            generated_at=datetime.now(timezone.utc))
        db.add(proposal)
        db.flush()
        for a in plan["assignments"]:
            db.add(ProposedAssignment(proposal_id=proposal.id, session_id=a["session_id"],
                                      original_room_id=a["old_room_id"],
                                      new_room_id=a["new_room_id"]))
        created.append(proposal)
    db.add(AuditEvent(occurred_at=datetime.now(timezone.utc), actor_id=admin.id,
                      action="recovery_generated", incident_id=incident_id,
                      details=json.dumps({"count": len(created), "message": results["message"]})))
    db.commit()
    return {"impacts": results["impacts"], "candidates": results["candidates"],
            "rejected": results["rejected"], "message": results["message"],
            "plans": [serialize_proposal(db, p) for p in created]}

@app.post("/api/recovery-plans/{proposal_id}/approve")
def approve_recovery(proposal_id: int, admin: User = Depends(require_admin)):
    return approve(proposal_id, admin.id)

@app.get("/api/audit-events")
def audit_events(db: DbSession = Depends(get_db), limit: int = Query(default=50, ge=1, le=200)):
    return [{"id": e.id, "occurred_at": iso(e.occurred_at), "action": e.action,
             "actor_id": e.actor_id, "incident_id": e.incident_id,
             "proposal_id": e.proposal_id, "details": json.loads(e.details)}
            for e in db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(limit))]

@app.get("/api/overview")
def overview(db: DbSession = Depends(get_db)):
    incidents = list(db.scalars(select(Disruption).where(Disruption.status == "active")))
    impacted = {i["session_id"] for d in incidents for i in get_impacts(db, d)}
    return {"active_disruptions": len(incidents), "affected_sessions": len(impacted),
            "pending_proposals": db.scalar(select(func.count(Proposal.id)).where(Proposal.status == "pending")),
            "approved_recoveries": db.scalar(select(func.count(Proposal.id)).where(Proposal.status == "approved")),
            "scheduled_sessions": db.scalar(select(func.count(Session.id)).where(Session.is_active.is_(True)))}
