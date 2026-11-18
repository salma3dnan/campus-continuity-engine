from datetime import datetime
from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text,
    UniqueConstraint, Index
)
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def utc_column():
    return mapped_column(DateTime(timezone=True), nullable=False)

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="admin")

class Building(Base):
    __tablename__ = "buildings"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))

class Room(Base):
    __tablename__ = "rooms"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)
    building_id: Mapped[int] = mapped_column(ForeignKey("buildings.id"))
    capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    network: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    __table_args__ = (CheckConstraint("capacity > 0", name="room_capacity_positive"),)

class RoomEquipment(Base):
    __tablename__ = "room_equipment"
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(60))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    __table_args__ = (
        UniqueConstraint("room_id", "kind", name="uq_room_equipment"),
        CheckConstraint("quantity >= 0", name="equipment_nonnegative"),
    )

class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(60), unique=True)
    title: Mapped[str] = mapped_column(String(160))
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), index=True)
    original_room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    start_at: Mapped[datetime] = utc_column()
    end_at: Mapped[datetime] = utc_column()
    attendees: Mapped[int] = mapped_column(Integer, nullable=False)
    needs_network: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    __table_args__ = (
        CheckConstraint("end_at > start_at", name="session_valid_interval"),
        CheckConstraint("attendees > 0", name="session_positive_attendees"),
        Index("ix_sessions_interval", "start_at", "end_at"),
    )

class SessionRequirement(Base):
    __tablename__ = "session_requirements"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(60))
    quantity: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("session_id", "kind", name="uq_session_requirement"),
        CheckConstraint("quantity > 0", name="requirement_positive"),
    )

class Unavailability(Base):
    __tablename__ = "unavailability"
    id: Mapped[int] = mapped_column(primary_key=True)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    start_at: Mapped[datetime] = utc_column()
    end_at: Mapped[datetime] = utc_column()
    reason: Mapped[str] = mapped_column(String(255))
    __table_args__ = (CheckConstraint("end_at > start_at", name="maintenance_valid_interval"),)

class Disruption(Base):
    __tablename__ = "disruptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    kind: Mapped[str] = mapped_column(String(25))
    room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id"), nullable=True)
    building_id: Mapped[int | None] = mapped_column(ForeignKey("buildings.id"), nullable=True)
    equipment_kind: Mapped[str | None] = mapped_column(String(60), nullable=True)
    quantity_lost: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_at: Mapped[datetime] = utc_column()
    end_at: Mapped[datetime] = utc_column()
    status: Mapped[str] = mapped_column(String(20), default="active")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    __table_args__ = (
        CheckConstraint("end_at > start_at", name="disruption_valid_interval"),
        CheckConstraint("kind IN ('closure','network','equipment')", name="disruption_kind_valid"),
        CheckConstraint("(room_id IS NOT NULL) OR (building_id IS NOT NULL)", name="disruption_target_required"),
        CheckConstraint("quantity_lost IS NULL OR quantity_lost > 0", name="lost_quantity_positive"),
    )

class Proposal(Base):
    __tablename__ = "proposals"
    id: Mapped[int] = mapped_column(primary_key=True)
    disruption_id: Mapped[int] = mapped_column(ForeignKey("disruptions.id"))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    score: Mapped[int] = mapped_column(Integer)
    details: Mapped[str] = mapped_column(Text)
    generated_at: Mapped[datetime] = utc_column()
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))

class ProposedAssignment(Base):
    __tablename__ = "proposed_assignments"
    id: Mapped[int] = mapped_column(primary_key=True)
    proposal_id: Mapped[int] = mapped_column(ForeignKey("proposals.id", ondelete="CASCADE"))
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    original_room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    new_room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"))
    __table_args__ = (UniqueConstraint("proposal_id", "session_id", name="uq_proposal_session"),)

class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = utc_column()
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(60))
    incident_id: Mapped[int | None] = mapped_column(ForeignKey("disruptions.id"))
    proposal_id: Mapped[int | None] = mapped_column(ForeignKey("proposals.id"))
    details: Mapped[str] = mapped_column(Text)
