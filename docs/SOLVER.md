# Recovery Solver: Constraints, Ranking and Safety

## Impact detection

Class intervals use the half-open interpretation **[start, end)**. The exact overlap predicate is:

~~~sql
session.start_at < disruption.end_at
AND session.end_at > disruption.start_at
~~~

- A room closure affects overlapping active sessions in its target room, or all rooms of the targeted building.
- A network outage affects **only** overlapping sessions that declare a network requirement.
- An equipment shortage affects a session only if its required quantity exceeds the remaining effective room inventory, considering all active equipment-loss incidents.
- After approval, sessions relocated away from an affected room are no longer counted as impacted by that room's closure.
- Maintenance windows and other active disruptions are independently evaluated for candidate rooms.

## Hard constraints

For a class, a candidate room is rejected if:
1. It is the original currently unusable room.
2. Its capacity is below student attendance.
3. Any required equipment type or quantity is missing.
4. A required network is absent or disrupted.
5. The room or its building is closed for any part of the class.
6. The room is under maintenance for any part of the class.
7. The room is already booked by another non-moving active class for overlapping time.
8. Two sessions within the proposed plan would occupy the same room simultaneously.
9. The class start/end time would change (the solver never changes timestamps).

Rejections are explicitly recorded, such as "Capacity 25 < attendance 35", "Insufficient computer: 24 available, 30 required", "Required network unavailable", or "Already booked for CS101". No preference can override these constraints.

## Exact bounded backtracking

The algorithm builds a candidate list for each impacted session, then recursively assigns replacement rooms. It searches **jointly**, rather than selecting the best room for each class independently.

1. Enumerate and validate candidate rooms, keeping rejection explanations.
2. If any session has zero candidates, return "no feasible complete recovery".
3. Order sessions by increasing number of candidates, breaking ties by time and ID (fail-first heuristic).
4. Explore candidates in descending preference score and room-code order.
5. Prune any branch with an overlap between two proposed assignments.
6. Evaluate each **complete** valid assignment; sort by descending summed score, breaking ties lexicographically by new room codes in session-ID order.
7. Return at most the three highest-scoring distinct complete solutions.

The search is exact if it finishes. The MVP includes two explicit safety bounds:
- Maximum impacted sessions in an incident: **6**.
- Maximum visited backtracking nodes: **25,000**.

When either is exceeded, the API returns an explicit 422 error; no incomplete search is described as optimal.

## Transparent soft score

For each session-to-room choice:

~~~text
score = 100
      + (45 if original and new room share a building else 0)
      - min(40, new_room.capacity - session.attendees)
      - min(20, 2 * excess_required_equipment_units)
~~~

For required equipment types only, **excess_required_equipment_units** is the sum of replacement inventory units above quantities required by that class. Scores prefer keeping a class in the same building, not wasting empty capacity and not consuming rooms with unnecessarily high quantities of required resources.

The overall plan score is the **sum** of its individual assignment scores; the UI displays the score breakdown. These are explanatory preferences, not empirical monetary or environmental savings.

## Idempotent proposal lifecycle

A user may press **Find available rooms** repeatedly. The API locks the disruption row before generating solutions and compares the freshly calculated assignment keys (session ID, original room ID and new room ID) against existing pending proposals.

- Identical feasible proposals are **reused**, not inserted again.
- Pending alternatives that no longer match current feasible results are marked **superseded** (not deleted).
- Legacy duplicate records remain available historically, while the current GET endpoint displays at most three distinct pending solutions.
- When a choice has become infeasible, approval still rechecks constraints under locks; a previously stored score is never authorization to write.
- A new audit generation event is written when the available set or its explanation actually changes, not merely because the same search button was pressed again.

The result cards explicitly label ties and explain each scoring bonus and penalty. Preference points are not probabilities or success rates.

## Safe approval

A pending proposal is not guaranteed to remain valid. Before updating the schedule:
- Lock the **shared incident row first**, then the proposal row (prevents approval deadlocks between competing plans).
- Lock the affected sessions and destination rooms in deterministic ID order.
- Recompute impact and verify the impacted session set did not change.
- Verify original rooms still match the proposal's stored assignments.
- Re-evaluate every constraint using live sessions, equipment inventory, maintenance windows and active disruptions.
- Apply **all** room changes, chosen-plan status update, competitor-plan supersession and audit details in **one database transaction**.
- PostgreSQL's GiST exclusion constraint rejects any overlapping active room occupancy independently of the solver.

An invalidated proposal returns HTTP **409 Conflict**; the entire transaction rolls back. Duplicate approvals also return 409. No approval is implemented only in the frontend.

## Explicit limitations

Search is bounded and cannot solve more than six impacted sessions in one incident. It does not reschedule class times, support recurring timetables, or optimize multi-day travel. Equipment/network states are derived from stored incidents; the demo has no physical sensor integration. The solver is deterministic and constraint-based, **not AI or ML**.
