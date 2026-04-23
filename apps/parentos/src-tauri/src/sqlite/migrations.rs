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
#[path = "migrations_v4.rs"]
mod migrations_v4;
#[path = "migrations_v5.rs"]
mod migrations_v5;
#[path = "migrations_v6.rs"]
mod migrations_v6;
#[path = "migrations_v7.rs"]
mod migrations_v7;
#[path = "migrations_v8.rs"]
mod migrations_v8;
#[path = "migrations_v9.rs"]
mod migrations_v9;
#[path = "migrations_v10.rs"]
mod migrations_v10;

use migrations_schema::V1_SCHEMA_SQL;
use migrations_v2::apply_v2;
use migrations_v3::apply_v3;
use migrations_v4::apply_v4;
use migrations_v5::apply_v5;
use migrations_v6::apply_v6;
use migrations_v7::apply_v7;
use migrations_v8::apply_v8;
use migrations_v9::apply_v9;
use migrations_v10::apply_v10;

const SCHEMA_VERSION: u32 = 10;

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    ensure_schema_version_table(conn)?;

    let current_version = read_current_schema_version(conn)?;
    if current_version >= SCHEMA_VERSION {
        repair_missing_tables(conn)?;
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

    if current_version < 4 {
        apply_v4(conn)?;
        record_schema_version(conn, 4)?;
    }

    if current_version < 5 {
        apply_v5(conn)?;
        record_schema_version(conn, 5)?;
    }

    if current_version < 6 {
        apply_v6(conn)?;
        record_schema_version(conn, 6)?;
    }

    if current_version < 7 {
        apply_v7(conn)?;
        record_schema_version(conn, 7)?;
    }

    if current_version < 8 {
        apply_v8(conn)?;
        record_schema_version(conn, 8)?;
    }

    if current_version < 9 {
        apply_v9(conn)?;
        record_schema_version(conn, 9)?;
    }

    if current_version < 10 {
        apply_v10(conn)?;
        record_schema_version(conn, 10)?;
    }

    repair_missing_tables(conn)?;

    Ok(())
}

fn repair_missing_tables(conn: &Connection) -> Result<(), String> {
    // Some pre-release local databases were stamped with a newer schema version
    // before the full set of idempotent table definitions had landed. Re-run the
    // current CREATE TABLE / CREATE INDEX blocks so existing installs can self-heal
    // even when they are already marked at the latest schema version.
    // Order matters here: older reminder_states tables can be missing the v3
    // columns that newer v1 repair indexes reference. Hydrate those columns first,
    // then replay the broad CREATE TABLE / CREATE INDEX definitions.
    apply_v3(conn)?;
    apply_v2(conn)?;
    apply_v1(conn)?;
    apply_v4(conn)?;
    apply_v5(conn)?;
    apply_v6(conn)?;
    apply_v7(conn)?;
    apply_v8(conn)?;
    apply_v9(conn)?;
    apply_v10(conn)?;
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
