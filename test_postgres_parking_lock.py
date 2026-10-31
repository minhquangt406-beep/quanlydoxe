"""Unit tests for PostgreSQL transaction-scoped parking lock (no live DB)."""
from unittest.mock import Mock
from app.main import lock_parking_operation


def test_postgres_uses_transaction_scoped_advisory_lock():
    db = Mock()
    db.get_bind.return_value.dialect.name = "postgresql"
    lock_parking_operation(db)
    db.execute.assert_called_once()
    assert "pg_advisory_xact_lock" in str(db.execute.call_args.args[0])


def test_sqlite_does_not_execute_postgres_sql():
    db = Mock()
    db.get_bind.return_value.dialect.name = "sqlite"
    lock_parking_operation(db)
    db.execute.assert_not_called()
