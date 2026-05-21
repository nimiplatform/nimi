//! Pre-migration backup and atomic rewrite for governed `~/.nimi` config
//! files.
//!
//! `P-MIG-003`: a migration that writes the upgraded document back MUST first
//! retain a recoverable pre-migration backup, and the write-back MUST be
//! atomic — a failed write leaves the old file intact and aborts the file's
//! entry into ordinary readiness.
//!
//! This mirrors the runtime `backupAndRewriteMigratedConfig` shape
//! (`runtime/internal/config/migrations.go`): write `<path>.bak` first, then
//! atomically replace `<path>`; if the replace fails, drop the backup so the
//! filesystem is left exactly as the migration found it.

use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Suffix of the pre-migration backup file. A consumer repair flow can find a
/// recoverable copy at `<config-path>.bak` after a migration.
pub const BACKUP_SUFFIX: &str = ".bak";

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Persist the pre-migration document bytes to `<path>.bak` and atomically
/// rewrite `<path>` with the migrated pretty-printed JSON.
///
/// Order is backup-first, commit-last:
/// 1. write the previous on-disk bytes to `<path>.bak` (atomically);
/// 2. write the migrated document to a process/time-unique temp file;
/// 3. atomically rename the temp file over `<path>`.
///
/// If step 3 fails, the temp file and the just-written backup are removed so
/// the migration leaves no partial residue and the original file is still the
/// authority. The backup is intentionally retained on success — it is the
/// `P-MIG-003` recoverable pre-migration material.
pub fn backup_and_rewrite(
    path: &Path,
    previous_bytes: &[u8],
    migrated: &serde_json::Value,
) -> Result<(), String> {
    let backup_path = path.with_extension(format!(
        "{}{}",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("json"),
        BACKUP_SUFFIX
    ));
    write_atomic(&backup_path, previous_bytes)
        .map_err(|error| format!("retain pre-migration backup failed: {error}"))?;

    let serialized = serde_json::to_vec_pretty(migrated)
        .map_err(|error| format!("serialize migrated config document failed: {error}"))?;
    if let Err(error) = write_atomic(path, &serialized) {
        // The commit failed: leave the filesystem exactly as the migration
        // found it — drop the backup we just wrote so no stale `.bak` lingers.
        let _ = fs::remove_file(&backup_path);
        return Err(format!("commit migrated config document failed: {error}"));
    }
    Ok(())
}

/// Atomically write `bytes` to `path` via a unique temp file + rename.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create parent directory failed ({}): {error}", parent.display()))?;
    }
    let tmp_path = path.with_extension(format!(
        "{}.tmp.{}.{}",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("json"),
        std::process::id(),
        now_unix_ms()
    ));
    fs::write(&tmp_path, bytes)
        .map_err(|error| format!("write temp file failed ({}): {error}", tmp_path.display()))?;
    fs::rename(&tmp_path, path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!("atomic rename failed ({}): {error}", path.display())
    })
}
