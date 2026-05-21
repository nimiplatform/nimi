//! Tauri commands for the account app-library projection (`library.json`).
//!
//! T4-W4 Fork D (D1): the desktop Tauri layer owns the `library.json` writer.
//! These commands are the renderer's ONLY read/write path to the account
//! app-library projection (`~/.nimi/accounts/<account-id>/apps/library.json`).
//! `account_apps_projection.rs` owns the schema, the fail-closed governed
//! reader, and the mutation writer; this module is the thin command seam.
//!
//! The authenticated `account_id` is resolved server-side from the Runtime
//! account session (`authenticated_runtime_account_id`); it is never accepted
//! from the renderer — a renderer-provided account binding is not trusted.
//!
//! The writer is driven by the desktop Apps surface on an observed terminal
//! `RuntimeAppInstallJob` frame (install -> `installed`, uninstall ->
//! `uninstalled`). The runtime stays the package/job truth owner; this writer
//! only projects the account-scoped library/launch preference.

use crate::account_apps_projection::{
    apply_account_app_library_mutation, read_account_app_library, AccountAppLibraryMutation,
    AccountAppLibraryRecord,
};
use crate::desktop_product_control::authenticated_runtime_account_id;
use serde::Deserialize;

/// The library mutation kind a renderer command requests. Mirrors
/// `AccountAppLibraryMutation`; the renderer never names a raw library state.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountAppLibraryMutationKind {
    /// A terminal `installed` install/update/repair job.
    InstalledEnabled,
    /// A terminal `uninstalled` job that removed the release only.
    UninstalledKeepRecord,
    /// A confirmed destructive "Delete app data" flow.
    RemovedFromLibrary,
}

impl From<AccountAppLibraryMutationKind> for AccountAppLibraryMutation {
    fn from(value: AccountAppLibraryMutationKind) -> Self {
        match value {
            AccountAppLibraryMutationKind::InstalledEnabled => {
                AccountAppLibraryMutation::InstalledEnabled
            }
            AccountAppLibraryMutationKind::UninstalledKeepRecord => {
                AccountAppLibraryMutation::UninstalledKeepRecord
            }
            AccountAppLibraryMutationKind::RemovedFromLibrary => {
                AccountAppLibraryMutation::RemovedFromLibrary
            }
        }
    }
}

/// Payload for `account_app_library_apply`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountAppLibraryApplyPayload {
    /// The admitted Nimi App id whose library row the mutation targets.
    pub app_id: String,
    /// The lifecycle-terminal mutation to apply.
    pub mutation: AccountAppLibraryMutationKind,
}

/// Read the account app-library projection.
///
/// Returns the record, or `null` when the projection has not been written yet.
/// A corrupt / unknown-version / account-mismatched file fails closed with the
/// typed repair reason.
#[tauri::command]
pub async fn account_app_library_get() -> Result<Option<AccountAppLibraryRecord>, String> {
    let account_id = authenticated_runtime_account_id().await?;
    read_account_app_library(&account_id)
}

/// Apply an install / uninstall / remove mutation to one app's library row and
/// return the committed record. Fail-closed: a faulted existing file is not
/// overwritten.
#[tauri::command]
pub async fn account_app_library_apply(
    payload: AccountAppLibraryApplyPayload,
) -> Result<AccountAppLibraryRecord, String> {
    let account_id = authenticated_runtime_account_id().await?;
    apply_account_app_library_mutation(&account_id, &payload.app_id, payload.mutation.into())
}
