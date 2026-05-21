//! Shared `~/.nimi` cross-file config migration and repair framework.
//!
//! Spec authority: `.nimi/spec/platform/kernel/local-config-migration-contract.md`
//! (`P-MIG-001..008`) and the membership registry
//! `.nimi/spec/platform/kernel/tables/local-config-file-registry.yaml`.
//!
//! This is the T10.1 cross-cutting authority for the governed `~/.nimi`
//! user-local config file family. It does NOT own any single config file's
//! field schema — those stay with each file's surface owner topic (T1 / T2 /
//! T4). This module owns the shared mechanism:
//!
//! - `P-MIG-001` / `P-MIG-002`: mandatory root `schemaVersion`, fail-closed
//!   read against an unknown / missing / non-integer / future version.
//! - `P-MIG-003`: one shared ordered migration registry per file family, with
//!   pre-migration backup, atomic rewrite, and idempotent replay.
//! - `P-MIG-004` / `P-MIG-005`: repair routing — a parse failure, an unknown
//!   `schemaVersion`, or a broken pointer routes to a typed `repair_required`
//!   / `blocked` outcome instead of a raw `Err` string, and never a silent
//!   recreate that would orphan existing data.
//!
//! It aligns with — and does not redefine — the Runtime `config.json`
//! migration framework (`K-CFG-014..016`, `runtime/internal/config/
//! migrations.go`): the same ordered-migration / backup / atomic-write /
//! idempotent-replay shape is fixed here as the cross-file floor.
//!
//! The runtime `config.json` file is a governed-family member for membership
//! purposes, but its migration EXECUTION stays owned by `K-CFG-*` in the Go
//! runtime; this Rust framework governs the Desktop-owned `~/.nimi` files.
//!
//! Split by responsibility into cohesive submodules; this root re-exports the
//! stable framework surface.

mod backup;
mod outcome;
mod registry;
mod runner;

#[cfg(test)]
mod framework_tests;

// `ConfigRepairSeverity` and `MigrationStep` are part of the public framework
// surface — consumed by the framework tests and by each owner module's repair
// tests, and required by future owner-authored migration-step sets. They are
// not yet referenced by non-test framework callers.
#[allow(unused_imports)]
pub use outcome::{ConfigReadOutcome, ConfigRepairSeverity, GovernedConfigFile};
#[allow(unused_imports)]
pub use registry::{MigrationRegistry, MigrationStep};
pub use runner::read_governed_config;
