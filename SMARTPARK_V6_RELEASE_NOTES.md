# SmartPark V6 — concurrency hardening

## Change
- PostgreSQL `pg_advisory_xact_lock(728461903)` is acquired before the slot/active-record reads in both `/api/checkin` and `/api/checkout`.
- The lock is held until the current transaction commits or rolls back. This serializes these two write paths across app workers and avoids two simultaneous check-ins claiming the same empty slot.
- SQLite retains existing behavior; this lock does not protect SQLite concurrent writers.
- No schema migration or data deletion is required for this change.

## Verification performed
- `python -m pytest -q test_smoke_isolated.py test_workflow_isolated.py test_postgres_parking_lock.py`: 10 passed (SQLite isolated tests and mock-based PostgreSQL SQL assertion).
- `python -m compileall -q app`: passed.
- `node --check node-chatbot/server.js`: passed.

## NOT verified
- Real PostgreSQL concurrent transactions, production Render deployment, real chatbot API, mobile UI, live payment integrations.
- Other code paths that directly mutate slot occupancy could require the same lock. Audit them before production rollout.

## Deployment safety
1. Take an independently verified PostgreSQL backup before deploying.
2. Restore backup into a separate test PostgreSQL instance.
3. Test two concurrent check-ins with the same slot and with auto slot selection; verify one succeeds and the other receives HTTP 409 (for a single-slot lot).
4. Test concurrent check-out and check-in; verify occupancy matches active records.
5. Deploy via reviewable PR; monitor error logs, active record counts, and database locks; do not merge automatically.
