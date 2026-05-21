//! The governed-config read runner: the single entry point that performs the
//! `P-MIG-002` fail-closed `schemaVersion` read, runs the `P-MIG-003` ordered
//! migration, and routes faults to a `P-MIG-004` typed repair outcome.

use std::fs;
use std::path::Path;

use serde_json::Value;

use super::backup::backup_and_rewrite;
use super::outcome::{ConfigReadOutcome, GovernedConfigFile};
use super::registry::MigrationRegistry;

/// Read the root `schemaVersion` integer from a governed config document.
///
/// `P-MIG-001`: a missing field, a non-integer value, or `0` / a negative
/// value is NOT a known schema — the file must route to repair. Returns the
/// version on success, or a typed repair detail string on failure.
fn read_schema_version(document: &Value) -> Result<u32, String> {
    let object = document
        .as_object()
        .ok_or_else(|| "config document root is not a JSON object".to_string())?;
    let raw = object
        .get("schemaVersion")
        .ok_or_else(|| "config document is missing the required schemaVersion field".to_string())?;
    let number = raw
        .as_u64()
        .ok_or_else(|| "config document schemaVersion is not a non-negative integer".to_string())?;
    if number == 0 {
        return Err("config document schemaVersion must be a positive integer".to_string());
    }
    u32::try_from(number)
        .map_err(|_| "config document schemaVersion is out of the supported range".to_string())
}

/// Load a governed config file as a raw JSON document, if it exists.
///
/// Returns `Ok(None)` only when the file is absent. A read or parse failure is
/// `Ok(Some(Err(..)))`-shaped through the caller's repair routing rather than
/// a hard `Err`, so this returns the parse result alongside presence.
fn load_raw(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Run the ordered migration chain over `document`, starting at `from_version`.
///
/// Applies each registered single-stage step in order up to
/// `registry.current_version`. A missing step at any stage fails closed
/// (`P-MIG-002`: below current version with no registered migration path).
/// Each step's output `schemaVersion` is verified to match the step's declared
/// `to_version` so a step that forgets to stamp the version cannot drift.
fn run_migration_chain(
    registry: &MigrationRegistry,
    mut document: Value,
    from_version: u32,
) -> Result<Value, String> {
    let mut current = from_version;
    while current < registry.current_version {
        let step = registry.step_from(current).ok_or_else(|| {
            format!(
                "no registered migration from schemaVersion {current} toward current version {}",
                registry.current_version
            )
        })?;
        document = (step.apply)(document).map_err(|error| {
            format!(
                "migration step {}->{} failed: {error}",
                step.from_version, step.to_version
            )
        })?;
        let stamped = read_schema_version(&document).map_err(|error| {
            format!(
                "migration step {}->{} produced a document with an invalid schemaVersion: {error}",
                step.from_version, step.to_version
            )
        })?;
        if stamped != step.to_version {
            return Err(format!(
                "migration step {}->{} did not stamp schemaVersion to {} (found {stamped})",
                step.from_version, step.to_version, step.to_version
            ));
        }
        current = step.to_version;
    }
    Ok(document)
}

/// Read a governed `~/.nimi` config file through the shared migration / repair
/// framework.
///
/// This is the single `P-MIG` entry point. It:
///
/// 1. returns `ConfigReadOutcome::Absent` when the file does not exist
///    (`P-MIG-005`: an absent file is not a fault and is never silently
///    "recovered" here);
/// 2. routes an unreadable or unparseable file to `repair_required`
///    (`P-MIG-004` parse failure);
/// 3. reads the root `schemaVersion` fail-closed (`P-MIG-001` / `P-MIG-002`):
///    a missing / non-integer / future version routes to `repair_required`;
/// 4. runs the ordered migration chain for an old-but-migratable version
///    (`P-MIG-003`); a version below current with no registered step routes
///    to `repair_required`;
/// 5. when a migration ran, retains a pre-migration `.bak` and atomically
///    rewrites the file; idempotent replay (a file already at the current
///    version) performs NO write;
/// 6. hands the final current-version document to `deserialize`, which both
///    deserializes into the typed record and performs the owner's structural
///    validation. A failure there routes to `repair_required` — a structurally
///    broken file (including a broken pointer the owner validator detects) is
///    a fault, never a raw `Err`.
///
/// `deserialize` is the file owner's typed read+validate closure. It owns the
/// field schema; the framework owns everything around it. It returns
/// `Err(detail)` for a structural fault (routed to repair) — it must NOT be
/// used to signal absence (the framework already handled that).
pub fn read_governed_config<T>(
    file: &GovernedConfigFile,
    path: &Path,
    registry: &MigrationRegistry,
    deserialize: impl FnOnce(&Value) -> Result<T, String>,
) -> Result<ConfigReadOutcome<T>, String> {
    debug_assert_eq!(
        file.config_file_id, registry.config_file_id,
        "governed config file identity must match its migration registry"
    );
    // A malformed registry is a build-time programming fault, not a user
    // repair state — surface it as a hard error so it is caught in tests.
    registry.validate_chain()?;

    let raw_bytes = match load_raw(path) {
        Ok(None) => return Ok(ConfigReadOutcome::Absent),
        Ok(Some(bytes)) => bytes,
        Err(error) => {
            return Ok(ConfigReadOutcome::repair_required(
                file,
                format!("config file is unreadable ({}): {error}", path.display()),
            ));
        }
    };

    let document: Value = match serde_json::from_slice(&raw_bytes) {
        Ok(value) => value,
        Err(error) => {
            return Ok(ConfigReadOutcome::repair_required(
                file,
                format!("config file is not valid JSON: {error}"),
            ));
        }
    };

    let on_disk_version = match read_schema_version(&document) {
        Ok(version) => version,
        Err(detail) => {
            return Ok(ConfigReadOutcome::repair_required(file, detail));
        }
    };

    if on_disk_version > registry.current_version {
        // Unknown future version — fail-closed-to-repair (`P-MIG-002`). Never
        // a guess-repair, never a degraded best-effort projection.
        return Ok(ConfigReadOutcome::repair_required(
            file,
            format!(
                "config schemaVersion {on_disk_version} is newer than the supported version {}; an unknown future version fails closed",
                registry.current_version
            ),
        ));
    }

    let migrated_document = if on_disk_version < registry.current_version {
        match run_migration_chain(registry, document.clone(), on_disk_version) {
            Ok(upgraded) => {
                // A migration ran: retain a recoverable pre-migration backup
                // and atomically rewrite the file (`P-MIG-003`).
                if let Err(error) = backup_and_rewrite(path, &raw_bytes, &upgraded) {
                    return Ok(ConfigReadOutcome::blocked(
                        file,
                        format!("config migration write-back failed: {error}"),
                    ));
                }
                upgraded
            }
            Err(detail) => {
                // No registered path / a failing step: fail closed to repair,
                // on-disk file untouched.
                return Ok(ConfigReadOutcome::repair_required(file, detail));
            }
        }
    } else {
        // Already current: idempotent no-op, no write.
        document
    };

    match deserialize(&migrated_document) {
        Ok(record) => Ok(ConfigReadOutcome::Ready(record)),
        Err(detail) => Ok(ConfigReadOutcome::repair_required(file, detail)),
    }
}
