use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Manager;

pub type StandardLocalAssetRootsHook = Arc<dyn Fn() -> Result<Vec<PathBuf>, String> + Send + Sync>;

#[derive(Clone, Default)]
pub struct StandardLocalAssetsHostHooks {
    pub local_asset_roots: Option<StandardLocalAssetRootsHook>,
}

static LOCAL_ASSETS_HOST_HOOKS: OnceLock<Mutex<StandardLocalAssetsHostHooks>> = OnceLock::new();

pub fn set_standard_local_assets_host_hooks(
    hooks: StandardLocalAssetsHostHooks,
) -> Result<(), String> {
    if LOCAL_ASSETS_HOST_HOOKS.get().is_some() {
        #[cfg(test)]
        {
            let existing = LOCAL_ASSETS_HOST_HOOKS
                .get()
                .ok_or_else(|| "STANDARD_LOCAL_ASSETS_HOST_HOOKS_MISSING".to_string())?;
            *existing
                .lock()
                .map_err(|_| "STANDARD_LOCAL_ASSETS_HOST_HOOKS_LOCK_POISONED".to_string())? = hooks;
            return Ok(());
        }
        #[cfg(not(test))]
        {
            return Err("STANDARD_LOCAL_ASSETS_HOST_HOOKS_ALREADY_SET".to_string());
        }
    }
    LOCAL_ASSETS_HOST_HOOKS
        .set(Mutex::new(hooks))
        .map_err(|_| "STANDARD_LOCAL_ASSETS_HOST_HOOKS_ALREADY_SET".to_string())
}

fn host_hooks() -> Option<StandardLocalAssetsHostHooks> {
    LOCAL_ASSETS_HOST_HOOKS
        .get()
        .and_then(|hooks| hooks.lock().ok().map(|hooks| hooks.clone()))
}

fn host_local_asset_roots() -> Result<Vec<PathBuf>, String> {
    match host_hooks().and_then(|hooks| hooks.local_asset_roots.clone()) {
        Some(hook) => hook(),
        None => Ok(Vec::new()),
    }
}

pub(crate) fn canonical_host_local_asset_roots(command: &str) -> Result<Vec<PathBuf>, String> {
    canonical_admitted_local_asset_roots(&host_local_asset_roots()?, command)
}

pub(crate) fn canonical_admitted_local_asset_roots(
    roots: &[PathBuf],
    command: &str,
) -> Result<Vec<PathBuf>, String> {
    roots
        .iter()
        .map(|root| {
            let raw = root.as_os_str().to_string_lossy();
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err(local_asset_error(
                    "invalid-path",
                    "tauri-standard-local-asset-root-required",
                    "provide_absolute_creatable_local_asset_roots",
                    command,
                    None,
                ));
            }
            let path = PathBuf::from(trimmed);
            if !path.is_absolute() {
                return Err(local_asset_error(
                    "invalid-path",
                    "tauri-standard-local-asset-root-not-absolute",
                    "provide_absolute_creatable_local_asset_roots",
                    command,
                    Some(path.display().to_string()),
                ));
            }
            fs::create_dir_all(&path).map_err(|error| {
                local_asset_error(
                    "host-internal-error",
                    "tauri-standard-local-asset-root-create-failed",
                    "inspect_host_local_asset_root_permissions",
                    command,
                    Some(format!("{} ({error})", path.display())),
                )
            })?;
            path.canonicalize().map_err(|error| {
                local_asset_error(
                    "host-internal-error",
                    "tauri-standard-local-asset-root-resolve-failed",
                    "inspect_host_local_asset_root_permissions",
                    command,
                    Some(format!("{} ({error})", path.display())),
                )
            })
        })
        .collect()
}

pub(crate) fn is_admitted_local_asset_path(candidate: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| candidate.starts_with(root))
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardLocalAssetUrlPayload {
    pub path: Option<String>,
    pub relative_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardLocalAssetUrlResult {
    pub path: String,
    pub url: String,
}

pub fn resolve_standard_local_asset_url(
    app: &tauri::AppHandle,
    payload: Value,
    command: &str,
) -> Result<StandardLocalAssetUrlResult, String> {
    let path = resolve_standard_local_asset_path(payload, command)?;
    app.state::<tauri::scope::Scopes>()
        .allow_file(&path)
        .map_err(|error| {
            local_asset_error(
                "host-internal-error",
                "tauri-standard-local-asset-scope-allow-file-failed",
                "inspect_tauri_asset_protocol_scope",
                command,
                Some(format!("{} ({error})", path.display())),
            )
        })?;
    Ok(StandardLocalAssetUrlResult {
        path: path.display().to_string(),
        url: tauri_asset_url_for_file_path(path.as_path()),
    })
}

pub(crate) fn resolve_standard_local_asset_path(
    payload: Value,
    command: &str,
) -> Result<PathBuf, String> {
    let roots = canonical_host_local_asset_roots(command)?;
    resolve_standard_local_asset_path_with_roots(&roots, payload, command)
}

pub(crate) fn resolve_standard_local_asset_path_with_roots(
    canonical_roots: &[PathBuf],
    payload: Value,
    command: &str,
) -> Result<PathBuf, String> {
    if canonical_roots.is_empty() {
        return Err(local_asset_error(
            "capability-unavailable",
            "tauri-standard-local-asset-roots-missing",
            "bind_standard_local_asset_roots_from_host",
            command,
            None,
        ));
    }
    let parsed =
        serde_json::from_value::<StandardLocalAssetUrlPayload>(payload).map_err(|error| {
            local_asset_error(
                "invalid-path",
                "tauri-standard-local-asset-payload-invalid",
                "send_path_or_relative_path_inside_admitted_local_asset_root",
                command,
                Some(error.to_string()),
            )
        })?;
    let raw_path = parsed
        .path
        .or(parsed.relative_path)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            local_asset_error(
                "invalid-path",
                "tauri-standard-local-asset-path-required",
                "send_path_or_relative_path_inside_admitted_local_asset_root",
                command,
                None,
            )
        })?;
    let raw_candidate = PathBuf::from(raw_path.as_str());
    let candidates = if raw_candidate.is_absolute() {
        vec![raw_candidate]
    } else {
        canonical_roots
            .iter()
            .map(|root| root.join(raw_candidate.as_path()))
            .collect()
    };
    let mut first_missing: Option<(PathBuf, PathBuf)> = None;
    for candidate in candidates {
        let resolved_candidate = canonical_local_asset_candidate(candidate.as_path());
        let Some(owning_root) = canonical_roots
            .iter()
            .find(|root| resolved_candidate.starts_with(root.as_path()))
        else {
            continue;
        };
        if !resolved_candidate.exists() {
            first_missing
                .get_or_insert_with(|| (resolved_candidate.clone(), (*owning_root).clone()));
            continue;
        }
        let canonical = resolved_candidate.canonicalize().map_err(|error| {
            local_asset_error(
                "host-internal-error",
                "tauri-standard-local-asset-resolve-failed",
                "inspect_host_local_asset_permissions",
                command,
                Some(format!("{} ({error})", resolved_candidate.display())),
            )
        })?;
        if !canonical.starts_with(owning_root.as_path()) {
            return Err(local_asset_error(
                "invalid-path",
                "tauri-standard-local-asset-escapes-root",
                "use_asset_path_inside_admitted_local_asset_root",
                command,
                Some(format!(
                    "{} outside {}",
                    canonical.display(),
                    owning_root.display()
                )),
            ));
        }
        return Ok(canonical);
    }
    if let Some((missing, root)) = first_missing {
        return Err(local_asset_error(
            "not-found",
            "tauri-standard-local-asset-not-found",
            "materialize_local_asset_before_resolving_url",
            command,
            Some(format!("{} inside {}", missing.display(), root.display())),
        ));
    }
    Err(local_asset_error(
        "invalid-path",
        "tauri-standard-local-asset-outside-root",
        "provide_local_asset_path_inside_admitted_root",
        command,
        Some(raw_path),
    ))
}

fn canonical_local_asset_candidate(candidate: &Path) -> PathBuf {
    let mut current = candidate.to_path_buf();
    let mut missing_segments: Vec<PathBuf> = Vec::new();
    loop {
        match current.canonicalize() {
            Ok(canonical) => {
                return missing_segments
                    .into_iter()
                    .rev()
                    .fold(canonical, |path, segment| path.join(segment));
            }
            Err(_) => {
                let Some(parent) = current.parent() else {
                    return candidate.to_path_buf();
                };
                if parent == current {
                    return candidate.to_path_buf();
                }
                if let Some(name) = current.file_name() {
                    missing_segments.push(PathBuf::from(name));
                }
                current = parent.to_path_buf();
            }
        }
    }
}

pub(crate) fn tauri_asset_url_for_file_path(path: &Path) -> String {
    let encoded = encode_uri_component(path.as_os_str().to_string_lossy().as_ref());
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        format!("http://asset.localhost/{encoded}")
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        format!("asset://localhost/{encoded}")
    }
}

fn encode_uri_component(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(*byte as char);
        } else {
            out.push_str(format!("%{byte:02X}").as_str());
        }
    }
    out
}

fn local_asset_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    command: &str,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": command, "cause": cause })),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_admitted_local_asset_roots, resolve_standard_local_asset_path_with_roots,
        tauri_asset_url_for_file_path,
    };
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("nimi-standard-local-assets-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp root");
        dir
    }

    fn envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn resolves_relative_asset_inside_first_existing_root() {
        let first = temp_root("first");
        let second = temp_root("second");
        let asset = second.join("dist").join("icon.png");
        std::fs::create_dir_all(asset.parent().expect("parent")).expect("mkdir");
        std::fs::write(&asset, b"icon").expect("write asset");
        let roots =
            canonical_admitted_local_asset_roots(&[first, second], "local_assets_resolve_url")
                .expect("canonical roots");

        let resolved = resolve_standard_local_asset_path_with_roots(
            &roots,
            json!({ "relativePath": "dist/icon.png" }),
            "local_assets_resolve_url",
        )
        .expect("resolved asset");

        assert_eq!(resolved, asset.canonicalize().expect("canonical asset"));
    }

    #[test]
    fn reports_missing_relative_asset_as_not_found() {
        let root = temp_root("missing");
        let roots = canonical_admitted_local_asset_roots(&[root], "local_assets_resolve_url")
            .expect("roots");

        let error = resolve_standard_local_asset_path_with_roots(
            &roots,
            json!({ "relativePath": "dist/missing.png" }),
            "local_assets_resolve_url",
        )
        .expect_err("missing asset rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("not-found")
        );
    }

    #[test]
    fn rejects_absolute_asset_outside_admitted_roots() {
        let root = temp_root("root");
        let outside = temp_root("outside").join("leak.png");
        std::fs::write(&outside, b"leak").expect("write outside");
        let roots =
            canonical_admitted_local_asset_roots(&[root], "avatar_asset_resolve").expect("roots");

        let error = resolve_standard_local_asset_path_with_roots(
            &roots,
            json!({ "path": outside.display().to_string() }),
            "avatar_asset_resolve",
        )
        .expect_err("outside asset rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("invalid-path")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-standard-local-asset-outside-root")
        );
    }

    #[test]
    fn returns_capability_unavailable_without_bound_roots() {
        let error = resolve_standard_local_asset_path_with_roots(
            &[],
            json!({ "relativePath": "icon.png" }),
            "local_assets_resolve_url",
        )
        .expect_err("roots required");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("capability-unavailable")
        );
    }

    #[test]
    fn tauri_asset_url_uses_tauri_convert_file_src_encoding() {
        let path = PathBuf::from("C:\\Nimi Assets\\头像.png");
        let url = tauri_asset_url_for_file_path(path.as_path());

        #[cfg(any(target_os = "windows", target_os = "android"))]
        assert!(url.starts_with("http://asset.localhost/"));
        #[cfg(not(any(target_os = "windows", target_os = "android")))]
        assert!(url.starts_with("asset://localhost/"));
        assert!(url.contains("%20"));
        assert!(url.contains("%E5%A4%B4%E5%83%8F.png"));
    }
}
