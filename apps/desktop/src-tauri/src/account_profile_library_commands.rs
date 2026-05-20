//! Tauri commands for the editable account profile library family.
//!
//! Spec authority: `P-AIPS-013` Account Default Profile Local Library Evidence.
//!
//! These commands are the renderer's ONLY write/read path to the account
//! profile library. The library file family
//! (`~/.nimi/accounts/<account-id>/profiles/{ index.json, user/, imported/ }`,
//! `account_profile_library_files.rs`) is the single source of truth — the
//! renderer holds only a read-through projection, never a parallel store.
//!
//! The authenticated `account_id` is resolved server-side from the Runtime
//! account session (`authenticated_runtime_account_id`); it is never accepted
//! from the renderer. A renderer-provided account binding is not trusted.

use crate::account_profile_library_files::{
    create_account_profile_library_entry, delete_account_profile_library_entry,
    edit_account_profile_library_entry, export_account_profile_library_entries,
    import_account_profile_library_entries, list_account_profile_library,
    AccountProfileLibraryProjection, LibraryAIProfilePayload,
};
use crate::desktop_product_control::authenticated_runtime_account_id;
use serde::Deserialize;

/// Payload for `account_profile_library_create` / `_edit`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileLibraryEntryPayload {
    pub profile: LibraryAIProfilePayload,
}

/// Payload for `account_profile_library_import`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileLibraryImportPayload {
    pub profiles: Vec<LibraryAIProfilePayload>,
}

/// Payload for `account_profile_library_export`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileLibraryExportPayload {
    /// Empty selects every editable library profile.
    #[serde(default)]
    pub profile_ids: Vec<String>,
}

/// Payload for `account_profile_library_delete`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileLibraryDeletePayload {
    pub profile_id: String,
}

/// List the account profile library and re-derive `index.json` from disk.
#[tauri::command]
pub async fn account_profile_library_list() -> Result<AccountProfileLibraryProjection, String> {
    let account_id = authenticated_runtime_account_id().await?;
    list_account_profile_library(&account_id)
}

/// Create a new user-authored library profile under `user/`.
#[tauri::command]
pub async fn account_profile_library_create(
    payload: AccountProfileLibraryEntryPayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let account_id = authenticated_runtime_account_id().await?;
    create_account_profile_library_entry(&account_id, payload.profile)
}

/// Edit an existing editable library profile in place.
#[tauri::command]
pub async fn account_profile_library_edit(
    payload: AccountProfileLibraryEntryPayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let account_id = authenticated_runtime_account_id().await?;
    edit_account_profile_library_entry(&account_id, payload.profile)
}

/// Import one or more profiles into the library `imported/` directory.
#[tauri::command]
pub async fn account_profile_library_import(
    payload: AccountProfileLibraryImportPayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let account_id = authenticated_runtime_account_id().await?;
    import_account_profile_library_entries(&account_id, payload.profiles)
}

/// Export editable library profiles as portable AIProfile payloads.
#[tauri::command]
pub async fn account_profile_library_export(
    payload: AccountProfileLibraryExportPayload,
) -> Result<Vec<LibraryAIProfilePayload>, String> {
    let account_id = authenticated_runtime_account_id().await?;
    export_account_profile_library_entries(&account_id, payload.profile_ids)
}

/// Delete an editable library profile.
#[tauri::command]
pub async fn account_profile_library_delete(
    payload: AccountProfileLibraryDeletePayload,
) -> Result<AccountProfileLibraryProjection, String> {
    let account_id = authenticated_runtime_account_id().await?;
    delete_account_profile_library_entry(&account_id, &payload.profile_id)
}
