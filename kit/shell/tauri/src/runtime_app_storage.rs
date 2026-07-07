use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const STANDARD_STORAGE_BINDING_TIMEOUT_MS: u64 = 10_000;

/// Renderer-supplied storage payloads must never carry root/path authority.
/// Mirrors the Electron host's assertNoRendererStorageRootFields discipline.
const FORBIDDEN_RENDERER_STORAGE_ROOT_FIELDS: &[&str] = &[
    "path",
    "root",
    "storageRoot",
    "absolutePath",
    "dataRoot",
    "cacheRoot",
    "tempRoot",
];

pub fn canonical_storage_root(root: &str, label: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(root.trim());
    if !path.is_absolute() {
        return Err(format!(
            "{label} must be an absolute Runtime app storage root"
        ));
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("create {label} failed ({}): {error}", path.display()))?;
    path.canonicalize()
        .map_err(|error| format!("resolve {label} failed: {error}"))
}

pub fn scoped_storage_child(
    root: &str,
    label: &str,
    child: impl AsRef<Path>,
) -> Result<PathBuf, String> {
    let root = canonical_storage_root(root, label)?;
    let child_path = root.join(child.as_ref());
    if let Some(parent) = child_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "create {label} child directory failed ({}): {error}",
                parent.display()
            )
        })?;
    }
    let parent = child_path
        .parent()
        .ok_or_else(|| format!("{label} child has no parent"))?
        .canonicalize()
        .map_err(|error| format!("resolve {label} child parent failed: {error}"))?;
    if !parent.starts_with(&root) {
        return Err(format!("{label} child escapes Runtime app storage root"));
    }
    Ok(child_path)
}

/// How the standard app storage roots are obtained. Renderer code never
/// supplies roots; the host resolves them from Runtime truth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StandardDataRootBinding {
    /// Resolve roots by calling Runtime
    /// `/nimi.runtime.v1.RuntimeAppService/GetAppStorage` for `app_id`.
    RuntimeGetAppStorage { app_id: String },
    /// Roots were already projected by the Runtime launch flow; bind them
    /// directly. `projection_ref` records where the projection came from.
    RuntimeLaunchProjection {
        durable_data_root: PathBuf,
        cache_root: Option<PathBuf>,
        temp_root: Option<PathBuf>,
        projection_ref: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StandardAppStorageRoots {
    data_root: PathBuf,
    cache_root: Option<PathBuf>,
    temp_root: Option<PathBuf>,
}

impl StandardAppStorageRoots {
    pub fn data_root(&self) -> &Path {
        &self.data_root
    }

    pub fn cache_root(&self) -> Option<&Path> {
        self.cache_root.as_deref()
    }

    pub fn temp_root(&self) -> Option<&Path> {
        self.temp_root.as_deref()
    }
}

/// Managed Tauri state slot for the standard app storage roots. Apps
/// `.manage(StandardAppStorageRootSlot::empty())` (or a resolved slot) and
/// bind roots from a `StandardDataRootBinding`; commands fail closed while
/// the slot is unbound.
#[derive(Debug, Default)]
pub struct StandardAppStorageRootSlot(RwLock<Option<StandardAppStorageRoots>>);

impl StandardAppStorageRootSlot {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn from_roots(roots: StandardAppStorageRoots) -> Self {
        Self(RwLock::new(Some(roots)))
    }

    pub async fn from_binding_resolved(binding: StandardDataRootBinding) -> Result<Self, String> {
        Ok(Self::from_roots(
            resolve_standard_app_storage_roots(binding).await?,
        ))
    }

    pub fn bind(&self, roots: StandardAppStorageRoots) -> Result<(), String> {
        let mut slot = self.0.write().map_err(|_| {
            binding_error(
                "host-internal-error",
                "tauri-standard-storage-binding-slot-poisoned",
                "restart_app_to_recover_standard_storage_binding",
                None,
            )
        })?;
        *slot = Some(roots);
        Ok(())
    }

    pub fn current(&self) -> Option<StandardAppStorageRoots> {
        self.0.read().ok().and_then(|slot| slot.clone())
    }
}

pub fn require_bound_standard_storage_roots(
    slot: &StandardAppStorageRootSlot,
    _command: &str,
) -> Result<StandardAppStorageRoots, String> {
    slot.current().ok_or_else(|| {
        crate::capabilities::standard_shell_error(
            "capability-unavailable",
            "tauri-standard-storage-binding-missing",
            "manage_standard_app_storage_root_from_runtime_binding",
            "tauri",
            None,
        )
    })
}

pub async fn resolve_standard_app_storage_roots(
    binding: StandardDataRootBinding,
) -> Result<StandardAppStorageRoots, String> {
    match binding {
        StandardDataRootBinding::RuntimeGetAppStorage { app_id } => {
            let app_id = app_id.trim().to_string();
            if app_id.is_empty() {
                return Err(binding_error(
                    "invalid-payload",
                    "tauri-standard-storage-binding-app-id-required",
                    "provide_runtime_app_id_for_storage_binding",
                    None,
                ));
            }
            let response: crate::runtime_bridge::generated::GetAppStorageResponse =
                crate::runtime_bridge::invoke_unary_typed_with_metadata(
                    crate::runtime_bridge::RUNTIME_APP_GET_APP_STORAGE_METHOD_ID,
                    crate::runtime_bridge::generated::GetAppStorageRequest {
                        app_id: app_id.clone(),
                    },
                    crate::runtime_bridge::RuntimeBridgeMetadata {
                        app_id: Some(app_id.clone()),
                        ..Default::default()
                    },
                    Some(STANDARD_STORAGE_BINDING_TIMEOUT_MS),
                )
                .await
                .map_err(|cause| {
                    binding_error(
                        "capability-unavailable",
                        "tauri-standard-storage-binding-get-app-storage-failed",
                        "start_runtime_daemon_before_standard_storage_binding",
                        Some(cause),
                    )
                })?;
            let projection = response.projection.ok_or_else(|| {
                binding_error(
                    "host-internal-error",
                    "tauri-standard-storage-binding-projection-missing",
                    "inspect_runtime_get_app_storage_response",
                    Some(format!("appId={app_id}")),
                )
            })?;
            if projection.state != crate::runtime_bridge::generated::AppStorageState::Ready as i32 {
                return Err(binding_error(
                    "capability-unavailable",
                    "tauri-standard-storage-binding-projection-not-ready",
                    "install_or_repair_app_storage_before_binding",
                    Some(format!("appId={app_id} state={}", projection.state)),
                ));
            }
            build_standard_app_storage_roots(
                Path::new(projection.durable_data_root.trim()),
                optional_projected_root(projection.cache_root.as_str()).as_deref(),
                optional_projected_root(projection.temp_root.as_str()).as_deref(),
            )
        }
        StandardDataRootBinding::RuntimeLaunchProjection {
            durable_data_root,
            cache_root,
            temp_root,
            projection_ref,
        } => {
            if projection_ref.trim().is_empty() {
                return Err(binding_error(
                    "invalid-payload",
                    "tauri-standard-storage-binding-projection-ref-required",
                    "provide_runtime_launch_projection_ref",
                    None,
                ));
            }
            build_standard_app_storage_roots(
                durable_data_root.as_path(),
                cache_root.as_deref(),
                temp_root.as_deref(),
            )
        }
    }
}

fn optional_projected_root(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn build_standard_app_storage_roots(
    data_root: &Path,
    cache_root: Option<&Path>,
    temp_root: Option<&Path>,
) -> Result<StandardAppStorageRoots, String> {
    Ok(StandardAppStorageRoots {
        data_root: canonical_binding_root(data_root, "durable_data_root")?,
        cache_root: cache_root
            .map(|root| canonical_binding_root(root, "cache_root"))
            .transpose()?,
        temp_root: temp_root
            .map(|root| canonical_binding_root(root, "temp_root"))
            .transpose()?,
    })
}

fn canonical_binding_root(path: &Path, label: &str) -> Result<PathBuf, String> {
    let raw = path.as_os_str().to_string_lossy();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(binding_error(
            "invalid-path",
            "tauri-standard-storage-binding-root-required",
            "provide_absolute_runtime_projected_storage_root",
            Some(format!("{label} is empty")),
        ));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(binding_error(
            "invalid-path",
            "tauri-standard-storage-binding-root-not-absolute",
            "provide_absolute_runtime_projected_storage_root",
            Some(format!("{label}: {}", path.display())),
        ));
    }
    fs::create_dir_all(&path).map_err(|error| {
        binding_error(
            "host-internal-error",
            "tauri-standard-storage-binding-root-create-failed",
            "inspect_standard_storage_host_permissions",
            Some(format!("{label} ({}): {error}", path.display())),
        )
    })?;
    path.canonicalize().map_err(|error| {
        binding_error(
            "host-internal-error",
            "tauri-standard-storage-binding-root-resolve-failed",
            "inspect_standard_storage_host_permissions",
            Some(format!("{label} ({}): {error}", path.display())),
        )
    })
}

fn binding_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "binding": "standard-app-storage", "cause": cause })),
    )
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardStoragePathPayload {
    pub relative_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardStorageWriteJsonPayload {
    pub relative_path: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardPathResolveResult {
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardStorageJsonResult {
    pub path: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardStorageRemoveJsonResult {
    pub path: String,
    pub removed: bool,
}

/// Parses a renderer storage payload fail-closed: rejects renderer-supplied
/// root/path authority fields before typed deserialization.
pub fn parse_standard_storage_payload<T: DeserializeOwned>(
    payload: Value,
    command: &str,
) -> Result<T, String> {
    let object = payload.as_object().ok_or_else(|| {
        storage_error(
            "invalid-payload",
            "tauri-standard-storage-payload-not-object",
            "send_structured_standard_storage_payload",
            command,
            None,
            None,
        )
    })?;
    for field in FORBIDDEN_RENDERER_STORAGE_ROOT_FIELDS {
        if object.contains_key(*field) {
            return Err(storage_error(
                "invalid-payload",
                "tauri-standard-storage-renderer-field-forbidden",
                "send_relative_path_only_for_standard_storage",
                command,
                None,
                Some(format!("forbidden renderer field: {field}")),
            ));
        }
    }
    serde_json::from_value::<T>(payload).map_err(|error| {
        storage_error(
            "invalid-payload",
            "tauri-standard-storage-payload-invalid",
            "send_declared_standard_storage_payload_fields",
            command,
            None,
            Some(error.to_string()),
        )
    })
}

pub fn data_path_resolve_for_roots(
    roots: &StandardAppStorageRoots,
    payload: StandardStoragePathPayload,
) -> Result<StandardPathResolveResult, String> {
    let path =
        resolve_standard_storage_child(roots, payload.relative_path.as_str(), "data_path_resolve")?;
    Ok(StandardPathResolveResult {
        path: path.display().to_string(),
    })
}

pub fn storage_read_json_for_roots(
    roots: &StandardAppStorageRoots,
    payload: StandardStoragePathPayload,
) -> Result<StandardStorageJsonResult, String> {
    let path =
        resolve_standard_storage_child(roots, payload.relative_path.as_str(), "storage_read_json")?;
    if !path.exists() {
        return Err(storage_error(
            "not-found",
            "tauri-standard-storage-json-not-found",
            "write_storage_json_before_reading_it",
            "storage_read_json",
            Some(path.as_path()),
            None,
        ));
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-read-failed",
            "inspect_standard_storage_host_permissions",
            "storage_read_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    let value = serde_json::from_str::<Value>(raw.as_str()).map_err(|error| {
        storage_error(
            "invalid-payload",
            "tauri-standard-storage-json-invalid",
            "repair_or_replace_storage_json",
            "storage_read_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    Ok(StandardStorageJsonResult {
        path: path.display().to_string(),
        value,
    })
}

pub fn storage_write_json_for_roots(
    roots: &StandardAppStorageRoots,
    payload: StandardStorageWriteJsonPayload,
) -> Result<StandardStorageJsonResult, String> {
    let path = resolve_standard_storage_child(
        roots,
        payload.relative_path.as_str(),
        "storage_write_json",
    )?;
    let body = serde_json::to_string_pretty(&payload.value).map_err(|error| {
        storage_error(
            "invalid-payload",
            "tauri-standard-storage-json-serialize-failed",
            "provide_json_serializable_storage_value",
            "storage_write_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    let tmp_path = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("storage-json"),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&tmp_path, body).map_err(|error| {
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-temp-write-failed",
            "inspect_standard_storage_host_permissions",
            "storage_write_json",
            Some(tmp_path.as_path()),
            Some(error.to_string()),
        )
    })?;
    fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-rename-failed",
            "inspect_standard_storage_host_permissions",
            "storage_write_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    Ok(StandardStorageJsonResult {
        path: path.display().to_string(),
        value: payload.value,
    })
}

pub fn storage_remove_json_for_roots(
    roots: &StandardAppStorageRoots,
    payload: StandardStoragePathPayload,
) -> Result<StandardStorageRemoveJsonResult, String> {
    let path = resolve_standard_storage_child(
        roots,
        payload.relative_path.as_str(),
        "storage_remove_json",
    )?;
    if !path.exists() {
        return Ok(StandardStorageRemoveJsonResult {
            path: path.display().to_string(),
            removed: false,
        });
    }
    fs::remove_file(&path).map_err(|error| {
        storage_error(
            "host-internal-error",
            "tauri-standard-storage-json-remove-failed",
            "inspect_standard_storage_host_permissions",
            "storage_remove_json",
            Some(path.as_path()),
            Some(error.to_string()),
        )
    })?;
    Ok(StandardStorageRemoveJsonResult {
        path: path.display().to_string(),
        removed: true,
    })
}

pub(crate) fn resolve_standard_storage_child(
    roots: &StandardAppStorageRoots,
    relative_path: &str,
    command: &str,
) -> Result<PathBuf, String> {
    let normalized = relative_path.trim();
    if normalized.is_empty() {
        return Err(storage_error(
            "invalid-path",
            "tauri-standard-storage-relative-path-required",
            "provide_app_relative_storage_path",
            command,
            None,
            None,
        ));
    }
    let child = Path::new(normalized);
    if child.is_absolute() {
        return Err(storage_error(
            "invalid-path",
            "tauri-standard-storage-absolute-path-forbidden",
            "provide_app_relative_storage_path",
            command,
            None,
            None,
        ));
    }
    scoped_storage_child(
        roots.data_root().to_str().unwrap_or_default(),
        "standard app storage root",
        child,
    )
    .map_err(|error| {
        storage_error(
            "invalid-path",
            "tauri-standard-storage-relative-path-invalid",
            "provide_app_relative_storage_path",
            command,
            None,
            Some(error),
        )
    })
}

fn storage_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    command: &str,
    path: Option<&Path>,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({
            "command": command,
            "path": path.map(|value| value.display().to_string()),
            "cause": cause,
        })),
    )
}

#[cfg(test)]
pub(crate) fn test_standard_app_storage_roots(root: impl Into<PathBuf>) -> StandardAppStorageRoots {
    build_standard_app_storage_roots(root.into().as_path(), None, None)
        .expect("test standard app storage roots")
}

#[cfg(test)]
mod tests;
