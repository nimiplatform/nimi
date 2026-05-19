use rusqlite::Connection;

#[path = "migrations_schema.rs"]
mod migrations_schema;
#[cfg(test)]
#[path = "migrations_tests.rs"]
mod migrations_tests;
#[path = "migrations_v10.rs"]
mod migrations_v10;
#[path = "migrations_v11.rs"]
mod migrations_v11;
#[path = "migrations_v12.rs"]
mod migrations_v12;
#[path = "migrations_v13.rs"]
mod migrations_v13;
#[path = "migrations_v14.rs"]
mod migrations_v14;
#[path = "migrations_v15.rs"]
mod migrations_v15;
#[path = "migrations_v16.rs"]
mod migrations_v16;
#[path = "migrations_v17.rs"]
mod migrations_v17;
#[path = "migrations_v18.rs"]
mod migrations_v18;
#[path = "migrations_v19.rs"]
mod migrations_v19;
#[path = "migrations_v20.rs"]
mod migrations_v20;
#[path = "migrations_v21.rs"]
mod migrations_v21;
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

use migrations_schema::V1_SCHEMA_SQL;
use migrations_v10::apply_v10;
use migrations_v11::apply_v11;
use migrations_v12::apply_v12;
use migrations_v13::apply_v13;
use migrations_v14::apply_v14;
use migrations_v15::apply_v15;
use migrations_v16::apply_v16;
use migrations_v17::apply_v17;
use migrations_v18::apply_v18;
use migrations_v19::apply_v19;
use migrations_v20::apply_v20;
use migrations_v21::apply_v21;
use migrations_v2::apply_v2;

#[cfg(test)]
pub(super) fn __test_only_apply_v16(conn: &Connection) -> Result<(), String> {
    apply_v16(conn)
}
use migrations_v3::apply_v3;
use migrations_v4::apply_v4;
use migrations_v5::apply_v5;
use migrations_v6::apply_v6;
use migrations_v7::apply_v7;
use migrations_v8::apply_v8;
use migrations_v9::apply_v9;

const SCHEMA_VERSION: u32 = 21;

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

    if current_version < 11 {
        apply_v11(conn)?;
        record_schema_version(conn, 11)?;
    }

    if current_version < 12 {
        apply_v12(conn)?;
        record_schema_version(conn, 12)?;
    }

    if current_version < 13 {
        apply_v13(conn)?;
        record_schema_version(conn, 13)?;
    }

    if current_version < 14 {
        apply_v14(conn)?;
        record_schema_version(conn, 14)?;
    }

    if current_version < 15 {
        apply_v15(conn)?;
        record_schema_version(conn, 15)?;
    }

    if current_version < 16 {
        apply_v16(conn)?;
        record_schema_version(conn, 16)?;
    }

    if current_version < 17 {
        apply_v17(conn)?;
        record_schema_version(conn, 17)?;
    }

    if current_version < 18 {
        apply_v18(conn)?;
        record_schema_version(conn, 18)?;
    }

    if current_version < 19 {
        apply_v19(conn)?;
        record_schema_version(conn, 19)?;
    }

    if current_version < 20 {
        apply_v20(conn)?;
        record_schema_version(conn, 20)?;
    }

    if current_version < 21 {
        apply_v21(conn)?;
        record_schema_version(conn, 21)?;
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
    apply_v11(conn)?;
    apply_v12(conn)?;
    apply_v13(conn)?;
    apply_v14(conn)?;
    apply_v15(conn)?;
    apply_v16(conn)?;
    apply_v17(conn)?;
    apply_v18(conn)?;
    apply_v19(conn)?;
    apply_v20(conn)?;
    apply_v21(conn)?;
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
