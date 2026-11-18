# Test Execution and Verification Report

**Date:** 18 November 2026 (Asia/Kuala_Lumpur)
**Environment:** Windows 11 workstation, Python 3.14.7 in project-local virtual environment, Node.js 24.22, PostgreSQL 18.6 in project-private cluster, Chrome via Playwright.
**Status:** Updated schedule-first UI and staff onboarding verified locally on 19 November 2026; Docker Compose packaging remains unverified on this workstation.

## Latest verified revision — 19 November 2026

- **Backend / PostgreSQL:** 30/30 passed, including 8 registration/role-boundary tests in real isolated PostgreSQL.
- **React / Vitest:** 5/5 passed, covering separated login/registration, guest calendar, read-only staff, invalid login and password confirmation.
- **Chrome / Playwright:** 6/6 passed **together** (12.7 s), covering login portal, timetable calendar, real account registration + re-login, two-class network recovery comparison, a newly created closure with atomic approval, and a no-solution case.
- **Production React build:** succeeded (31 transformed modules).
- **Start/stop:** `start-campus.ps1` launched dedicated PostgreSQL/FastAPI/Vite without Docker and confirmed HTTP readiness; `stop-campus.ps1` stopped app ports 8000/5173 while keeping the private PostgreSQL port 5440; restarting reopened both services and Chrome.
- **Screenshots:** `docs/screenshots/redesign-*.png` are real Chrome screenshots, not generated artwork.

The original MVP baseline results below remain documented as historical evidence; they are not the latest test totals.

## Verified application endpoints

With scripts/start-postgres.ps1, scripts/start-backend.ps1 and scripts/start-frontend.ps1 running:

- GET http://127.0.0.1:8000/api/health → 200, database connected.
- GET http://127.0.0.1:8000/openapi.json → valid OpenAPI document, title "Campus Continuity Engine".
- GET http://127.0.0.1:8000/api/rooms → 14 stored rooms.
- GET http://127.0.0.1:8000/api/sessions → 24 stored sessions.
- GET http://127.0.0.1:8000/api/disruptions → 4 baseline incidents after initial seed, plus synthetic incidents created in browser tests.
- GET http://127.0.0.1:5173 → HTTP 200, actual React app served by Vite.

## Backend and PostgreSQL

Command:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-backend.ps1
~~~

**Original MVP baseline: 22 passed, 0 failed, 1 deprecation warning (9.16 s).** The updated backend suite now reports **30 passed**.

The warning is from the installed FastAPI/Starlette test client indicating upcoming httpx API changes. It does not represent a failed test. Tests use the isolated **continuity_test** database; an explicit guard prevents truncating another database.

Covered:
- Half-open time boundaries and adjacent sessions.
- Room closure, network and equipment outage impact detection, including network-independent sessions.
- Quantitative equipment, capacity and network constraints.
- Maintenance, active incident and existing-booking rejection reasons.
- Multiple competing classes, complete multi-session plans and deterministic ranking.
- Explicit no-solution outcomes.
- Input validation, authentication and protected write API.
- Proposal generation, persistence and score ordering.
- Atomic approval, audit history, duplicate approval and stale proposal rejection.
- PostgreSQL GiST exclusion constraint blocking overlapping active bookings.
- Real concurrent competing approvals without deadlock or double booking.

An early run found a **real concurrent approval deadlock**: proposal locks were acquired before the shared incident lock. The order was corrected to incident → proposal → sessions → rooms, then the full suite was rerun. An initially incorrect capacity-test fixture was also adjusted to assert a genuine undersized room.

## React build and component tests

Commands:

~~~powershell
cd frontend
npm.cmd run build
npm.cmd test -- --reporter=dot
~~~

**Original MVP baseline:** production TypeScript + Vite build passed (30 modules transformed), with **3 tests passed**. The redesigned interface now has **5 passing component tests** and a passing production build (31 modules).

Component tests cover rendering live API-shaped summary/schedule data, successful admin login and bearer token storage, and visible authentication failure with no token retained. A race where initial refresh could hide an authentication error was fixed. Browser tests cover the remaining critical UI interactions.

## Real Chrome end-to-end browser verification

Command:

~~~powershell
cd frontend
npm.cmd run test:e2e -- --workers=1 --reporter=line
~~~

Playwright uses installed **Google Chrome**, not a simulated browser or fake screenshots. After targeted defect corrections, the complete **original five-test Chrome suite passed in one run: 5 passed, 0 failed (8.6 s; total process runtime 10.90 s)**. All five scenarios were verified together:

| Browser scenario | Final recorded outcome |
|---|---|
| A — Login, create closure, detect impact, rank and approve, verify changed schedule | Passed |
| B — Network outage, two impacted classes, distinct conflict-free assigned rooms | Passed |
| C — Equipment unavailability and concrete rejection reasons | Passed |
| D — No complete feasible plan and explanatory UI state | Passed |
| E — New incident blocks proposed replacement; approval yields HTTP 409 and unchanged assignment | Passed |

The initial browser attempts identified test synchronization/locator problems and an ordering mismatch between persisted proposals and UI ranking. The test now waits for mutation completion, ties the stale blocker to the **exact visible plan**, and the backend returns stored proposals sorted by score.

Browser tests created **additional synthetic incidents** in the main demonstration database, which are preserved intentionally; they do not alter the fixed seed's 3 buildings, 14 rooms or 24 sessions.

## Live SQL integrity and seed verification

Command:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-db.ps1
~~~

Actual output after browser testing:

~~~text
Synthetic campus seed checked; existing records preserved.
SEED_IDEMPOTENT=True; buildings,rooms,sessions,incidents=3,14,24,14
ACTIVE_OVERLAPPING_BOOKINGS=0
POSTGRES_EXCLUSION_CONSTRAINT=1
ALEMBIC_VERSION=0001_initial
APPROVED_PLANS=3; RECOVERY_APPROVAL_AUDIT_EVENTS=3
DATABASE_INTEGRITY_OK
~~~

This verifies SQL integrity with **real local PostgreSQL**, not SQLite or mocks. The extra incidents are browser-generated synthetic records, not duplicated seed incidents.

## Genuine screenshots

Saved from actual Chrome runs under docs/screenshots/:

- dashboard.png
- recovery-impact.png
- ranked-recovery.png
- recovered-schedule.png
- multi-session-network.png
- equipment-rejections.png
- no-feasible-plan.png
- stale-approval.png

All eight image files exist and are nonempty. They depict actual API-backed React UI, not generated illustrations.

## Unverified infrastructure

Docker Desktop Linux engine returned **HTTP 500** for container listing/version requests; registry lookup also reported Docker Hub DNS failure when attempting new image builds. Therefore a complete Docker Compose build/run is **not claimed successful** on this workstation. The project-private PostgreSQL 18 + local Python/Vite workflow is the tested reproducible alternative.

No production performance benchmark, real-university deployment, public cloud run or long-term security audit was performed.
