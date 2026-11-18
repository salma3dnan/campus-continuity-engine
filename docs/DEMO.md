# Reproducible Demonstration Guide

This is a fully synthetic miniature university. The idempotent seed creates **3 buildings, 14 rooms, 24 dated sessions and 4 baseline disruptions** on dates in February 2027. Times shown in the frontend are Malaysia time (Asia/Kuala_Lumpur). The sample data is intentionally future-dated so demonstrations do not collide with actual current university schedules.

## Start the demo

From the project root:

1. From the project root, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-campus.ps1`. It starts PostgreSQL, FastAPI and React and opens Chrome.
2. On the dedicated login page, select **Explore sample timetable** for read-only access, or **Create a staff account** for an email/password-based staff login. Staff accounts cannot approve changes.
3. For full administrator recovery actions, sign in using `DEMO_ADMIN_USERNAME` and `DEMO_ADMIN_PASSWORD` from the ignored local `.env` file.
4. Open **Timetable** and inspect the room-by-time schedule. Select a class to view its current room and requirements.
5. To stop the app without deleting data, use `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-campus.ps1`.

See README.md for exact PowerShell commands and Python/npm installation prerequisites.

## Product-quality checks (2026-11-19)

- Open **Recovery plans** for **B · Building A network outage**. The current API shows up to **three different** room-assignment plans, even if earlier browser runs left duplicate pending records.
- If the top two plans have the same score, both are marked **TIED · RANK 1**. Open **Why these rooms?** to see the 100-point base, same-building bonus, unused-seat penalty and excess-equipment penalty.
- Pressing **Find available rooms** again with unchanged conditions reuses the same proposal IDs, rather than filling the queue with identical plans. Test this on `continuity_test` if you do not want to modify live demo proposal statuses.
- Open **Activity**. An approval displays a single timestamp and a readable before/after class-room change. Try the **Approvals only** filter. Guest view masks the administrator's username.
- For **D · No alternative large enough**, a completed unsuccessful search explicitly states **no valid full reassignment**, with rejection details; it must not present an approval button.

## Scenario A — successful closure recovery

Baseline case: **A · Internet lab room closure**, 9 February 2027, Academic Block room A-LAB1. The **A-OS** laboratory session requires computers and network connectivity. The impact engine reports this class; it does **not** treat nearby unrelated rooms as affected.

1. In **Recovery plans**, select scenario A and inspect the impact/reason.
2. Click **Find available rooms**.
3. Compare replacement room codes, hard-constraint rejections, same-building preference, spare capacity and per-assignment score.
4. Choose a pending plan and click **Approve this plan**.
5. Open **Timetable**. The class's room changes, **the class time remains unchanged**, and its original room remains visible.
6. Check **Activity** for a recorded approval with original/new room IDs.

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
- Generate alternatives, expand **Why these rooms? View scores and rejections**, and inspect rejected rooms with missing projectors/computers or other hard constraints.

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
