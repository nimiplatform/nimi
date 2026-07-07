// Standard shell `file-dialog.open` (nimi.shell.fileDialog.open).
//
// Host-native picker via rfd. Kit owns payload validation and the wire
// result shape; the OS owns which paths the user may pick.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock};

static FILE_DIALOG_SELECTED_PATHS: OnceLock<RwLock<HashSet<PathBuf>>> = OnceLock::new();

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardFileDialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardFileDialogOpenPayload {
    /// "file" or "directory".
    pub kind: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub filters: Option<Vec<StandardFileDialogFilter>>,
    #[serde(default)]
    pub multiple: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardFileDialogOpenResult {
    pub canceled: bool,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StandardFileDialogKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedFileDialogRequest {
    pub kind: StandardFileDialogKind,
    pub title: Option<String>,
    pub filters: Vec<StandardFileDialogFilter>,
    pub multiple: bool,
}

fn selected_path_registry() -> &'static RwLock<HashSet<PathBuf>> {
    FILE_DIALOG_SELECTED_PATHS.get_or_init(|| RwLock::new(HashSet::new()))
}

pub(crate) fn register_file_dialog_selected_paths(paths: &[PathBuf]) -> Result<(), String> {
    let mut registry = selected_path_registry().write().map_err(|_| {
        dialog_error(
            "host-internal-error",
            "tauri-standard-file-dialog-registry-poisoned",
            "restart_app_to_recover_file_dialog_registry",
            None,
        )
    })?;
    registry.extend(paths.iter().cloned());
    Ok(())
}

pub(crate) fn is_registered_file_dialog_selected_path(canonical: &Path) -> bool {
    selected_path_registry()
        .read()
        .map(|registry| registry.contains(canonical))
        .unwrap_or(false)
}

pub(crate) fn parse_file_dialog_open_payload(
    payload: Value,
) -> Result<ValidatedFileDialogRequest, String> {
    let parsed =
        serde_json::from_value::<StandardFileDialogOpenPayload>(payload).map_err(|error| {
            dialog_error(
                "invalid-payload",
                "tauri-standard-file-dialog-payload-invalid",
                "send_file_dialog_kind_filters_multiple",
                Some(error.to_string()),
            )
        })?;
    let kind = match parsed.kind.trim() {
        "file" => StandardFileDialogKind::File,
        "directory" => StandardFileDialogKind::Directory,
        other => {
            return Err(dialog_error(
                "invalid-payload",
                "tauri-standard-file-dialog-kind-invalid",
                "use_file_or_directory_dialog_kind",
                Some(other.to_string()),
            ));
        }
    };
    let filters = parsed.filters.unwrap_or_default();
    if kind == StandardFileDialogKind::Directory && !filters.is_empty() {
        return Err(dialog_error(
            "invalid-payload",
            "tauri-standard-file-dialog-directory-filters-forbidden",
            "omit_filters_for_directory_dialog",
            None,
        ));
    }
    for filter in &filters {
        if filter.name.trim().is_empty()
            || filter.extensions.is_empty()
            || filter
                .extensions
                .iter()
                .any(|extension| extension.trim().is_empty())
        {
            return Err(dialog_error(
                "invalid-payload",
                "tauri-standard-file-dialog-filter-invalid",
                "provide_named_filters_with_non_empty_extensions",
                None,
            ));
        }
    }
    Ok(ValidatedFileDialogRequest {
        kind,
        title: parsed
            .title
            .map(|title| title.trim().to_string())
            .filter(|title| !title.is_empty()),
        filters,
        multiple: parsed.multiple.unwrap_or(false),
    })
}

pub fn file_dialog_open(payload: Value) -> Result<StandardFileDialogOpenResult, String> {
    let request = parse_file_dialog_open_payload(payload)?;
    let mut dialog = rfd::FileDialog::new();
    if let Some(title) = request.title {
        dialog = dialog.set_title(title);
    }
    for filter in &request.filters {
        let extensions = filter
            .extensions
            .iter()
            .map(|extension| extension.trim().trim_start_matches('.').to_string())
            .collect::<Vec<_>>();
        dialog = dialog.add_filter(filter.name.trim(), &extensions);
    }
    let selected: Option<Vec<std::path::PathBuf>> = match (request.kind, request.multiple) {
        (StandardFileDialogKind::File, false) => dialog.pick_file().map(|path| vec![path]),
        (StandardFileDialogKind::File, true) => dialog.pick_files(),
        (StandardFileDialogKind::Directory, false) => dialog.pick_folder().map(|path| vec![path]),
        (StandardFileDialogKind::Directory, true) => dialog.pick_folders(),
    };
    Ok(match selected {
        Some(paths) if !paths.is_empty() => {
            let canonical_paths = paths
                .into_iter()
                .map(validate_selected_file_dialog_path)
                .collect::<Result<Vec<_>, _>>()?;
            register_file_dialog_selected_paths(canonical_paths.as_slice())?;
            StandardFileDialogOpenResult {
                canceled: false,
                paths: canonical_paths
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect(),
            }
        }
        _ => StandardFileDialogOpenResult {
            canceled: true,
            paths: Vec::new(),
        },
    })
}

fn validate_selected_file_dialog_path(path: PathBuf) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(dialog_error(
            "host-internal-error",
            "tauri-standard-file-dialog-selected-path-not-absolute",
            "inspect_host_file_dialog_selection",
            Some(path.display().to_string()),
        ));
    }
    path.canonicalize().map_err(|error| {
        dialog_error(
            "host-internal-error",
            "tauri-standard-file-dialog-selected-path-unavailable",
            "inspect_host_file_dialog_selection",
            Some(format!("{} ({error})", path.display())),
        )
    })
}

fn dialog_error(code: &str, reason_code: &str, action_hint: &str, cause: Option<String>) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": "file_dialog_open", "cause": cause })),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        is_registered_file_dialog_selected_path, parse_file_dialog_open_payload,
        register_file_dialog_selected_paths, StandardFileDialogKind,
    };
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-standard-file-dialog-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn reason_code(error: &str) -> String {
        serde_json::from_str::<Value>(error)
            .expect("standard shell error envelope")
            .get("reasonCode")
            .and_then(Value::as_str)
            .expect("reasonCode")
            .to_string()
    }

    #[test]
    fn parse_accepts_file_kind_with_filters_and_defaults_multiple_false() {
        let request = parse_file_dialog_open_payload(json!({
            "kind": "file",
            "filters": [{ "name": "Images", "extensions": ["png", "jpg"] }],
        }))
        .expect("valid payload");
        assert_eq!(request.kind, StandardFileDialogKind::File);
        assert!(!request.multiple);
        assert_eq!(request.filters.len(), 1);
    }

    #[test]
    fn parse_accepts_optional_dialog_title() {
        let request = parse_file_dialog_open_payload(json!({
            "kind": "file",
            "title": "Pick an image",
        }))
        .expect("title is part of the standard file dialog payload");
        assert_eq!(request.title.as_deref(), Some("Pick an image"));
    }

    #[test]
    fn parse_rejects_unknown_kind() {
        let error = parse_file_dialog_open_payload(json!({ "kind": "folder" }))
            .expect_err("unknown kind rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-standard-file-dialog-kind-invalid"
        );
    }

    #[test]
    fn parse_rejects_unknown_payload_fields() {
        let error = parse_file_dialog_open_payload(json!({
            "kind": "file",
            "defaultPath": "/tmp",
        }))
        .expect_err("unknown field rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-standard-file-dialog-payload-invalid"
        );
    }

    #[test]
    fn parse_rejects_filters_on_directory_dialog() {
        let error = parse_file_dialog_open_payload(json!({
            "kind": "directory",
            "filters": [{ "name": "Images", "extensions": ["png"] }],
        }))
        .expect_err("directory filters rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-standard-file-dialog-directory-filters-forbidden"
        );
    }

    #[test]
    fn parse_rejects_empty_filter_definitions() {
        let error = parse_file_dialog_open_payload(json!({
            "kind": "file",
            "filters": [{ "name": "Broken", "extensions": [] }],
        }))
        .expect_err("empty extensions rejected");
        assert_eq!(
            reason_code(error.as_str()),
            "tauri-standard-file-dialog-filter-invalid"
        );
    }

    #[test]
    fn selected_path_registry_tracks_canonical_paths_for_later_reveal() {
        let dir = temp_dir("registry");
        let file = dir.join("picked.txt");
        std::fs::write(&file, b"picked").expect("write picked file");
        let canonical = file.canonicalize().expect("canonical selected file");

        register_file_dialog_selected_paths(&[canonical.clone()]).expect("register selected file");

        assert!(is_registered_file_dialog_selected_path(&canonical));
    }
}
