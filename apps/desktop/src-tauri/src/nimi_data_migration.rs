//! `nimi_data` directory ownership enforcement + data-root migration flow.
//!
//! Spec authority: `.nimi/spec/platform/kernel/local-config-migration-contract.md`
//! `P-MIG-006`, `P-MIG-007`, `P-MIG-008`, and the kernel table
//! `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`.
//!
//! This is the T10.2 wave: the `nimi_data` directory / migration mechanism.
//!
//! - `P-MIG-006` (`ownership` + `layout`): the 15-row `nimi_data` directory
//!   owner + cleanup matrix as the authoritative directory model — directory
//!   creation routes through `enforce_data_root_layout`, and every cleanup /
//!   ownership check resolves against the matrix.
//! - `P-MIG-007` (`preview` + `copy` + `flow`): a real data-root migration
//!   flow — size / impact preview, integrity-checked copy, a typed migration
//!   state machine, atomic pointer cutover committed last, and no orphaning of
//!   the old or new location on any failure.
//! - `P-MIG-008` (`cleanup`): any destructive cleanup requires an explicit
//!   confirmation token and obeys the matrix's per-directory cleanup rule;
//!   without the token a non-pure-cache cleanup fails closed.
//!
//! The flow + cleanup mechanics are exposed as a minimal Tauri command surface
//! the later T10.3 Settings / T10.4 Support UI waves call. This wave does NOT
//! build those panels.
//!
//! It reuses the T10.1 `local_config_migration` idioms (typed outcomes,
//! fail-closed, backup-before-mutate, atomic write) where they fit; it does
//! NOT redefine the `~/.nimi` config framework or the Runtime `config.json`
//! framework.

mod cleanup;
mod copy;
mod flow;
mod layout;
mod ownership;
mod preview;

#[cfg(test)]
mod tests;

pub use layout::enforce_data_root_layout;

use serde::Deserialize;

use cleanup::{
    execute_directory_cleanup, plan_directory_cleanup, plan_old_root_reclaim, reclaim_old_root,
    CleanupOutcome, CleanupPlan, OldRootReclaimPlan,
};
use flow::{preview_migration, run_migration, MigrationOutcome};
use preview::MigrationPreview;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NimiDataMigrationPreviewPayload {
    /// Absolute target `nimi_data` path the user wants to move the data root
    /// to.
    pub target_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NimiDataMigrationRunPayload {
    /// Absolute target `nimi_data` path. The renderer obtains this from a
    /// preview the user has explicitly confirmed.
    pub target_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NimiDataCleanupPayload {
    /// First-level `nimi_data` directory id from the `P-MIG-006` matrix.
    pub directory: String,
    /// Explicit `P-MIG-008` confirmation token. Required for any
    /// non-pure-cache directory; ignored for a pure-cache directory.
    pub confirmation: Option<String>,
}

/// `P-MIG-007` preview: compute the size / impact preview for moving the
/// current `nimi_data` data root to `target_root`. Moves nothing.
#[tauri::command]
pub async fn nimi_data_migration_preview(
    payload: NimiDataMigrationPreviewPayload,
) -> Result<MigrationPreview, String> {
    run_blocking(move || {
        let source = crate::desktop_product_control::selected_product_data_root()?;
        preview_migration(&source, &payload.target_root)
    })
    .await
}

/// `P-MIG-007` run: execute a confirmed `nimi_data` data-root migration end to
/// end — staged integrity-checked copy, atomic promote, and pointer cutover
/// committed last. Returns the typed `MigrationOutcome` state machine result.
///
/// On a `completed` outcome the renderer must follow up with the Runtime
/// `config.json` `dataRootRef` re-sync (a `K-CFG-*`-owned mechanism); this
/// command intentionally does not perform that — `P-MIG-007` keeps the
/// pointer-commit boundary at `~/.nimi/nimi.json`.
#[tauri::command]
pub async fn nimi_data_migration_run(
    payload: NimiDataMigrationRunPayload,
) -> Result<MigrationOutcome, String> {
    run_blocking(move || {
        let source = crate::desktop_product_control::selected_product_data_root()?;
        run_migration(&source, &payload.target_root)
    })
    .await
}

/// `P-MIG-008` plan: compute the cleanup impact preview for a first-level
/// `nimi_data` directory. Deletes nothing.
#[tauri::command]
pub async fn nimi_data_cleanup_plan(directory: String) -> Result<CleanupPlan, String> {
    run_blocking(move || {
        let data_root = crate::desktop_product_control::selected_product_data_root()?;
        plan_directory_cleanup(&data_root, &directory)
    })
    .await
}

/// `P-MIG-008` execute: run a confirmed cleanup of a first-level `nimi_data`
/// directory. Fails closed without the confirmation token for a non-pure-cache
/// directory; rejects Runtime-owned directories outright.
#[tauri::command]
pub async fn nimi_data_cleanup_execute(
    payload: NimiDataCleanupPayload,
) -> Result<CleanupOutcome, String> {
    run_blocking(move || {
        let data_root = crate::desktop_product_control::selected_product_data_root()?;
        execute_directory_cleanup(
            &data_root,
            &payload.directory,
            payload.confirmation.as_deref(),
        )
    })
    .await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NimiDataOldRootReclaimPlanPayload {
    /// Absolute path of the retained old `nimi_data` data root to preview a
    /// reclaim for. The renderer obtains this from a completed `MigrationOutcome`
    /// (`previousRoot`, with `oldRootRetained = true`).
    pub old_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NimiDataOldRootReclaimPayload {
    /// Absolute path of the retained old `nimi_data` data root to reclaim.
    pub old_root: String,
    /// Explicit `P-MIG-008` confirmation token. Required — reclaiming the old
    /// root is always destructive.
    pub confirmation: Option<String>,
}

/// `P-MIG-008` plan: compute the impact preview for reclaiming a retained old
/// `nimi_data` data root. Deletes nothing.
///
/// Two backend-authoritative facts gate the reclaim and cannot be spoofed by
/// the renderer:
/// - the active (protected) data root is `selected_product_data_root()`, so the
///   guard against deleting the live data root cannot be bypassed;
/// - `recorded` comes from the migration reclaim ledger, so only a path a real
///   completed migration actually retained is ever marked reclaimable.
#[tauri::command]
pub async fn nimi_data_old_root_reclaim_plan(
    payload: NimiDataOldRootReclaimPlanPayload,
) -> Result<OldRootReclaimPlan, String> {
    run_blocking(move || {
        let old_path = std::path::PathBuf::from(payload.old_root.trim());
        let active_root = crate::desktop_product_control::selected_product_data_root()?;
        let recorded = crate::desktop_product_control::is_recorded_retained_old_root(&old_path)?;
        plan_old_root_reclaim(&old_path, &active_root, recorded)
    })
    .await
}

/// `P-MIG-008` execute: reclaim a retained old `nimi_data` data root. Always
/// requires the confirmation token; refuses to touch the active data root or a
/// root the active root is nested inside. Fails closed otherwise.
///
/// Authorization: the `old_root` MUST be a path the migration reclaim ledger
/// recorded (`is_recorded_retained_old_root`). A renderer-supplied path the
/// backend never retained can never drive a destructive delete — the `CLEAN`
/// token is a deliberate-action gate, not an authorization capability. The
/// active (protected) data root is the backend-authoritative
/// `selected_product_data_root()`, not a renderer-supplied value. On success
/// the ledger entry is consumed so the path is no longer advertised.
#[tauri::command]
pub async fn nimi_data_old_root_reclaim_execute(
    payload: NimiDataOldRootReclaimPayload,
) -> Result<CleanupOutcome, String> {
    run_blocking(move || {
        let old_path = std::path::PathBuf::from(payload.old_root.trim());
        let active_root = crate::desktop_product_control::selected_product_data_root()?;
        if !crate::desktop_product_control::is_recorded_retained_old_root(&old_path)? {
            return Err(format!(
                "拒绝回收：{} 不是已记录的迁移保留旧 nimi_data 数据根，无法回收",
                old_path.display()
            ));
        }
        let outcome = reclaim_old_root(&old_path, &active_root, payload.confirmation.as_deref())?;
        crate::desktop_product_control::consume_retained_old_root(&old_path)?;
        Ok(outcome)
    })
    .await
}

/// Run a blocking `nimi_data` filesystem operation off the async runtime.
///
/// The migration copy / scan / cleanup are blocking filesystem work; running
/// them on a Tauri async command thread would stall the event loop. This wraps
/// them in `spawn_blocking`, matching the other filesystem-heavy store tasks.
async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("NIMI_DATA_MIGRATION_TASK_JOIN_FAILED: {error}"))?
}
