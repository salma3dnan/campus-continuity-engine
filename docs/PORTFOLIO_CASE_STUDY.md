# Engineering Case Study — Campus Continuity Engine

## 1. Problem and intended user

**Scenario:** A university lab is closed, the network goes down in one building, or a projector fails just before teaching. An administrator can identify which classes are affected, but manually searching other rooms often creates new conflicts.

**User:** A campus operations administrator who must keep scheduled classes running without changing their start/end times. Staff may review, while only administrators can change campus schedules.

**Success criterion:** Given a dated disruption, identify genuinely impacted sessions; show up to three full room-reassignment solutions satisfying every mandatory constraint, or explain why no complete solution exists; apply one administrator-approved plan atomically with an audit trail.

This is a **synthetic-data, single-campus MVP**. It is not a production university deployment.

## 2. Decision workflow

1. **Observe**: Browse a room-by-time schedule, inspect sessions, capacities and required facilities.
2. **Report**: Create a dated room/building closure, network incident or equipment loss.
3. **Diagnose**: Compute impacts from affected resources and overlapping class times. A network-independent class is not incorrectly classified as impacted by a network failure.
4. **Solve**: Check capacity, network, required equipment quantities, maintenance and preexisting bookings. Reject invalid rooms with concrete reasons.
5. **Compare**: Evaluate simultaneous room allocations by deterministic bounded backtracking. Show only complete conflict-free proposals, ranked by transparent soft preferences; display ties explicitly.
6. **Approve**: Administrator approves a plan; the API rechecks live constraints under ordered PostgreSQL locks. A GiST exclusion constraint independently prevents double booking.
7. **Verify**: The timetable shows the new room without time changes. Activity shows the approving actor (with guest identity masking), affected class name and before/after rooms.

### Main product screens

| Screen | What it solves | Real browser evidence |
|---|---|---|
| Login / registration | Staff self-service access, administrator-only writes | [Authentication](screenshots/redesign-login.png) |
| Timetable | Where every class happens and when | [Schedule](screenshots/redesign-timetable.png) |
| Recovery comparison | Complete alternatives, reasons and honest score ties | [Ranked options](screenshots/portfolio-ranked-options.png) |
| Approval history | Understand what changed and who approved it | [Human-readable audit](screenshots/portfolio-audit-history.png) |
| No-solution scenario | Explains why an oversized assembly cannot be reassigned | [No feasible solution](screenshots/redesign-no-solution.png) |

All screenshots were captured by Playwright in Google Chrome against the running application and PostgreSQL-backed API; no generated UI mockups were used.

## 3. Notable engineering decisions

### SQL integrity is stronger than UI checks

Booking conflicts are rejected twice: by deterministic feasibility checks, then by a PostgreSQL exclusion constraint on overlapping active room intervals. Approvals lock the shared incident first, followed by proposal/sessions/rooms to avoid deadlocks between competing approvers. An invalid or outdated proposal returns HTTP 409 without a partial schedule change.

### Multiple affected classes are solved together

The solver never chooses each session's replacement room in isolation. Two sessions at the same time cannot independently be assigned to the same available lab. The bounded exact solver returns at most three complete plans and refuses to claim optimality if its configured search limits are exceeded.

### Repeated searches do not generate duplicate suggestions

Searches reuse identical current proposals and retire obsolete pending alternatives by setting their status to **superseded**. The database rows and audit history remain intact; there is no destructive cleanup. Even if legacy duplicated proposals are present, the GET API shows at most three distinct current choices.

Concurrency tests verify that simultaneous generation requests share one unique set of proposals, not two duplicate sets.

### Explanations mean something

A candidate fails immediately if any mandatory condition is not met. Only valid candidates receive soft preference points:

- 100 base points per session
- +45 for staying in the same building
- minus a penalty for excess unused seats (capped at 40)
- minus a penalty for unnecessarily high quantities of required equipment (capped at 20)

These points are **not percentages or predictions**. Tied options are displayed as tied.

### Audit records remain verifiable and safe to view

An audit record stores stable actor/session/room IDs. The GET API enriches it with current class and room names. Authenticated administrators may see the account username; guest/staff viewers see a role label instead to avoid disclosing administrator login identifiers. The original unmodified JSON remains available under an expandable technical-details section.

## 4. Reproducibility and actual verification

| Layer | Tool | Latest verified result |
|---|---|---|
| API, algorithm, database and concurrency | Pytest + private PostgreSQL 18 test DB | **36 passed** |
| React and onboarding | Vitest + React Testing Library | **5 passed** |
| Portfolio polish read-only browser checks | Playwright + local Chrome | **2 passed** |
| Frontend production compilation | TypeScript + Vite | **Passed** |
| Local service verification | HTTP on ports 5173, 8000 and PostgreSQL 5440 | **Passed** |

The separate pre-polish browser suite previously passed **6 tests**; it was not rerun in full during this polish because its write scenarios create additional synthetic incidents and update the live demo data. The two new targeted checks are read-only against the preserved demonstration database. See [testing evidence](TESTING.md) for commands and limits.

Start and stop: use `scripts/start-campus.ps1` and `scripts/stop-campus.ps1` on the configured Windows development workstation. These use an isolated PostgreSQL cluster and do not require Docker or ChatGPT. Other machines need the prerequisites described in the [README](../README.md).

## 5. Constraints, tradeoffs and honest limitations

- Single dated sessions, not recurring timetables; only room reassignments, never time rescheduling.
- Maximum six simultaneously impacted sessions per incident and 25,000 solver nodes. Large institution-scale schedules need another optimization strategy.
- No actual campus integrations, hardware sensor feeds, external identity provider, password reset, or notification engine.
- Public read-only views and browser-local JWT storage are appropriate **only for the local portfolio demo**; production data, authentication and audit access need deployment-specific hardening.
- A synthetic seed has 3 buildings, 14 rooms, 24 sessions and four baseline incidents. Automated browser tests create additional synthetic history that is preserved, not silently deleted.
- Docker Compose packaging exists but could not be verified on the workstation due to Docker Desktop/registry failures. The Windows PostgreSQL 18 path is the tested route.
- The project uses **deterministic constraint solving, not generative AI or machine learning**.

## 6. Why this is useful in a portfolio

The interesting engineering is not the number of screens. It is the connection from a real scheduling problem to a safe, explainable, transactional recovery process. An internship reviewer can verify behavior directly: cause a disruption, inspect the affected sessions and rejected rooms, compare distinct alternatives, approve an action, and check the changed timetable plus readable audit.

The repository demonstrates frontend usability, typed API integration, SQL data modeling, transactional integrity, concurrency safety, access controls, reproducible tests and the ability to acknowledge limitations.
