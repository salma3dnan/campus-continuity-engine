# System Architecture

The Campus Continuity Engine is a **modular monolith**, not a microservice system. All scheduling decisions and approval protections happen in Python/PostgreSQL; the React frontend only presents data and submits authorized requests.

~~~mermaid
flowchart LR
  ADMIN[Campus administrator] --> UI[React + TypeScript]
  UI -->|Typed REST calls| API[FastAPI]
  API --> AUTH[JWT authorization]
  API --> IMPACT[Time-aware impact detection]
  API --> SOLVER[Deterministic bounded solver]
  API --> APPROVE[Transactional approval]
  AUTH --> DB[(PostgreSQL)]
  IMPACT --> DB
  SOLVER --> DB
  APPROVE --> DB
  DB -->|Constraints and locks| APPROVE
~~~

## Important modules

| Module | Purpose |
|---|---|
| frontend/src/App.tsx | Schedule-first workspace, room-by-time calendar, filtered cases, plan comparison, administrator actions and guest read-only mode |
| frontend/src/AuthScreen.tsx | Dedicated sign-in and registration screen; explore-as-guest entry |
| frontend/src/api.ts | Typed HTTP wrapper, account registration/session verification, bearer tokens and consistent error handling |
| frontend/src/types.ts | Client-side request/response contracts |
| backend/app/main.py | FastAPI validation, REST endpoints and response serialization |
| backend/app/security.py | Argon2 passwords, JWT, authenticated-account lookup and admin-only write dependency |
| backend/app/models.py | PostgreSQL ORM entity declarations |
| backend/app/engine.py | Disruption impact, room validity, explicit rejection reasons, multi-session search |
| backend/app/approval.py | Incident-first locking, live revalidation, atomic updates and audit |
| backend/app/seed.py | Idempotent synthetic campus fixtures |
| backend/alembic/versions/0001_initial.py | Normalized SQL schema and PostgreSQL booking exclusion constraint |
| scripts/*.ps1 | Private Windows database, persistent one-command startup, safe shutdown and test commands |

## Account roles and access

- Guests may explore the API-backed sample calendar without logging in.
- Staff may register themselves with an email/password. They receive a **staff** role enforced by the backend and read-only access; they cannot choose Admin during registration.
- Administrators use the locally seeded `.env` account to create incidents, generate plans and approve schedule changes. Every write is guarded by the server-side role dependency.
- The initial PostgreSQL `users` table already supported account roles, so onboarding required **no database reset or migration**.

## Execution steps

1. An administrator reports a disruption with start/end timestamps and targeted room or building.
2. The backend identifies overlapping sessions whose functional requirements are affected.
3. The solver evaluates every replacement room, recording hard-constraint violations.
4. Bounded backtracking jointly assigns new rooms to all impacted sessions; it rejects any assignment combination that reuses a room for overlapping classes.
5. Complete feasible plans are scored, sorted deterministically and persisted as pending proposals with original room IDs, scores and explanations.
6. Approval locks the shared incident first, then proposal, sessions by ascending ID and replacement rooms by ascending ID.
7. The approval service rechecks incident impact, room inventory, maintenance, active disruptions and bookings.
8. Inside the same PostgreSQL transaction it updates assigned rooms, marks the chosen plan approved, supersedes competitors and stores the original/new room pairs as an audit event.
9. PostgreSQL's exclusion constraint independently rejects double bookings, including when concurrent transactions race.

## Local topology

- React Vite UI: http://127.0.0.1:5173
- FastAPI: http://127.0.0.1:8000
- Isolated PostgreSQL 18: 127.0.0.1:5440
- Optional Docker Compose: Nginx web container → FastAPI container → PostgreSQL 16; currently **not verified** because of workstation Docker engine/registry issues.

Nothing in this architecture requires a paid cloud service or the user's other university projects.
