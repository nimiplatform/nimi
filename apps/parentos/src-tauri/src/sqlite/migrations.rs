use rusqlite::Connection;

#[path = "migrations_schema.rs"]
mod migrations_schema;
#[cfg(test)]
#[path = "migrations_tests.rs"]
mod migrations_tests;
#[path = "migrations_v2.rs"]
mod migrations_v2;
#[path = "migrations_v3.rs"]
mod migrations_v3;

use migrations_schema::V1_SCHEMA_SQL;
use migrations_v2::apply_v2;
use migrations_v3::apply_v3;

const SCHEMA_VERSION: u32 = 3;

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    ensure_schema_version_table(conn)?;

    let current_version = read_current_schema_version(conn)?;
    if current_version >= SCHEMA_VERSION {
        return Ok(());
    }

    if current_version < 1 {
        apply_v1(conn)?;
        record_schema_version(conn, 1)?;
    }

    if current_version < 2 {
        apply_v2(conn)?;
        record_schema_version(conn, 2)?;
    }

    if current_version < 3 {
        apply_v3(conn)?;
        record_schema_version(conn, 3)?;
    }

    Ok(())
}

fn ensure_schema_version_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _schema_version (
            version INTEGER NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("migration: failed to create _schema_version: {e}"))
}

fn read_current_schema_version(conn: &Connection) -> Result<u32, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
        [],
        |row| row.get(0),
    )
    .map_err(|e| format!("migration: failed to read schema version: {e}"))
}

fn record_schema_version(conn: &Connection, version: i64) -> Result<(), String> {
    conn.execute(
        "INSERT INTO _schema_version (version, applied_at) VALUES (?1, datetime('now'))",
        [&version],
    )
    .map_err(|e| format!("migration: failed to record v{version}: {e}"))?;
    Ok(())
}

fn apply_v1(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(V1_SCHEMA_SQL)
        .map_err(|e| format!("migration v1 failed: {e}"))
}
