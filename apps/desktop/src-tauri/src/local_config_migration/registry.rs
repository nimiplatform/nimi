//! Ordered migration registry for one governed `~/.nimi` config file family.
//!
//! `P-MIG-003`: the governed family shares one migration framework — this
//! `MigrationRegistry` is that framework. Per-file *migration step
//! definitions* (a concrete `schemaVersion` field-level transform) are
//! authored by each file's schema-owner topic (T1 / T2 / T4) and registered
//! here on a version bump. The framework owns ordering, gap detection, and
//! idempotent replay; it never invents an owner's migration step.
//!
//! Migration steps operate on `serde_json::Value` rather than the current
//! typed record struct: at a `v(n) -> v(n+1)` boundary the on-disk shape is
//! the OLD shape, which by definition does not deserialize into the current
//! struct. Working at the JSON-document level is the only correct level for a
//! schema upgrade and matches the runtime `migrations.go` `FileConfig`-then-
//! re-validate idiom (the runtime works on its typed struct only because its
//! single registered step is a pure version stamp; a real field-level step
//! must see the raw document).

use serde_json::Value;

/// One ordered migration step for a governed config file family.
///
/// A step is a pure function: given the config document at `from_version`, it
/// returns the document at `to_version`. It MUST be deterministic and MUST set
/// the document's root `schemaVersion` to `to_version`. The framework verifies
/// the post-step `schemaVersion` and re-validates the final document, so a
/// step that forgets to stamp the version fails closed rather than silently
/// drifting (`P-MIG-003` "schema upgraded but projection stuck on old
/// version" drift is rejected).
pub struct MigrationStep {
    pub from_version: u32,
    pub to_version: u32,
    /// Field-level transform. `apply` receives the document as a JSON object
    /// value and returns the upgraded document. Unknown legacy fields must be
    /// handled explicitly inside `apply` (dropped, renamed, or defaulted) —
    /// the framework never silently discards fields for an owner.
    pub apply: fn(Value) -> Result<Value, String>,
}

impl MigrationStep {
    /// Construct a registered migration step. Used by an owner topic's
    /// migration-step set on a `schemaVersion` bump (`P-MIG-003`); exercised by
    /// the framework tests. `#[allow(dead_code)]` because every governed family
    /// currently registers an empty step set (no version has been bumped yet).
    #[allow(dead_code)]
    pub const fn new(
        from_version: u32,
        to_version: u32,
        apply: fn(Value) -> Result<Value, String>,
    ) -> Self {
        Self {
            from_version,
            to_version,
            apply,
        }
    }
}

/// The ordered migration registry for one governed config file family.
///
/// `current_version` is the `schemaVersion` the file's schema owner currently
/// supports. `steps` is the ordered set of registered migrations; an empty
/// `steps` set is legitimate and means "no version has ever been bumped" — a
/// file found below `current_version` then correctly fails closed to repair
/// because no migration path exists (`P-MIG-002`).
pub struct MigrationRegistry {
    /// Stable registry id of the file family, e.g. `registry_json`.
    pub config_file_id: &'static str,
    /// The current supported `schemaVersion` for this family.
    pub current_version: u32,
    /// Ordered migration steps. Stored low-to-high by `from_version`.
    pub steps: &'static [MigrationStep],
}

impl MigrationRegistry {
    pub const fn new(
        config_file_id: &'static str,
        current_version: u32,
        steps: &'static [MigrationStep],
    ) -> Self {
        Self {
            config_file_id,
            current_version,
            steps,
        }
    }

    /// Structural self-check of the registered step set.
    ///
    /// Rejects a malformed registry at first use rather than letting a bad
    /// step chain corrupt a file: each step must advance the version by
    /// exactly one stage to its predecessor's `to_version`, must not skip, and
    /// the final step (if any) must land on `current_version`. This is the
    /// "no implicit skip-level upgrade" guarantee of `P-MIG-003`.
    pub fn validate_chain(&self) -> Result<(), String> {
        if self.current_version == 0 {
            return Err(format!(
                "governed config {} declares an invalid current schemaVersion 0",
                self.config_file_id
            ));
        }
        if self.steps.is_empty() {
            return Ok(());
        }
        let mut expected_from = self.steps[0].from_version;
        for step in self.steps {
            if step.from_version != expected_from {
                return Err(format!(
                    "governed config {} migration chain has a gap: expected a step from schemaVersion {} but found {}->{}",
                    self.config_file_id, expected_from, step.from_version, step.to_version
                ));
            }
            if step.to_version != step.from_version + 1 {
                return Err(format!(
                    "governed config {} migration step {}->{} is not a single-stage advance",
                    self.config_file_id, step.from_version, step.to_version
                ));
            }
            expected_from = step.to_version;
        }
        let last_to = self.steps[self.steps.len() - 1].to_version;
        if last_to != self.current_version {
            return Err(format!(
                "governed config {} migration chain ends at schemaVersion {} but current supported version is {}",
                self.config_file_id, last_to, self.current_version
            ));
        }
        Ok(())
    }

    /// Find the registered step that upgrades a document at `from_version`.
    pub fn step_from(&self, from_version: u32) -> Option<&MigrationStep> {
        self.steps
            .iter()
            .find(|step| step.from_version == from_version)
    }
}
