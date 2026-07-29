use serde::{Deserialize, Serialize};

/// Portable AI profile payload. Mirrors the SDK `AIProfile` type: a portable
/// configuration template, not a live `AIConfig`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibraryAIProfilePayload {
    pub profile_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub title: String,
    pub description: String,
    pub tags: Vec<String>,
    pub capabilities: serde_json::Map<String, serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_bindings: Option<Vec<serde_json::Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_params: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editable_fields: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepare_requirements: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract_states: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub projection_warnings: Option<Vec<String>>,
}

/// One editable account profile library entry record persisted under `user/`
/// or `imported/` as `<profileId>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProfileRecord {
    pub schema_version: u32,
    pub account_id: String,
    /// `"user"` for user-created profiles, `"imported"` for imported profiles.
    pub origin: String,
    pub profile: LibraryAIProfilePayload,
    pub created_at: String,
    pub updated_at: String,
}

/// One row of the `index.json` account profile library index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexEntry {
    pub profile_id: String,
    pub title: String,
    /// `"account-default"`, `"user"`, or `"imported"`.
    pub origin: String,
    /// Library-root-relative path of the entry record file.
    pub relative_path: String,
    pub editable: bool,
    pub removable: bool,
    pub updated_at: String,
}

/// The `index.json` account profile library index record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexRecord {
    pub schema_version: u32,
    pub account_id: String,
    pub updated_at: String,
    pub entries: Vec<LibraryIndexEntry>,
}

/// One projected library profile returned to the renderer. Carries the full
/// AIProfile payload plus library provenance.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryProfileProjection {
    pub profile_id: String,
    pub origin: String,
    pub editable: bool,
    pub removable: bool,
    pub created_at: String,
    pub updated_at: String,
    pub profile: LibraryAIProfilePayload,
}

/// The full account profile library projection returned by list/mutation
/// commands: the re-derived index plus every editable library profile payload.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfileLibraryProjection {
    pub account_id: String,
    pub library_ref: String,
    pub index: LibraryIndexRecord,
    /// Editable library profiles (`user/` + `imported/`). The Account Default
    /// Profile is referenced by the index but is NOT projected here.
    pub profiles: Vec<LibraryProfileProjection>,
}
