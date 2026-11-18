"""Initial normalized schema and PostgreSQL double-booking protection.

Revision ID: 0001_initial
Revises:
"""
from alembic import op

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    statements = [
        """CREATE TABLE users (
            id SERIAL PRIMARY KEY, username VARCHAR(80) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) NOT NULL)""",
        """CREATE TABLE buildings (
            id SERIAL PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE,
            name VARCHAR(120) NOT NULL)""",
        """CREATE TABLE rooms (
            id SERIAL PRIMARY KEY, code VARCHAR(30) NOT NULL UNIQUE,
            building_id INTEGER NOT NULL REFERENCES buildings(id),
            capacity INTEGER NOT NULL CONSTRAINT room_capacity_positive CHECK(capacity > 0),
            network BOOLEAN NOT NULL)""",
        """CREATE TABLE room_equipment (
            id SERIAL PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
            kind VARCHAR(60) NOT NULL, quantity INTEGER NOT NULL
            CONSTRAINT equipment_nonnegative CHECK(quantity >= 0),
            CONSTRAINT uq_room_equipment UNIQUE(room_id, kind))""",
        """CREATE TABLE sessions (
            id SERIAL PRIMARY KEY, code VARCHAR(60) NOT NULL UNIQUE,
            title VARCHAR(160) NOT NULL,
            room_id INTEGER NOT NULL REFERENCES rooms(id),
            original_room_id INTEGER NOT NULL REFERENCES rooms(id),
            start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
            attendees INTEGER NOT NULL CONSTRAINT session_positive_attendees CHECK(attendees > 0),
            needs_network BOOLEAN NOT NULL, is_active BOOLEAN NOT NULL,
            CONSTRAINT session_valid_interval CHECK(end_at > start_at))""",
        """CREATE TABLE session_requirements (
            id SERIAL PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            kind VARCHAR(60) NOT NULL,
            quantity INTEGER NOT NULL CONSTRAINT requirement_positive CHECK(quantity > 0),
            CONSTRAINT uq_session_requirement UNIQUE(session_id, kind))""",
        """CREATE TABLE unavailability (
            id SERIAL PRIMARY KEY, room_id INTEGER NOT NULL REFERENCES rooms(id),
            start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
            reason VARCHAR(255) NOT NULL,
            CONSTRAINT maintenance_valid_interval CHECK(end_at > start_at))""",
        """CREATE TABLE disruptions (
            id SERIAL PRIMARY KEY, title VARCHAR(180) NOT NULL,
            kind VARCHAR(25) NOT NULL, room_id INTEGER REFERENCES rooms(id),
            building_id INTEGER REFERENCES buildings(id),
            equipment_kind VARCHAR(60), quantity_lost INTEGER,
            start_at TIMESTAMPTZ NOT NULL, end_at TIMESTAMPTZ NOT NULL,
            status VARCHAR(20) NOT NULL, created_by INTEGER REFERENCES users(id),
            CONSTRAINT disruption_valid_interval CHECK(end_at > start_at),
            CONSTRAINT disruption_kind_valid CHECK(kind IN ('closure','network','equipment')),
            CONSTRAINT disruption_target_required CHECK(room_id IS NOT NULL OR building_id IS NOT NULL),
            CONSTRAINT lost_quantity_positive CHECK(quantity_lost IS NULL OR quantity_lost > 0))""",
        """CREATE TABLE proposals (
            id SERIAL PRIMARY KEY, disruption_id INTEGER NOT NULL REFERENCES disruptions(id),
            status VARCHAR(20) NOT NULL, score INTEGER NOT NULL,
            details TEXT NOT NULL, generated_at TIMESTAMPTZ NOT NULL,
            approved_at TIMESTAMPTZ, approved_by INTEGER REFERENCES users(id))""",
        """CREATE TABLE proposed_assignments (
            id SERIAL PRIMARY KEY, proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            original_room_id INTEGER NOT NULL REFERENCES rooms(id),
            new_room_id INTEGER NOT NULL REFERENCES rooms(id),
            CONSTRAINT uq_proposal_session UNIQUE(proposal_id, session_id))""",
        """CREATE TABLE audit_events (
            id SERIAL PRIMARY KEY, occurred_at TIMESTAMPTZ NOT NULL,
            actor_id INTEGER REFERENCES users(id), action VARCHAR(60) NOT NULL,
            incident_id INTEGER REFERENCES disruptions(id),
            proposal_id INTEGER REFERENCES proposals(id),
            details TEXT NOT NULL)""",
        "CREATE INDEX ix_sessions_room_id ON sessions(room_id)",
        "CREATE INDEX ix_sessions_interval ON sessions(start_at, end_at)",
        "CREATE INDEX ix_disruptions_interval ON disruptions(start_at, end_at)",
        """ALTER TABLE sessions ADD CONSTRAINT no_active_room_overlap
            EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
            WHERE (is_active)"""
    ]
    for sql in statements:
        op.execute(sql)

def downgrade():
    for table in [
        "audit_events", "proposed_assignments", "proposals", "disruptions",
        "unavailability", "session_requirements", "sessions", "room_equipment",
        "rooms", "buildings", "users"
    ]:
        op.execute(f"DROP TABLE {table}")
