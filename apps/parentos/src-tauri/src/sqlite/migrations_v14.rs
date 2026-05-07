use std::collections::HashSet;

use rusqlite::Connection;

/// Schema v14: extend `orthodontic_appliances` with clear-aligner per-tray
/// schedule fields admitted by `orthodontic-contract.md#PO-ORTHO-003`.
///
/// Adds two nullable columns:
///
/// - `totalAligners`   INTEGER — total tray count in the prescribed series
/// - `daysPerAligner`  INTEGER — prescribed wear days per tray before switching
///
/// Both columns are clear-aligner-only at the command layer; at the storage
/// layer they are plain nullable INTEGER so other applianceTypes leave them
/// NULL.
///
/// Idempotency: each ALTER is guarded by a `PRAGMA table_info` probe so
/// `repair_missing_tables` replays are safe on pre-stamped databases.
///
/// Literal ALTER strings are kept here rather than constructed at runtime so
/// that the spec-consistency check can scan this source file and confirm every
/// local-storage.yaml column has a matching migration.
pub(super) fn apply_v14(conn: &Connection) -> Result<(), String> {
    // `orthodontic_appliances` is created by migration v9. On a broken-install
    // repair path the stamped schema version can jump over v9, so the table
    // may not yet exist here; `repair_missing_tables` will call us again after
    // v9 has (idempotently) created it. Skip the ALTER in that case.
    if !orthodontic_appliances_table_exists(conn)? {
        return Ok(());
    }
    let existing = existing_orthodontic_appliances_columns(conn)?;
    for (column, sql) in ADD_COLUMN_STATEMENTS {
        if existing.contains(*column) {
            continue;
        }
        conn.execute(sql, []).map_err(|e| {
            format!("migration v14 add orthodontic_appliances.{column} failed: {e}")
        })?;
    }
    Ok(())
}

fn orthodontic_appliances_table_exists(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='orthodontic_appliances'",
        [],
        |_| Ok(true),
    )
    .or_else(|err| match err {
        rusqlite::Error::QueryReturnedNoRows => Ok(false),
        _ => Err(format!(
            "migration v14 check orthodontic_appliances exists failed: {err}"
        )),
    })
}

const ADD_COLUMN_STATEMENTS: &[(&str, &str)] = &[
    (
        "totalAligners",
        "ALTER TABLE orthodontic_appliances ADD COLUMN totalAligners INTEGER",
    ),
    (
        "daysPerAligner",
        "ALTER TABLE orthodontic_appliances ADD COLUMN daysPerAligner INTEGER",
    ),
];

fn existing_orthodontic_appliances_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(orthodontic_appliances)")
        .map_err(|e| format!("migration v14 prepare table_info failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("migration v14 query table_info failed: {e}"))?;
    let mut out = HashSet::new();
    for row in rows {
        out.insert(row.map_err(|e| format!("migration v14 read column name failed: {e}"))?);
    }
    Ok(out)
}
