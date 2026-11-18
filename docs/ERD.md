# Database ERD and Integrity Rules

Schema is created by the Alembic migration in backend/alembic/versions/0001_initial.py. Primary and foreign keys are stored in PostgreSQL (not inferred from frontend arrays).

~~~mermaid
erDiagram
  USERS ||--o{ DISRUPTIONS : creates
  USERS ||--o{ PROPOSALS : approves
  USERS ||--o{ AUDIT_EVENTS : acts
  BUILDINGS ||--o{ ROOMS : contains
  BUILDINGS ||--o{ DISRUPTIONS : targeted_by
  ROOMS ||--o{ ROOM_EQUIPMENT : inventory
  ROOMS ||--o{ SESSIONS : currently_hosts
  ROOMS ||--o{ SESSIONS : originally_hosts
  ROOMS ||--o{ UNAVAILABILITY : maintenance
  ROOMS ||--o{ DISRUPTIONS : targeted_by
  SESSIONS ||--o{ SESSION_REQUIREMENTS : needs
  DISRUPTIONS ||--o{ PROPOSALS : has_options
  DISRUPTIONS ||--o{ AUDIT_EVENTS : logged_by
  PROPOSALS ||--o{ PROPOSED_ASSIGNMENTS : assigns
  PROPOSALS ||--o{ AUDIT_EVENTS : logged_by
  SESSIONS ||--o{ PROPOSED_ASSIGNMENTS : moved_by
  ROOMS ||--o{ PROPOSED_ASSIGNMENTS : original_or_new
  USERS {
    int id PK
    varchar username UK
    varchar password_hash
    varchar role
  }
  BUILDINGS {
    int id PK
    varchar code UK
    varchar name
  }
  ROOMS {
    int id PK
    int building_id FK
    varchar code UK
    int capacity
    boolean network
  }
  ROOM_EQUIPMENT {
    int id PK
    int room_id FK
    varchar kind
    int quantity
  }
  SESSIONS {
    int id PK
    int room_id FK
    int original_room_id FK
    varchar code UK
    timestamptz start_at
    timestamptz end_at
    int attendees
    boolean needs_network
    boolean is_active
  }
  SESSION_REQUIREMENTS {
    int id PK
    int session_id FK
    varchar kind
    int quantity
  }
  UNAVAILABILITY {
    int id PK
    int room_id FK
    timestamptz start_at
    timestamptz end_at
    varchar reason
  }
  DISRUPTIONS {
    int id PK
    int room_id FK
    int building_id FK
    int created_by FK
    varchar kind
    varchar status
    varchar equipment_kind
    int quantity_lost
    timestamptz start_at
    timestamptz end_at
  }
  PROPOSALS {
    int id PK
    int disruption_id FK
    int approved_by FK
    varchar status
    int score
    text details
    timestamptz generated_at
    timestamptz approved_at
  }
  PROPOSED_ASSIGNMENTS {
    int id PK
    int proposal_id FK
    int session_id FK
    int original_room_id FK
    int new_room_id FK
  }
  AUDIT_EVENTS {
    int id PK
    int actor_id FK
    int incident_id FK
    int proposal_id FK
    varchar action
    timestamptz occurred_at
    text details
  }
~~~

## Main constraints and cardinalities

- One building has many rooms. Rooms belong to one building.
- Each active dated session occupies one current room and keeps its original room reference.
- A room has many equipment rows, unique by (room_id, kind).
- A session has multiple required equipment rows, unique by (session_id, kind).
- A disruption targets a room **or** a building, with foreign keys to both possible entity types.
- A disruption may have many recovery proposals, each with multiple proposed session-room assignments. Each proposal/session pair is unique.
- Users create disruptions and authorize approvals. Audit events reference the actor and related incident/proposal.
- Positive attendance, capacity, equipment quantities and interval ordering are enforced with SQL CHECK constraints.

## Critical booking invariant

The migration enables the PostgreSQL extension **btree_gist**, then creates:

~~~sql
ALTER TABLE sessions ADD CONSTRAINT no_active_room_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (is_active);
~~~

This prevents two active classes occupying the same room for overlapping intervals, **even under concurrent requests**. Adjacent sessions are allowed. The constraint is independent of application-level checks.

## Data types and time zone

All incident, class, maintenance, proposal and audit timestamps use TIMESTAMPTZ. PostgreSQL compares absolute timestamps; the UI formats dates for Asia/Kuala_Lumpur. The local PostgreSQL cluster may display its session timezone as Kuala Lumpur; the stored instant is not a naive timestamp.
