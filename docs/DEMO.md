# Reproducible Demonstration Guide

This is a fully synthetic miniature university. The idempotent seed creates **3 buildings, 14 rooms, 24 dated sessions and 4 baseline disruptions** on dates in February 2027. Times shown in the frontend are Malaysia time (Asia/Kuala_Lumpur). The sample data is intentionally future-dated so demonstrations do not collide with actual current university schedules.

## Start the demo

From the project root:

1. Start private PostgreSQL with scripts/start-postgres.ps1.
2. Start the API with scripts/start-backend.ps1. It runs Alembic and the non-destructive demo seed.
3. Start React with scripts/start-frontend.ps1.
4. Open http://127.0.0.1:5173.
5. Sign in using the administrator username/password stored in the local ignored .env file.
6. Open the Dashboard and verify the sessions and incidents are loaded from the API.

See README.md for exact PowerShell commands and Python/npm installation prerequisites.

## Scenario A — successful closure recovery

Baseline case: **A · Internet lab room closure**, 9 February 2027, Academic Block room A-LAB1. The **A-OS** laboratory session requires computers and network connectivity. The impact engine reports this class; it does **not** treat nearby unrelated rooms as affected.

1. In Recovery Planning, select scenario A and inspect the impact/reason.
2. Click **Generate recovery plans**.
3. Compare replacement room codes, hard-constraint rejections, same-building preference, spare capacity and per-assignment score.
4. Choose a pending plan and click **Approve & update schedule**.
5. Open Schedule. The class's room changes, **the class time remains unchanged**, and its original room remains visible.
6. Check Audit History for a recorded approval with original/new room IDs.

If scenario A has already been approved during testing, its class is no longer impacted. Use the incident form to close a different un-recovered lab on another date, or run browser test A; normal seeding will **not** erase approvals.

## Scenario B — multiple simultaneously affected classes

Baseline: **B · Building A network outage**, 10 February 2027.

- Network-dependent sessions **B-DB** and **B-NET** are impacted.
- **B-MATH** is physically inside Building A but does not require network connectivity, so it must **not** appear as impacted.
- Generated plans must include both affected classes, with compatible **nonconflicting** replacement rooms.
- The B-LAB3 candidate is under maintenance during this window; its rejection must be explained.

Run browser test B or inspect scenario B in Recovery Planning. Plans may be generated without approving them.

## Scenario C — equipment shortage and precise explanations

Baseline: **C · Projector unavailable**, 11 February 2027.

- **C-GRAPH** requires one projector in A-LAB1, but the incident reduces available projectors to zero.
- A class with no projector requirement must not become impacted merely because it is scheduled nearby.
- Generate alternatives, expand the **Score breakdown & rejected rooms** section, and inspect rejected rooms with missing projectors/computers or other hard constraints.

## Scenario D — no feasible complete solution

Baseline: **D · No alternative large enough**, 12 February 2027.

- The assembly **D-CEREMONY** has **490 participants** in A-HALL.
- All alternative rooms have lower capacity.
- The solver must return **zero complete plans** with explicit capacity-related rejection reasons.
- The UI must never offer an approval button for a partial recovery.

## Scenario E — stale proposal rejection

1. Report a new closure for a class, generate its recovery proposals, and note one proposed destination room.
2. Before approving, report a new closure that covers the **proposed destination room** over the class's time window.
3. Attempt to approve the stale proposal.
4. The API must return **HTTP 409**, and the UI must explain that approval was rejected.
5. Verify no class was partially reassigned, and that PostgreSQL has no double booking.

The Playwright test E automates this using additional synthetic events; it should not be run against live university data.

## Evidence locations

Successful browser tests save real Chrome screenshots to docs/screenshots/, including dashboard, impact, ranked alternatives, recovered schedule, network concurrency, equipment rejections, no-solution state and stale approval.

The PostgreSQL integration tests use a **separate** continuity_test database with independent fixtures and validate rollback, rejections, adjacent scheduling and concurrent approval. Consult docs/TESTING.md for actual evidence; do not substitute mock screenshots or invented counts.
