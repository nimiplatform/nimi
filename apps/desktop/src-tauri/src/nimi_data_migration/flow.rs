//! `nimi_data` data-root migration flow — the `P-MIG-007` typed state machine.
//!
//! `P-MIG-007` requires that moving the `nimi_data` data root after first-run
//! be an explicit migration flow, not a casual pointer rewrite. The flow has a
//! typed state machine — `preview -> confirmed -> in_progress -> verifying ->
//! completed`, plus the failure branches `failed` / `repair_required` — and
//! these invariants:
//!
//! - **fail-closed on partial move** (`P-MIG-005`): a copy / verify failure
//!   leaves the source data root fully intact and still pointed-to; the
//!   half-written target is reclaimed. Neither side is orphaned.
//! - **pointer commit last** (`P-MIG-007`): the `~/.nimi/nimi.json`
//!   `dataRoot.path` is only cut over after the copy completed and the
//!   integrity check passed. The Runtime `config.json` `dataRootRef` re-sync
//!   is the caller's follow-up (a `K-CFG-*`-owned mechanism) and only runs
//!   once this flow reports `completed`.
//! - **no orphaning of the old location**: the old data root is NOT deleted by
//!   this flow. It is left intact as a recoverable pre-migration copy; a later
//!   explicit, confirmed cleanup (`P-MIG-008`) may reclaim it. The flow result
//!   carries the old root path so a Support surface can offer that cleanup.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::copy::{copy_tree, verify_copy};
use super::layout::enforce_data_root_layout;
use super::preview::{compute_migration_preview, resolve_migration_target, MigrationPreview};

/// The typed state of a `nimi_data` migration (`P-MIG-007`).
///
/// The happy path advances `Preview -> Confirmed -> InProgress -> Verifying ->
/// Completed`. `Failed` is a recoverable failure: the source is intact and
/// still authoritative, the user can retry. `RepairRequired` is an
/// inconsistency the flow could not resolve on its own (e.g. the pre-migration
/// data root is itself unreadable) and routes to a guided repair surface.
///
/// `run_migration` is a single synchronous transition and therefore only ever
/// constructs a terminal state (`Completed` / `Failed` / `RepairRequired`).
/// The pre-terminal variants `Preview` / `Confirmed` / `InProgress` /
/// `Verifying` are the serialized contract the later T10.3 Settings / T10.4
/// Support progress UI deserializes — `P-MIG-007` mandates them as the typed
/// state set, so they are part of the public enum even though this backend
/// step does not itself emit a non-terminal value. `#[allow(dead_code)]`
/// covers the not-yet-constructed pre-terminal variants for that reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum MigrationState {
    Preview,
    Confirmed,
    InProgress,
    Verifying,
    Completed,
    Failed,
    RepairRequired,
}

/// The typed outcome of running a `nimi_data` migration (`P-MIG-007`).
///
/// This is the machine contract a later Settings / Support UI wave consumes.
/// `state` is the terminal state of the flow; on `Completed` the data has been
/// copied + verified and the `~/.nimi/nimi.json` pointer cut over. `error` is
/// populated only on `Failed` / `RepairRequired` and is a product-surface-safe
/// message, never a raw panic string.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationOutcome {
    /// Terminal state of the migration flow.
    pub state: MigrationState,
    /// Absolute previous (pre-migration) `nimi_data` data root. It is left
    /// intact on disk as a recoverable copy — never deleted by the flow.
    pub previous_root: String,
    /// Absolute new `nimi_data` data root. On `Completed` this is the path the
    /// `~/.nimi/nimi.json` pointer now references.
    pub new_root: String,
    /// The size / impact preview computed before the move.
    pub preview: MigrationPreview,
    /// Bytes verified at the new location (equals the source on `Completed`).
    pub verified_bytes: u64,
    /// Files verified at the new location.
    pub verified_files: u64,
    /// Integrity content digest of the verified new location.
    pub verified_digest: Option<String>,
    /// `true` when the old data root is still on disk and a later explicit,
    /// confirmed cleanup (`P-MIG-008`) can reclaim it. Always `true` on
    /// `Completed` — the flow never auto-deletes the old root.
    pub old_root_retained: bool,
    /// Product-surface-safe failure reason — populated only for `Failed` /
    /// `RepairRequired`.
    pub error: Option<String>,
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

/// Produce a `Failed` outcome with `error`, after reclaiming `staging` so a
/// half-written tree never lingers (`P-MIG-005`).
fn failed_outcome(
    previous_root: &Path,
    new_root: &Path,
    preview: MigrationPreview,
    staging: Option<&Path>,
    error: String,
) -> MigrationOutcome {
    if let Some(staging) = staging {
        // Reclaim the partial copy — the source is the authority and stays
        // intact; the failed target must not be left as orphan residue.
        let _ = fs::remove_dir_all(staging);
    }
    MigrationOutcome {
        state: MigrationState::Failed,
        previous_root: previous_root.display().to_string(),
        new_root: new_root.display().to_string(),
        preview,
        verified_bytes: 0,
        verified_files: 0,
        verified_digest: None,
        old_root_retained: true,
        error: Some(error),
    }
}

/// Compute the `P-MIG-007` size / impact preview for a requested migration.
///
/// This is the `Preview` state of the flow: it validates the target shape and
/// scans the current data root, but moves nothing. A renderer presents this
/// before asking the user to confirm.
pub fn preview_migration(
    source_root: &Path,
    requested_target: &str,
) -> Result<MigrationPreview, String> {
    let target = resolve_migration_target(source_root, requested_target)?;
    compute_migration_preview(source_root, &target)
}

/// Run a confirmed `nimi_data` data-root migration end to end (`P-MIG-007`).
///
/// Preconditions: the caller has already obtained a `Preview` and an explicit
/// user confirmation — this function is the `Confirmed -> ... -> Completed`
/// transition. It:
///
/// 1. re-validates the target shape and re-computes the preview (the on-disk
///    state may have changed since the preview was shown);
/// 2. stages the copy into a sibling `<target>.nimi-migration-staging-*`
///    directory so a partial copy is never mistaken for a real data root;
/// 3. recursively copies the source into the staging directory;
/// 4. verifies the staging copy's integrity signature equals the source's —
///    a mismatch fails closed, source intact;
/// 5. atomically promotes the staging directory to the final target path;
/// 6. enforces the `P-MIG-006` first-level layout on the new root;
/// 7. cuts the `~/.nimi/nimi.json` `dataRoot.path` pointer over via
///    [`crate::desktop_product_control::migrate_product_data_root_pointer`] —
///    the pointer is committed LAST, only after 3–6 succeeded;
/// 8. leaves the old data root intact (no orphaning) for a later confirmed
///    cleanup.
///
/// Any failure before step 7 leaves the source data root authoritative and the
/// `~/.nimi/nimi.json` pointer unchanged. A failure routes to a `Failed`
/// outcome; an unreadable pre-migration source routes to `RepairRequired`.
pub fn run_migration(
    source_root: &Path,
    requested_target: &str,
) -> Result<MigrationOutcome, String> {
    // --- Confirmed: re-validate the target shape. ---
    let target = resolve_migration_target(source_root, requested_target)?;

    // The pre-migration source must be a readable data root. An unreadable
    // source is not a retryable copy failure — it routes to repair.
    if !source_root.is_dir() {
        return Ok(MigrationOutcome {
            state: MigrationState::RepairRequired,
            previous_root: source_root.display().to_string(),
            new_root: target.display().to_string(),
            preview: MigrationPreview {
                source_root: source_root.display().to_string(),
                target_root: target.display().to_string(),
                total_bytes: 0,
                total_files: 0,
                total_directories: 0,
                directories: Vec::new(),
                unowned_directories: Vec::new(),
                includes_runtime_owned_data: false,
            },
            verified_bytes: 0,
            verified_files: 0,
            verified_digest: None,
            old_root_retained: true,
            error: Some(format!(
                "当前 nimi_data 数据根不可读取，迁移路由到修复 ({})",
                source_root.display()
            )),
        });
    }

    let preview = compute_migration_preview(source_root, &target)?;

    // A pre-existing non-empty target would collide with the copy. An empty
    // (or absent) target is fine — we stage and promote into it.
    if target.exists() {
        let occupied = match fs::read_dir(&target) {
            Ok(mut entries) => entries.next().is_some(),
            Err(error) => {
                return Ok(failed_outcome(
                    source_root,
                    &target,
                    preview,
                    None,
                    format!("无法检查目标 nimi_data 路径 ({}): {error}", target.display()),
                ));
            }
        };
        if occupied {
            return Ok(failed_outcome(
                source_root,
                &target,
                preview,
                None,
                format!(
                    "目标 nimi_data 路径已存在且非空，拒绝覆盖 ({})",
                    target.display()
                ),
            ));
        }
    }

    // --- InProgress: stage the copy into a fresh sibling staging directory. ---
    let staging = staging_path(&target);
    if staging.exists() {
        // A stale staging directory from a prior aborted run — reclaim it
        // before reusing the path.
        let _ = fs::remove_dir_all(&staging);
    }
    if let Err(error) = copy_tree(source_root, &staging) {
        return Ok(failed_outcome(
            source_root,
            &target,
            preview,
            Some(&staging),
            format!("nimi_data 数据拷贝失败: {error}"),
        ));
    }

    // --- Verifying: integrity-check the staged copy against the source. ---
    let signature = match verify_copy(source_root, &staging) {
        Ok(signature) => signature,
        Err(error) => {
            return Ok(failed_outcome(
                source_root,
                &target,
                preview,
                Some(&staging),
                error,
            ));
        }
    };

    // Promote the verified staging directory to the final target path.
    if target.exists() {
        // The target existed but was empty (checked above) — remove the empty
        // shell so the rename can land the verified tree atomically.
        if let Err(error) = fs::remove_dir(&target) {
            return Ok(failed_outcome(
                source_root,
                &target,
                preview,
                Some(&staging),
                format!(
                    "无法清理空的目标 nimi_data 目录 ({}): {error}",
                    target.display()
                ),
            ));
        }
    }
    if let Some(parent) = target.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return Ok(failed_outcome(
                source_root,
                &target,
                preview,
                Some(&staging),
                format!(
                    "无法创建目标 nimi_data 父目录 ({}): {error}",
                    parent.display()
                ),
            ));
        }
    }
    if let Err(error) = fs::rename(&staging, &target) {
        return Ok(failed_outcome(
            source_root,
            &target,
            preview,
            Some(&staging),
            format!(
                "无法将已校验的 nimi_data 数据提交到目标路径 ({}): {error}",
                target.display()
            ),
        ));
    }

    // Enforce the P-MIG-006 first-level layout on the new root — a migrated
    // tree must still satisfy the directory ownership model.
    if let Err(error) = enforce_data_root_layout(&target) {
        // The verified data is at `target`; the source is still intact. This
        // is a layout repair, not data loss — route to repair_required.
        return Ok(MigrationOutcome {
            state: MigrationState::RepairRequired,
            previous_root: source_root.display().to_string(),
            new_root: target.display().to_string(),
            preview,
            verified_bytes: signature.total_bytes,
            verified_files: signature.file_count,
            verified_digest: Some(signature.content_digest),
            old_root_retained: true,
            error: Some(format!("迁移后 nimi_data 目录布局校验失败: {error}")),
        });
    }

    // --- Completed: pointer commit LAST (P-MIG-007). ---
    if let Err(error) = crate::desktop_product_control::migrate_product_data_root_pointer(
        target
            .to_str()
            .ok_or_else(|| format!("目标 nimi_data 路径不是有效 UTF-8: {}", target.display()))?,
    ) {
        // The data is copied + verified at the target, but the pointer cutover
        // failed. The source is still intact and still pointed-to, so no data
        // is lost — but the verified target now also exists. Route to repair
        // so a guided flow can either retry the cutover or reclaim the target;
        // never leave this as a silent half-state.
        return Ok(MigrationOutcome {
            state: MigrationState::RepairRequired,
            previous_root: source_root.display().to_string(),
            new_root: target.display().to_string(),
            preview,
            verified_bytes: signature.total_bytes,
            verified_files: signature.file_count,
            verified_digest: Some(signature.content_digest),
            old_root_retained: true,
            error: Some(format!(
                "nimi_data 数据已迁移并校验通过，但 ~/.nimi/nimi.json 指针提交失败，路由到修复: {error}"
            )),
        });
    }

    Ok(MigrationOutcome {
        state: MigrationState::Completed,
        previous_root: source_root.display().to_string(),
        new_root: target.display().to_string(),
        preview,
        verified_bytes: signature.total_bytes,
        verified_files: signature.file_count,
        verified_digest: Some(signature.content_digest),
        // The old data root is intentionally NOT deleted — it stays as a
        // recoverable copy for a later explicit, confirmed P-MIG-008 cleanup.
        old_root_retained: true,
        error: None,
    })
}

/// The staging directory path for a migration into `target`.
///
/// A sibling of the target so the copy lands on the same volume the final
/// rename will use (the promote step is then an atomic intra-volume rename).
fn staging_path(target: &Path) -> PathBuf {
    let file_name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("nimi_data");
    let staging_name = format!(
        ".{file_name}.nimi-migration-staging.{}.{}",
        std::process::id(),
        now_unix_ms()
    );
    match target.parent() {
        Some(parent) => parent.join(staging_name),
        None => PathBuf::from(staging_name),
    }
}
