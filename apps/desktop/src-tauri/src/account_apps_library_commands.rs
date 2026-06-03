//! Tauri command for reading the Runtime-owned account app-library projection.
//!
//! Runtime resolves the authenticated account binding server-side; it is never
//! accepted from the renderer, because a renderer-provided binding is not
//! trusted.
//!
//! Runtime app lifecycle terminal handling owns account-library writes and
//! governed reads. Desktop remains a bridge consumer here and must not resolve
//! account-scoped projection files.

use serde::Serialize;

const ACCOUNT_APP_LIBRARY_DESKTOP_APP_ID: &str = "nimi.desktop";
const ACCOUNT_APP_LIBRARY_CALLER_ID: &str = "desktop.account-app-library";
const ACCOUNT_APP_LIBRARY_SURFACE_ID: &str = "desktop.apps";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountAppLibraryRow {
    pub app_id: String,
    pub library_state: String,
    pub installed: bool,
    pub last_opened_at: Option<String>,
    pub data_policy: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountAppLibraryRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub updated_at: String,
    pub apps: Vec<AccountAppLibraryRow>,
}

/// Read the account app-library projection.
///
/// Returns the record, or `null` when the projection has not been written yet.
/// A corrupt / unknown-version / account-mismatched file fails closed with the
/// typed repair reason.
#[tauri::command]
pub async fn account_app_library_get() -> Result<Option<AccountAppLibraryRecord>, String> {
    let response: crate::runtime_bridge::generated::GetAccountAppLibraryResponse =
        crate::runtime_bridge::invoke_unary_typed_with_metadata(
            nimi_shell_tauri::runtime_bridge::RUNTIME_APP_GET_ACCOUNT_APP_LIBRARY_METHOD_ID,
            crate::runtime_bridge::generated::GetAccountAppLibraryRequest {},
            crate::runtime_bridge::RuntimeBridgeMetadata {
                app_id: Some(ACCOUNT_APP_LIBRARY_DESKTOP_APP_ID.to_string()),
                caller_kind: Some("desktop-core".to_string()),
                caller_id: Some(ACCOUNT_APP_LIBRARY_CALLER_ID.to_string()),
                surface_id: Some(ACCOUNT_APP_LIBRARY_SURFACE_ID.to_string()),
                ..Default::default()
            },
            Some(10_000),
        )
        .await?;
    if !response.exists {
        return Ok(None);
    }
    response
        .record
        .map(account_app_library_record_from_runtime)
        .map(Some)
        .ok_or_else(|| "Runtime account app-library response missing record".to_string())
}

fn account_app_library_record_from_runtime(
    record: crate::runtime_bridge::generated::AccountAppLibraryRecord,
) -> AccountAppLibraryRecord {
    AccountAppLibraryRecord {
        schema_version: record.schema_version,
        account_id: record.account_id,
        updated_at: record.updated_at,
        apps: record
            .apps
            .into_iter()
            .map(|row| AccountAppLibraryRow {
                app_id: row.app_id,
                library_state: row.library_state,
                installed: row.installed,
                last_opened_at: Some(row.last_opened_at).filter(|value| !value.trim().is_empty()),
                data_policy: row.data_policy,
            })
            .collect(),
    }
}
