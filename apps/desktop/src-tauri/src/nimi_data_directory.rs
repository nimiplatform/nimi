//! Desktop command adapter for shared `nimi_data` layout and cleanup primitives.

use serde::Deserialize;

#[cfg(test)]
pub use nimi_shell_tauri::nimi_data_directory::enforce_data_root_layout;
use nimi_shell_tauri::nimi_data_directory::{
    execute_directory_cleanup, plan_directory_cleanup, CleanupOutcome, CleanupPlan,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NimiDataCleanupPayload {
    /// First-level `nimi_data` directory id from the `P-MIG-006` matrix.
    pub directory: String,
    /// Explicit `P-MIG-008` confirmation token. Required for any
    /// non-pure-cache directory; ignored for a pure-cache directory.
    pub confirmation: Option<String>,
}

/// `P-MIG-008` plan: compute the cleanup impact preview for a first-level
/// `nimi_data` directory. Deletes nothing.
#[tauri::command]
pub async fn nimi_data_cleanup_plan(directory: String) -> Result<CleanupPlan, String> {
    let data_root = crate::desktop_product_control::runtime_selected_product_data_root().await?;
    run_blocking(move || plan_directory_cleanup(&data_root, &directory)).await
}

/// `P-MIG-008` execute: run a confirmed cleanup of a first-level `nimi_data`
/// directory. Fails closed without the confirmation token for a non-pure-cache
/// directory; rejects Runtime-owned directories outright.
#[tauri::command]
pub async fn nimi_data_cleanup_execute(
    payload: NimiDataCleanupPayload,
) -> Result<CleanupOutcome, String> {
    let data_root = crate::desktop_product_control::runtime_selected_product_data_root().await?;
    run_blocking(move || {
        execute_directory_cleanup(
            &data_root,
            &payload.directory,
            payload.confirmation.as_deref(),
        )
    })
    .await
}

/// Run a blocking `nimi_data` filesystem operation off the async runtime.
///
/// Directory scans and cleanup are blocking filesystem work; running them on a
/// Tauri async command thread would stall the event loop. This wraps them in
/// `spawn_blocking`, matching the other filesystem-heavy store tasks.
async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("NIMI_DATA_MIGRATION_TASK_JOIN_FAILED: {error}"))?
}
