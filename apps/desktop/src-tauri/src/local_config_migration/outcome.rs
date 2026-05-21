//! Typed outcomes of a governed `~/.nimi` config-file read.
//!
//! `P-MIG-004` requires that a parse failure, an unknown `schemaVersion`, or a
//! broken pointer route to a typed repair state rather than bubble a raw
//! `Err` string to the renderer. `ConfigReadOutcome` is that typed result.

use serde::Serialize;

/// Identity of one governed `~/.nimi` config file.
///
/// Mirrors `tables/local-config-file-registry.yaml`. The `config_file_id` is
/// the stable registry id; `display_path` is the `~/.nimi`-relative product
/// path used verbatim in repair-routing diagnostics so a repair surface can
/// name the file the user must repair.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GovernedConfigFile {
    /// Stable registry id, e.g. `registry_json`.
    pub config_file_id: &'static str,
    /// Product-facing `~/.nimi`-relative path, e.g. `~/.nimi/apps/registry.json`.
    pub display_path: &'static str,
}

impl GovernedConfigFile {
    pub const fn new(config_file_id: &'static str, display_path: &'static str) -> Self {
        Self {
            config_file_id,
            display_path,
        }
    }
}

/// Severity of a routed repair state (`P-MIG-004`).
///
/// `RepairRequired` — the file is faulted but a guided repair / regeneration
/// flow can recover it without losing data. `Blocked` — the fault cannot be
/// auto-resolved and an explicit operator/repair action is required before the
/// surface can be used. Both are typed; neither is ever a raw `Err`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfigRepairSeverity {
    RepairRequired,
    Blocked,
}

/// The typed result of reading one governed `~/.nimi` config file through the
/// migration framework.
///
/// - `Absent` — the file does not exist. This is NOT a fault: a first-run /
///   not-yet-materialized projection is legitimately absent and the caller
///   decides whether to materialize it. `Absent` must never be conflated with
///   a routed repair state (`P-MIG-005` no-orphaning: a missing file is not
///   silently "recovered" by the framework).
/// - `Ready(T)` — the file is present, at the current supported
///   `schemaVersion` (after any registered migration ran), and structurally
///   valid.
/// - `Repair { .. }` — the file is present but faulted: unparseable, unknown
///   `schemaVersion`, no registered migration path, broken pointer, or a
///   post-migration validation failure. The on-disk file is left intact.
#[derive(Debug, Clone)]
pub enum ConfigReadOutcome<T> {
    Absent,
    Ready(T),
    Repair {
        /// `repair_required` vs `blocked` severity (`P-MIG-004`). Load-bearing
        /// typed contract data: a repair surface must distinguish the two.
        /// Read by the framework tests and by future T10.2 repair-surface
        /// callers; `#[allow(dead_code)]` because the current non-test callers
        /// only consume `reason`.
        #[allow(dead_code)]
        severity: ConfigRepairSeverity,
        /// Human-readable, product-surface-safe reason. Never a raw serde error
        /// dump on its own — always prefixed with the governed file identity.
        reason: String,
    },
}

impl<T> ConfigReadOutcome<T> {
    /// Construct a `repair_required` outcome for `file` with `detail`.
    pub fn repair_required(file: &GovernedConfigFile, detail: impl AsRef<str>) -> Self {
        Self::Repair {
            severity: ConfigRepairSeverity::RepairRequired,
            reason: format!(
                "{} requires repair: {}",
                file.display_path,
                detail.as_ref()
            ),
        }
    }

    /// Construct a `blocked` outcome for `file` with `detail`.
    pub fn blocked(file: &GovernedConfigFile, detail: impl AsRef<str>) -> Self {
        Self::Repair {
            severity: ConfigRepairSeverity::Blocked,
            reason: format!("{} is blocked: {}", file.display_path, detail.as_ref()),
        }
    }
}
