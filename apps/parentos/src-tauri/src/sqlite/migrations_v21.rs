use rusqlite::Connection;

/// Schema v21: retire the legacy `growth_measurements` table.
///
/// Background: the v13 migration backfilled all pre-cutover legacy rows into
/// the canonical `health_record_events` + `health_record_values` tables
/// using deterministic `precutover-growth-measurement:` event ids. Since
/// the v13 cutover, every renderer + Rust write path has targeted the
/// canonical tables: `insert_measurement` / `update_measurement` /
/// `delete_measurement` / `get_measurements` all operate on
/// `health_record_events` + `health_record_values` (per
/// `apps/parentos/src-tauri/src/sqlite/queries/health_measurements.rs`).
/// Wave-0b of the 2026-05-19-parentos-growth-canonical-write-migration
/// topic completed the final renderer-API-shape swap (the Add modal
/// `GrowthAddRecordContent.handleSave` now calls `saveHealthRecordCapture`
/// directly).
///
/// The `growth_measurements` table is therefore dormant: no reads, no
/// writes. This migration drops the table and its two indexes,
/// completing the legacy-table retirement admitted in
/// `apps/parentos/spec/kernel/tables/local-storage.yaml#growth_measurement_canonical_migration.retirement_plan`.
///
/// Idempotent via `DROP ... IF EXISTS`. Safe under `repair_missing_tables`
/// replay: if the table somehow re-materialised (e.g. a stale pre-release
/// install), this migration cleans it up again.
pub(super) fn apply_v21(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "DROP INDEX IF EXISTS idx_growth_child_type_date;
         DROP INDEX IF EXISTS idx_growth_child_age;
         DROP TABLE IF EXISTS growth_measurements;",
    )
    .map_err(|e| format!("migration v21 drop legacy growth_measurements failed: {e}"))?;
    Ok(())
}
