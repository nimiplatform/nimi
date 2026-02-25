use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditRecordPayload {
    pub id: String,
    pub mod_id: Option<String>,
    pub stage: Option<String>,
    pub event_type: String,
    pub decision: Option<String>,
    pub reason_codes: Option<Vec<String>>,
    pub payload: Option<serde_json::Value>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAuditFilter {
    pub mod_id: Option<String>,
    pub stage: Option<String>,
    pub event_type: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionIdempotencyRecordPayload {
    pub principal_id: String,
    pub action_id: String,
    pub idempotency_key: String,
    pub input_digest: String,
    pub response: serde_json::Value,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionVerifyTicketPayload {
    pub ticket_id: String,
    pub principal_id: String,
    pub action_id: String,
    pub trace_id: String,
    pub input_digest: String,
    pub issued_at: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerRecordPayload {
    pub execution_id: String,
    pub action_id: String,
    pub principal_id: String,
    pub phase: String,
    pub status: String,
    pub trace_id: String,
    pub reason_code: Option<String>,
    pub payload: Option<serde_json::Value>,
    pub occurred_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionExecutionLedgerFilter {
    pub action_id: Option<String>,
    pub principal_id: Option<String>,
    pub phase: Option<String>,
    pub status: Option<String>,
    pub trace_id: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExternalAgentActionScope {
    pub action_id: String,
    pub ops: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentTokenRecordPayload {
    pub token_id: String,
    pub principal_id: String,
    pub mode: String,
    pub subject_account_id: String,
    pub actions: Vec<String>,
    pub scopes: Vec<RuntimeExternalAgentActionScope>,
    pub issuer: String,
    pub issued_at: String,
    pub expires_at: String,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLocalManifestSummary {
    pub path: String,
    pub id: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub entry: Option<String>,
    pub entry_path: Option<String>,
    pub description: Option<String>,
    pub manifest: Option<serde_json::Value>,
}

const DEFAULT_MOD_MARKER_FILE: &str = ".nimi-default-managed.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedDefaultModMarker {
    managed: bool,
    mod_id: String,
    version: Option<String>,
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 app_data_dir: {error}"))?;
    fs::create_dir_all(&base_dir).map_err(|error| format!("无法创建 app_data_dir: {error}"))?;
    Ok(base_dir.join("runtime-mod.db"))
}

pub fn open_db(app: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    let conn = Connection::open(path).map_err(|error| format!("无法打开 SQLite: {error}"))?;
    init_schema(&conn)?;
    Ok(conn)
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(segment) => normalized.push(segment),
        }
    }
    normalized
}

fn ensure_existing_directory(path: &Path, env_name: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("{env_name} 指向的目录不存在: {}", path.display()));
    }
    if !path.is_dir() {
        return Err(format!(
            "{env_name} 必须指向目录，当前值: {}",
            path.display()
        ));
    }
    Ok(())
}

fn resolve_required_absolute_dir_env(env_name: &str) -> Result<PathBuf, String> {
    let raw =
        std::env::var(env_name).map_err(|_| format!("开发模式必须设置 {env_name}（绝对路径）"))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("开发模式必须设置 {env_name}（绝对路径）"));
    }
    let provided = PathBuf::from(trimmed);
    if !provided.is_absolute() {
        return Err(format!("{env_name} 必须是绝对路径，当前值: {trimmed}"));
    }
    let normalized = normalize_absolute_path(&provided);
    ensure_existing_directory(&normalized, env_name)?;
    Ok(normalized)
}

fn ensure_runtime_matches_mods_root(
    runtime_mods_dir: &Path,
    mods_root: &Path,
) -> Result<(), String> {
    ensure_existing_directory(runtime_mods_dir, "NIMI_RUNTIME_MODS_DIR")?;
    ensure_existing_directory(mods_root, "NIMI_MODS_ROOT")?;
    let runtime_normalized = normalize_absolute_path(runtime_mods_dir);
    let mods_root_normalized = normalize_absolute_path(mods_root);
    if runtime_normalized != mods_root_normalized {
        return Err(format!(
            "开发模式要求 NIMI_RUNTIME_MODS_DIR 与 NIMI_MODS_ROOT 指向同一路径。\nNIMI_RUNTIME_MODS_DIR={}\nNIMI_MODS_ROOT={}",
            runtime_normalized.display(),
            mods_root_normalized.display()
        ));
    }
    Ok(())
}

fn local_mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(custom_dir) = std::env::var("NIMI_RUNTIME_MODS_DIR") {
        let trimmed = custom_dir.trim();
        if !trimmed.is_empty() {
            let provided = PathBuf::from(trimmed);
            if !provided.is_absolute() {
                return Err(format!(
                    "NIMI_RUNTIME_MODS_DIR 必须是绝对路径，当前值: {}",
                    trimmed
                ));
            }
            let normalized_runtime_dir = normalize_absolute_path(&provided);
            if cfg!(debug_assertions) {
                let mods_root = resolve_required_absolute_dir_env("NIMI_MODS_ROOT")?;
                ensure_runtime_matches_mods_root(&normalized_runtime_dir, &mods_root)?;
            }
            return Ok(normalized_runtime_dir);
        }
    }

    if cfg!(debug_assertions) {
        return Err(
            "开发模式必须设置 NIMI_RUNTIME_MODS_DIR（绝对路径，且与 NIMI_MODS_ROOT 保持一致）"
                .to_string(),
        );
    }

    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 app_data_dir: {error}"))?;
    Ok(base_dir.join("mods"))
}

fn extract_manifest_summary(path: &Path, value: &JsonValue) -> Option<RuntimeLocalManifestSummary> {
    let object = value.as_object()?;
    let id = object.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }

    let read_opt = |key: &str| -> Option<String> {
        object
            .get(key)
            .and_then(|item| item.as_str())
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
    };

    let entry = read_opt("entry");
    let entry_path = entry.as_ref().and_then(|entry_value| {
        let parent = path.parent()?;
        let candidate = parent.join(entry_value);
        Some(candidate.display().to_string())
    });

    Some(RuntimeLocalManifestSummary {
        path: path.display().to_string(),
        id: id.to_string(),
        name: read_opt("name"),
        version: read_opt("version"),
        entry,
        entry_path,
        description: read_opt("description"),
        manifest: Some(value.clone()),
    })
}

fn parse_manifest_file(path: &Path) -> Option<RuntimeLocalManifestSummary> {
    let content = fs::read_to_string(path).ok()?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let value = if extension == "json" {
        serde_json::from_str::<JsonValue>(&content).ok()?
    } else if extension == "yaml" || extension == "yml" {
        serde_yaml::from_str::<JsonValue>(&content).ok()?
    } else {
        return None;
    };

    extract_manifest_summary(path, &value)
}

fn parse_semver_parts(input: &str) -> Vec<u64> {
    input
        .split(['-', '+'])
        .next()
        .unwrap_or_default()
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

fn compare_versions(left: Option<&str>, right: Option<&str>) -> Ordering {
    let left_parts = parse_semver_parts(left.unwrap_or_default());
    let right_parts = parse_semver_parts(right.unwrap_or_default());
    let max_len = left_parts.len().max(right_parts.len());
    for index in 0..max_len {
        let left_value = *left_parts.get(index).unwrap_or(&0);
        let right_value = *right_parts.get(index).unwrap_or(&0);
        if left_value < right_value {
            return Ordering::Less;
        }
        if left_value > right_value {
            return Ordering::Greater;
        }
    }
    Ordering::Equal
}

fn find_manifest_path(dir: &Path) -> Option<PathBuf> {
    let candidates = [
        dir.join("mod.manifest.yaml"),
        dir.join("mod.manifest.yml"),
        dir.join("mod.manifest.json"),
    ];
    candidates.into_iter().find(|candidate| candidate.exists())
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("创建目录失败 ({}): {error}", target.display()))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("读取目录失败 ({}): {error}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
            continue;
        }
        if source_path.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("创建目标父目录失败 ({}): {error}", parent.display())
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "复制文件失败 ({} -> {}): {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

fn marker_path(mod_dir: &Path) -> PathBuf {
    mod_dir.join(DEFAULT_MOD_MARKER_FILE)
}

fn read_default_mod_marker(mod_dir: &Path) -> Option<ManagedDefaultModMarker> {
    let path = marker_path(mod_dir);
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ManagedDefaultModMarker>(&content).ok()
}

fn write_default_mod_marker(
    mod_dir: &Path,
    mod_id: &str,
    version: Option<&str>,
) -> Result<(), String> {
    let marker = ManagedDefaultModMarker {
        managed: true,
        mod_id: mod_id.to_string(),
        version: version
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    let marker_content = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("序列化默认 mod 标记失败: {error}"))?;
    fs::write(marker_path(mod_dir), marker_content)
        .map_err(|error| format!("写入默认 mod 标记失败: {error}"))
}

fn has_custom_mods_dir_override() -> bool {
    std::env::var("NIMI_RUNTIME_MODS_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn bundled_default_mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法获取 resource_dir: {error}"))?;
    Ok(resource_dir.join("default-mods"))
}

fn sync_default_mods_from_resources(app: &AppHandle, mods_dir: &Path) -> Result<(), String> {
    if cfg!(debug_assertions) || has_custom_mods_dir_override() {
        return Ok(());
    }

    let source_root = bundled_default_mods_dir(app)?;
    if !source_root.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&source_root).map_err(|error| {
        format!(
            "读取 default-mods 资源目录失败 ({}): {error}",
            source_root.display()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 default-mods 子项失败: {error}"))?;
        let source_mod_dir = entry.path();
        if !source_mod_dir.is_dir() {
            continue;
        }

        let source_manifest_path = match find_manifest_path(&source_mod_dir) {
            Some(path) => path,
            None => continue,
        };
        let source_summary = match parse_manifest_file(&source_manifest_path) {
            Some(summary) => summary,
            None => continue,
        };

        let target_mod_dir = mods_dir.join(entry.file_name());
        let source_version = source_summary.version.as_deref();

        if !target_mod_dir.exists() {
            copy_dir_recursive(&source_mod_dir, &target_mod_dir)?;
            write_default_mod_marker(&target_mod_dir, &source_summary.id, source_version)?;
            continue;
        }

        let marker = match read_default_mod_marker(&target_mod_dir) {
            Some(value) => value,
            None => continue,
        };
        if !marker.managed || marker.mod_id != source_summary.id {
            continue;
        }

        let target_manifest_path = match find_manifest_path(&target_mod_dir) {
            Some(path) => path,
            None => continue,
        };
        let target_summary = parse_manifest_file(&target_manifest_path);
        let target_version = target_summary
            .as_ref()
            .and_then(|summary| summary.version.as_deref());
        if compare_versions(source_version, target_version) != Ordering::Greater {
            continue;
        }

        fs::remove_dir_all(&target_mod_dir).map_err(|error| {
            format!(
                "删除旧默认 mod 目录失败 ({}): {error}",
                target_mod_dir.display()
            )
        })?;
        copy_dir_recursive(&source_mod_dir, &target_mod_dir)?;
        write_default_mod_marker(&target_mod_dir, &source_summary.id, source_version)?;
    }

    Ok(())
}

pub fn list_local_mod_manifests(
    app: &AppHandle,
) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    let mods_dir = local_mods_dir(app)?;
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("创建 mods 目录失败 ({}): {error}", mods_dir.display()))?;
    if let Err(error) = sync_default_mods_from_resources(app, &mods_dir) {
        eprintln!(
            "[runtime_mod] sync_default_mods_from_resources failed ({}): {}",
            mods_dir.display(),
            error
        );
    }
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    let entries = fs::read_dir(&mods_dir)
        .map_err(|error| format!("读取 mods 目录失败 ({}): {error}", mods_dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 mods 子目录失败: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let candidates = [
            path.join("mod.manifest.yaml"),
            path.join("mod.manifest.yml"),
            path.join("mod.manifest.json"),
        ];
        let matched_path = candidates.into_iter().find(|candidate| candidate.exists());
        let Some(manifest_path) = matched_path else {
            continue;
        };

        if let Some(summary) = parse_manifest_file(&manifest_path) {
            manifests.push(summary);
        }
    }

    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(manifests)
}

fn normalize_local_mod_entry_path_from_base(
    base_mods_dir: &Path,
    target: &str,
) -> Result<PathBuf, String> {
    let base = base_mods_dir.canonicalize().map_err(|error| {
        format!(
            "规范化 mods 目录失败 ({}): {error}",
            base_mods_dir.display()
        )
    })?;
    let raw_target = PathBuf::from(target);
    let candidate = if raw_target.is_absolute() {
        raw_target
    } else {
        base.join(raw_target)
    };
    let normalized = candidate
        .canonicalize()
        .map_err(|error| format!("规范化 entry 路径失败 ({}): {error}", candidate.display()))?;

    if !normalized.starts_with(&base) {
        return Err(format!(
            "拒绝访问 mods 目录外的路径: {}",
            normalized.display()
        ));
    }

    Ok(normalized)
}

fn normalize_local_mod_entry_path(app: &AppHandle, target: &str) -> Result<PathBuf, String> {
    let mods_dir = local_mods_dir(app)?;
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("创建 mods 目录失败 ({}): {error}", mods_dir.display()))?;
    normalize_local_mod_entry_path_from_base(&mods_dir, target)
}

pub fn read_local_mod_entry(app: &AppHandle, path: &str) -> Result<String, String> {
    let normalized = normalize_local_mod_entry_path(app, path)?;
    fs::read_to_string(&normalized)
        .map_err(|error| format!("读取 mod entry 失败 ({}): {error}", normalized.display()))
}

#[cfg(test)]
mod tests {
    use super::{ensure_runtime_matches_mods_root, normalize_local_mod_entry_path_from_base};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-runtime-mod-store-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn normalize_local_mod_entry_path_allows_in_root_file() {
        let root = make_temp_root("allow-in-root");
        let mods_dir = root.join("mods");
        let entry = mods_dir
            .join("local-chat")
            .join("dist")
            .join("mods")
            .join("local-chat")
            .join("index.js");
        fs::create_dir_all(entry.parent().expect("entry parent")).expect("create entry parent");
        fs::write(&entry, "export {};\n").expect("write entry");

        let normalized = normalize_local_mod_entry_path_from_base(
            &mods_dir,
            "local-chat/dist/mods/local-chat/index.js",
        )
        .expect("normalize entry path");
        assert_eq!(
            normalized,
            entry.canonicalize().expect("canonical entry path")
        );

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn normalize_local_mod_entry_path_rejects_relative_escape() {
        let root = make_temp_root("reject-relative-escape");
        let mods_dir = root.join("mods");
        fs::create_dir_all(&mods_dir).expect("create mods dir");
        let outside = root.join("outside.js");
        fs::write(&outside, "export {};\n").expect("write outside file");

        let error = normalize_local_mod_entry_path_from_base(&mods_dir, "../outside.js")
            .expect_err("relative escape should be rejected");
        assert!(error.contains("拒绝访问 mods 目录外的路径"));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn normalize_local_mod_entry_path_rejects_absolute_outside_path() {
        let root = make_temp_root("reject-absolute-escape");
        let mods_dir = root.join("mods");
        fs::create_dir_all(&mods_dir).expect("create mods dir");
        let outside = root.join("outside-absolute.js");
        fs::write(&outside, "export {};\n").expect("write outside file");

        let error = normalize_local_mod_entry_path_from_base(
            &mods_dir,
            outside
                .to_str()
                .expect("outside path must be valid utf-8 for test"),
        )
        .expect_err("absolute outside path should be rejected");
        assert!(error.contains("拒绝访问 mods 目录外的路径"));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn ensure_runtime_matches_mods_root_accepts_same_path() {
        let root = make_temp_root("runtime-root-same");
        let mods_root = root.join("nimi-mods");
        fs::create_dir_all(&mods_root).expect("create mods root");

        ensure_runtime_matches_mods_root(&mods_root, &mods_root)
            .expect("same path should pass contract");

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn ensure_runtime_matches_mods_root_rejects_mismatch_path() {
        let root = make_temp_root("runtime-root-mismatch");
        let mods_root = root.join("nimi-mods");
        let runtime_mods_dir = root.join("runtime-mods");
        fs::create_dir_all(&mods_root).expect("create mods root");
        fs::create_dir_all(&runtime_mods_dir).expect("create runtime mods dir");

        let error = ensure_runtime_matches_mods_root(&runtime_mods_dir, &mods_root)
            .expect_err("mismatched directories should fail contract");
        assert!(error.contains("NIMI_RUNTIME_MODS_DIR"));
        assert!(error.contains("NIMI_MODS_ROOT"));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS runtime_audit_records (
          id TEXT PRIMARY KEY,
          mod_id TEXT,
          stage TEXT,
          event_type TEXT NOT NULL,
          decision TEXT,
          reason_codes TEXT,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_runtime_audit_mod_time ON runtime_audit_records(mod_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_runtime_audit_stage_time ON runtime_audit_records(stage, occurred_at);
        CREATE TABLE IF NOT EXISTS action_idempotency_records (
          principal_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          input_digest TEXT NOT NULL,
          response TEXT NOT NULL,
          occurred_at TEXT NOT NULL,
          PRIMARY KEY (principal_id, action_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS idx_action_idempotency_time ON action_idempotency_records(occurred_at);
        CREATE TABLE IF NOT EXISTS action_verify_tickets (
          ticket_id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          input_digest TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_verify_tickets_principal ON action_verify_tickets(principal_id, action_id, expires_at);
        CREATE TABLE IF NOT EXISTS action_execution_ledger (
          ledger_id TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL,
          action_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          phase TEXT NOT NULL,
          status TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          reason_code TEXT,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_execution_ledger_action_time ON action_execution_ledger(action_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_action_execution_ledger_execution_time ON action_execution_ledger(execution_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_action_execution_ledger_principal_time ON action_execution_ledger(principal_id, occurred_at);
        CREATE TABLE IF NOT EXISTS action_audit_records (
          audit_id TEXT PRIMARY KEY,
          action_id TEXT NOT NULL,
          principal_id TEXT NOT NULL,
          trace_id TEXT NOT NULL,
          reason_code TEXT NOT NULL,
          payload TEXT,
          occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_action_audit_records_trace_time ON action_audit_records(trace_id, occurred_at);
        CREATE TABLE IF NOT EXISTS external_agent_tokens (
          token_id TEXT PRIMARY KEY,
          principal_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          subject_account_id TEXT NOT NULL,
          actions TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          issuer TEXT NOT NULL,
          issued_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_external_agent_tokens_principal_time ON external_agent_tokens(principal_id, issued_at);
        CREATE INDEX IF NOT EXISTS idx_external_agent_tokens_expiry ON external_agent_tokens(expires_at);
        CREATE TABLE IF NOT EXISTS runtime_kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| format!("初始化 runtime_mod schema 失败: {error}"))?;

    ensure_required_columns(
        conn,
        "action_idempotency_records",
        &[
            "principal_id",
            "action_id",
            "idempotency_key",
            "input_digest",
            "response",
            "occurred_at",
        ],
    )?;
    ensure_required_columns(
        conn,
        "external_agent_tokens",
        &[
            "token_id",
            "principal_id",
            "mode",
            "subject_account_id",
            "actions",
            "scopes",
            "issuer",
            "issued_at",
            "expires_at",
            "revoked_at",
        ],
    )?;
    ensure_required_columns(
        conn,
        "action_execution_ledger",
        &[
            "ledger_id",
            "execution_id",
            "action_id",
            "principal_id",
            "phase",
            "status",
            "trace_id",
            "reason_code",
            "payload",
            "occurred_at",
        ],
    )?;

    Ok(())
}

fn has_column(conn: &Connection, table_name: &str, column_name: &str) -> Result<bool, String> {
    let mut statement = conn
        .prepare(format!("PRAGMA table_info({table_name})").as_str())
        .map_err(|error| format!("读取 {table_name} schema 失败: {error}"))?;
    let mut rows = statement
        .query([])
        .map_err(|error| format!("查询 {table_name} schema 失败: {error}"))?;
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 {table_name} schema 行失败: {error}"))?
    {
        let name: String = row
            .get(1)
            .map_err(|error| format!("读取 {table_name} column name 失败: {error}"))?;
        if name == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_required_columns(
    conn: &Connection,
    table_name: &str,
    required_columns: &[&str],
) -> Result<(), String> {
    let mut missing_columns = Vec::new();
    for column_name in required_columns {
        if !has_column(conn, table_name, column_name)? {
            missing_columns.push(*column_name);
        }
    }
    if !missing_columns.is_empty() {
        return Err(format!(
            "RUNTIME_MOD_SCHEMA_MISMATCH: table={table_name} missing_columns={} actionHint=delete_local_runtime_mod_db_and_restart",
            missing_columns.join(",")
        ));
    }
    Ok(())
}

fn validate_rfc3339(s: &str) -> bool {
    // Basic RFC3339 validation: YYYY-MM-DDTHH:MM:SS
    s.len() >= 19
        && s.as_bytes().get(4) == Some(&b'-')
        && s.as_bytes().get(7) == Some(&b'-')
        && s.as_bytes().get(10) == Some(&b'T')
        && s.as_bytes().get(13) == Some(&b':')
}

pub fn append_runtime_audit(
    conn: &Connection,
    record: &RuntimeAuditRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.occurred_at) {
        return Err(format!("occurred_at 格式无效: {}", record.occurred_at));
    }

    let reason_codes_text = record
        .reason_codes
        .as_ref()
        .map(|items| serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string()));
    let payload_text = record
        .payload
        .as_ref()
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()));

    conn.execute(
        r#"
        INSERT INTO runtime_audit_records (
          id, mod_id, stage, event_type, decision, reason_codes, payload, occurred_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
          mod_id = excluded.mod_id,
          stage = excluded.stage,
          event_type = excluded.event_type,
          decision = excluded.decision,
          reason_codes = excluded.reason_codes,
          payload = excluded.payload,
          occurred_at = excluded.occurred_at
        "#,
        params![
            record.id,
            record.mod_id,
            record.stage,
            record.event_type,
            record.decision,
            reason_codes_text,
            payload_text,
            record.occurred_at
        ],
    )
    .map_err(|error| format!("写入 runtime audit 失败: {error}"))?;
    Ok(())
}

pub fn query_runtime_audit(
    conn: &Connection,
    filter: Option<RuntimeAuditFilter>,
) -> Result<Vec<RuntimeAuditRecordPayload>, String> {
    let normalized = filter.unwrap_or(RuntimeAuditFilter {
        mod_id: None,
        stage: None,
        event_type: None,
        from: None,
        to: None,
        limit: Some(200),
    });

    let limit = normalized.limit.unwrap_or(200).max(1).min(1000) as i64;

    let mut statement = conn
        .prepare(
            r#"
            SELECT id, mod_id, stage, event_type, decision, reason_codes, payload, occurred_at
            FROM runtime_audit_records
            WHERE (?1 IS NULL OR mod_id = ?1)
              AND (?2 IS NULL OR stage = ?2)
              AND (?3 IS NULL OR event_type = ?3)
              AND (?4 IS NULL OR occurred_at >= ?4)
              AND (?5 IS NULL OR occurred_at <= ?5)
            ORDER BY occurred_at DESC
            LIMIT ?6
            "#,
        )
        .map_err(|error| format!("查询 runtime audit 失败: {error}"))?;

    let rows = statement
        .query_map(
            params![
                normalized.mod_id,
                normalized.stage,
                normalized.event_type,
                normalized.from,
                normalized.to,
                limit
            ],
            |row| {
                let reason_codes_text: Option<String> = row.get(5)?;
                let payload_text: Option<String> = row.get(6)?;
                let reason_codes = reason_codes_text
                    .and_then(|text| serde_json::from_str::<Vec<String>>(&text).ok());
                let payload = payload_text
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
                Ok(RuntimeAuditRecordPayload {
                    id: row.get(0)?,
                    mod_id: row.get(1)?,
                    stage: row.get(2)?,
                    event_type: row.get(3)?,
                    decision: row.get(4)?,
                    reason_codes,
                    payload,
                    occurred_at: row.get(7)?,
                })
            },
        )
        .map_err(|error| format!("解析 runtime audit 失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 runtime audit 失败: {error}"))
}

pub fn put_action_execution_ledger_record(
    conn: &Connection,
    record: &RuntimeActionExecutionLedgerRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.occurred_at) {
        return Err(format!("occurred_at 格式无效: {}", record.occurred_at));
    }
    if record.execution_id.trim().is_empty()
        || record.action_id.trim().is_empty()
        || record.principal_id.trim().is_empty()
        || record.phase.trim().is_empty()
        || record.status.trim().is_empty()
        || record.trace_id.trim().is_empty()
    {
        return Err("execution/action/principal/phase/status/trace 不能为空".to_string());
    }
    let payload_text = record
        .payload
        .as_ref()
        .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string()));
    conn.execute(
        r#"
        INSERT INTO action_execution_ledger (
          ledger_id, execution_id, action_id, principal_id, phase, status, trace_id, reason_code, payload, occurred_at
        )
        VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            record.execution_id,
            record.action_id,
            record.principal_id,
            record.phase,
            record.status,
            record.trace_id,
            record.reason_code,
            payload_text,
            record.occurred_at
        ],
    )
    .map_err(|error| format!("写入 action execution ledger 失败: {error}"))?;
    Ok(())
}

pub fn query_action_execution_ledger(
    conn: &Connection,
    filter: Option<RuntimeActionExecutionLedgerFilter>,
) -> Result<Vec<RuntimeActionExecutionLedgerRecordPayload>, String> {
    let normalized = filter.unwrap_or(RuntimeActionExecutionLedgerFilter {
        action_id: None,
        principal_id: None,
        phase: None,
        status: None,
        trace_id: None,
        from: None,
        to: None,
        limit: Some(200),
    });
    let limit = normalized.limit.unwrap_or(200).max(1).min(2000) as i64;
    let mut statement = conn
        .prepare(
            r#"
            SELECT execution_id, action_id, principal_id, phase, status, trace_id, reason_code, payload, occurred_at
            FROM action_execution_ledger
            WHERE (?1 IS NULL OR action_id = ?1)
              AND (?2 IS NULL OR principal_id = ?2)
              AND (?3 IS NULL OR phase = ?3)
              AND (?4 IS NULL OR status = ?4)
              AND (?5 IS NULL OR trace_id = ?5)
              AND (?6 IS NULL OR occurred_at >= ?6)
              AND (?7 IS NULL OR occurred_at <= ?7)
            ORDER BY occurred_at DESC
            LIMIT ?8
            "#,
        )
        .map_err(|error| format!("查询 action execution ledger 失败: {error}"))?;

    let rows = statement
        .query_map(
            params![
                normalized.action_id,
                normalized.principal_id,
                normalized.phase,
                normalized.status,
                normalized.trace_id,
                normalized.from,
                normalized.to,
                limit
            ],
            |row| {
                let payload_text: Option<String> = row.get(7)?;
                let payload = payload_text
                    .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
                Ok(RuntimeActionExecutionLedgerRecordPayload {
                    execution_id: row.get(0)?,
                    action_id: row.get(1)?,
                    principal_id: row.get(2)?,
                    phase: row.get(3)?,
                    status: row.get(4)?,
                    trace_id: row.get(5)?,
                    reason_code: row.get(6)?,
                    payload,
                    occurred_at: row.get(8)?,
                })
            },
        )
        .map_err(|error| format!("解析 action execution ledger 失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 action execution ledger 失败: {error}"))
}

pub fn purge_action_execution_ledger(conn: &Connection, before: &str) -> Result<usize, String> {
    if !validate_rfc3339(before) {
        return Err(format!("before 格式无效: {before}"));
    }
    conn.execute(
        r#"
        DELETE FROM action_execution_ledger
        WHERE occurred_at < ?1
        "#,
        params![before],
    )
    .map_err(|error| format!("清理 action execution ledger 失败: {error}"))
}

pub fn put_action_idempotency_record(
    conn: &Connection,
    record: &RuntimeActionIdempotencyRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.occurred_at) {
        return Err(format!("occurred_at 格式无效: {}", record.occurred_at));
    }
    if record.input_digest.trim().is_empty() {
        return Err("input_digest 不能为空".to_string());
    }
    let response_text = serde_json::to_string(&record.response)
        .map_err(|error| format!("序列化 action idempotency response 失败: {error}"))?;
    conn.execute(
        r#"
        INSERT INTO action_idempotency_records (
          principal_id, action_id, idempotency_key, input_digest, response, occurred_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(principal_id, action_id, idempotency_key) DO UPDATE SET
          input_digest = excluded.input_digest,
          response = excluded.response,
          occurred_at = excluded.occurred_at
        "#,
        params![
            record.principal_id,
            record.action_id,
            record.idempotency_key,
            record.input_digest,
            response_text,
            record.occurred_at
        ],
    )
    .map_err(|error| format!("写入 action idempotency 失败: {error}"))?;
    Ok(())
}

pub fn get_action_idempotency_record(
    conn: &Connection,
    principal_id: &str,
    action_id: &str,
    idempotency_key: &str,
) -> Result<Option<RuntimeActionIdempotencyRecordPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT principal_id, action_id, idempotency_key, input_digest, response, occurred_at
            FROM action_idempotency_records
            WHERE principal_id = ?1
              AND action_id = ?2
              AND idempotency_key = ?3
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 action idempotency 失败: {error}"))?;

    let mut rows = statement
        .query(params![principal_id, action_id, idempotency_key])
        .map_err(|error| format!("执行 action idempotency 查询失败: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 action idempotency 查询结果失败: {error}"))?
    {
        let response_text: String = row
            .get(4)
            .map_err(|error| format!("读取 action idempotency response 失败: {error}"))?;
        let response = serde_json::from_str::<serde_json::Value>(&response_text)
            .map_err(|error| format!("解析 action idempotency response 失败: {error}"))?;
        return Ok(Some(RuntimeActionIdempotencyRecordPayload {
            principal_id: row
                .get(0)
                .map_err(|error| format!("读取 action idempotency principal_id 失败: {error}"))?,
            action_id: row
                .get(1)
                .map_err(|error| format!("读取 action idempotency action_id 失败: {error}"))?,
            idempotency_key: row
                .get(2)
                .map_err(|error| format!("读取 action idempotency key 失败: {error}"))?,
            input_digest: row
                .get(3)
                .map_err(|error| format!("读取 action idempotency input_digest 失败: {error}"))?,
            response,
            occurred_at: row
                .get(5)
                .map_err(|error| format!("读取 action idempotency occurred_at 失败: {error}"))?,
        }));
    }
    Ok(None)
}

pub fn purge_action_idempotency_records(conn: &Connection, before: &str) -> Result<usize, String> {
    if !validate_rfc3339(before) {
        return Err(format!("before 格式无效: {before}"));
    }
    conn.execute(
        r#"
        DELETE FROM action_idempotency_records
        WHERE occurred_at < ?1
        "#,
        params![before],
    )
    .map_err(|error| format!("清理 action idempotency 失败: {error}"))
}

pub fn put_action_verify_ticket(
    conn: &Connection,
    ticket: &RuntimeActionVerifyTicketPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&ticket.issued_at) {
        return Err(format!("issued_at 格式无效: {}", ticket.issued_at));
    }
    if !validate_rfc3339(&ticket.expires_at) {
        return Err(format!("expires_at 格式无效: {}", ticket.expires_at));
    }
    if ticket.ticket_id.trim().is_empty() {
        return Err("ticket_id 不能为空".to_string());
    }
    if ticket.principal_id.trim().is_empty() || ticket.action_id.trim().is_empty() {
        return Err("principal_id/action_id 不能为空".to_string());
    }
    if ticket.trace_id.trim().is_empty() || ticket.input_digest.trim().is_empty() {
        return Err("trace_id/input_digest 不能为空".to_string());
    }
    conn.execute(
        r#"
        INSERT INTO action_verify_tickets (
          ticket_id, principal_id, action_id, trace_id, input_digest, issued_at, expires_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(ticket_id) DO UPDATE SET
          principal_id = excluded.principal_id,
          action_id = excluded.action_id,
          trace_id = excluded.trace_id,
          input_digest = excluded.input_digest,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at
        "#,
        params![
            ticket.ticket_id,
            ticket.principal_id,
            ticket.action_id,
            ticket.trace_id,
            ticket.input_digest,
            ticket.issued_at,
            ticket.expires_at
        ],
    )
    .map_err(|error| format!("写入 action verify ticket 失败: {error}"))?;
    Ok(())
}

pub fn get_action_verify_ticket(
    conn: &Connection,
    ticket_id: &str,
) -> Result<Option<RuntimeActionVerifyTicketPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT ticket_id, principal_id, action_id, trace_id, input_digest, issued_at, expires_at
            FROM action_verify_tickets
            WHERE ticket_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 action verify ticket 失败: {error}"))?;

    let mut rows = statement
        .query(params![ticket_id])
        .map_err(|error| format!("执行 action verify ticket 查询失败: {error}"))?;

    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 action verify ticket 查询结果失败: {error}"))?
    {
        return Ok(Some(RuntimeActionVerifyTicketPayload {
            ticket_id: row
                .get(0)
                .map_err(|error| format!("读取 ticket_id 失败: {error}"))?,
            principal_id: row
                .get(1)
                .map_err(|error| format!("读取 principal_id 失败: {error}"))?,
            action_id: row
                .get(2)
                .map_err(|error| format!("读取 action_id 失败: {error}"))?,
            trace_id: row
                .get(3)
                .map_err(|error| format!("读取 trace_id 失败: {error}"))?,
            input_digest: row
                .get(4)
                .map_err(|error| format!("读取 input_digest 失败: {error}"))?,
            issued_at: row
                .get(5)
                .map_err(|error| format!("读取 issued_at 失败: {error}"))?,
            expires_at: row
                .get(6)
                .map_err(|error| format!("读取 expires_at 失败: {error}"))?,
        }));
    }
    Ok(None)
}

pub fn delete_action_verify_ticket(conn: &Connection, ticket_id: &str) -> Result<usize, String> {
    conn.execute(
        r#"
        DELETE FROM action_verify_tickets
        WHERE ticket_id = ?1
        "#,
        params![ticket_id],
    )
    .map_err(|error| format!("删除 action verify ticket 失败: {error}"))
}

pub fn purge_action_verify_tickets(conn: &Connection, before: &str) -> Result<usize, String> {
    if !validate_rfc3339(before) {
        return Err(format!("before 格式无效: {before}"));
    }
    conn.execute(
        r#"
        DELETE FROM action_verify_tickets
        WHERE expires_at < ?1
        "#,
        params![before],
    )
    .map_err(|error| format!("清理 action verify tickets 失败: {error}"))
}

pub fn upsert_external_agent_token_record(
    conn: &Connection,
    record: &ExternalAgentTokenRecordPayload,
) -> Result<(), String> {
    if !validate_rfc3339(&record.issued_at) {
        return Err(format!("issued_at 格式无效: {}", record.issued_at));
    }
    if !validate_rfc3339(&record.expires_at) {
        return Err(format!("expires_at 格式无效: {}", record.expires_at));
    }
    if let Some(revoked_at) = &record.revoked_at {
        if !validate_rfc3339(revoked_at) {
            return Err(format!("revoked_at 格式无效: {revoked_at}"));
        }
    }
    let actions_text = serde_json::to_string(&record.actions)
        .map_err(|error| format!("序列化 token actions 失败: {error}"))?;
    let scopes_text = serde_json::to_string(&record.scopes)
        .map_err(|error| format!("序列化 token scopes 失败: {error}"))?;
    conn.execute(
        r#"
        INSERT INTO external_agent_tokens (
          token_id, principal_id, mode, subject_account_id, actions, scopes, issuer, issued_at, expires_at, revoked_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(token_id) DO UPDATE SET
          principal_id = excluded.principal_id,
          mode = excluded.mode,
          subject_account_id = excluded.subject_account_id,
          actions = excluded.actions,
          scopes = excluded.scopes,
          issuer = excluded.issuer,
          issued_at = excluded.issued_at,
          expires_at = excluded.expires_at,
          revoked_at = excluded.revoked_at
        "#,
        params![
            record.token_id,
            record.principal_id,
            record.mode,
            record.subject_account_id,
            actions_text,
            scopes_text,
            record.issuer,
            record.issued_at,
            record.expires_at,
            record.revoked_at
        ],
    )
    .map_err(|error| format!("写入 external agent token 失败: {error}"))?;
    Ok(())
}

pub fn revoke_external_agent_token_record(
    conn: &Connection,
    token_id: &str,
    revoked_at: &str,
) -> Result<bool, String> {
    if !validate_rfc3339(revoked_at) {
        return Err(format!("revoked_at 格式无效: {revoked_at}"));
    }
    let changed = conn
        .execute(
            r#"
            UPDATE external_agent_tokens
            SET revoked_at = ?2
            WHERE token_id = ?1
            "#,
            params![token_id, revoked_at],
        )
        .map_err(|error| format!("吊销 external agent token 失败: {error}"))?;
    Ok(changed > 0)
}

pub fn get_external_agent_token_record(
    conn: &Connection,
    token_id: &str,
) -> Result<Option<ExternalAgentTokenRecordPayload>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT token_id, principal_id, mode, subject_account_id, actions, scopes, issuer, issued_at, expires_at, revoked_at
            FROM external_agent_tokens
            WHERE token_id = ?1
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 external agent token 失败: {error}"))?;

    let mut rows = statement
        .query(params![token_id])
        .map_err(|error| format!("执行 external agent token 查询失败: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 external agent token 失败: {error}"))?
    {
        let actions_text: String = row
            .get(4)
            .map_err(|error| format!("读取 external agent token actions 失败: {error}"))?;
        let actions = serde_json::from_str::<Vec<String>>(&actions_text).unwrap_or_default();
        let scopes_text: String = row
            .get(5)
            .map_err(|error| format!("读取 external agent token scopes 失败: {error}"))?;
        let scopes = serde_json::from_str::<Vec<RuntimeExternalAgentActionScope>>(&scopes_text)
            .unwrap_or_default();
        return Ok(Some(ExternalAgentTokenRecordPayload {
            token_id: row
                .get(0)
                .map_err(|error| format!("读取 external agent token token_id 失败: {error}"))?,
            principal_id: row
                .get(1)
                .map_err(|error| format!("读取 external agent token principal_id 失败: {error}"))?,
            mode: row
                .get(2)
                .map_err(|error| format!("读取 external agent token mode 失败: {error}"))?,
            subject_account_id: row.get(3).map_err(|error| {
                format!("读取 external agent token subject_account_id 失败: {error}")
            })?,
            actions,
            scopes,
            issuer: row
                .get(6)
                .map_err(|error| format!("读取 external agent token issuer 失败: {error}"))?,
            issued_at: row
                .get(7)
                .map_err(|error| format!("读取 external agent token issued_at 失败: {error}"))?,
            expires_at: row
                .get(8)
                .map_err(|error| format!("读取 external agent token expires_at 失败: {error}"))?,
            revoked_at: row
                .get(9)
                .map_err(|error| format!("读取 external agent token revoked_at 失败: {error}"))?,
        }));
    }
    Ok(None)
}

pub fn list_external_agent_token_records(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<ExternalAgentTokenRecordPayload>, String> {
    let normalized_limit = limit.max(1).min(1000) as i64;
    let mut statement = conn
        .prepare(
            r#"
            SELECT token_id, principal_id, mode, subject_account_id, actions, scopes, issuer, issued_at, expires_at, revoked_at
            FROM external_agent_tokens
            ORDER BY issued_at DESC
            LIMIT ?1
            "#,
        )
        .map_err(|error| format!("查询 external agent token 列表失败: {error}"))?;

    let rows = statement
        .query_map(params![normalized_limit], |row| {
            let actions_text: String = row.get(4)?;
            let actions = serde_json::from_str::<Vec<String>>(&actions_text).unwrap_or_default();
            let scopes_text: String = row.get(5)?;
            let scopes = serde_json::from_str::<Vec<RuntimeExternalAgentActionScope>>(&scopes_text)
                .unwrap_or_default();
            Ok(ExternalAgentTokenRecordPayload {
                token_id: row.get(0)?,
                principal_id: row.get(1)?,
                mode: row.get(2)?,
                subject_account_id: row.get(3)?,
                actions,
                scopes,
                issuer: row.get(6)?,
                issued_at: row.get(7)?,
                expires_at: row.get(8)?,
                revoked_at: row.get(9)?,
            })
        })
        .map_err(|error| format!("解析 external agent token 列表失败: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 external agent token 列表失败: {error}"))
}

pub fn set_runtime_kv(
    conn: &Connection,
    key: &str,
    value: &str,
    updated_at: &str,
) -> Result<(), String> {
    if !validate_rfc3339(updated_at) {
        return Err(format!("updated_at 格式无效: {updated_at}"));
    }
    conn.execute(
        r#"
        INSERT INTO runtime_kv_store (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
        "#,
        params![key, value, updated_at],
    )
    .map_err(|error| format!("写入 runtime kv 失败: {error}"))?;
    Ok(())
}

pub fn get_runtime_kv(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT value
            FROM runtime_kv_store
            WHERE key = ?1
            LIMIT 1
            "#,
        )
        .map_err(|error| format!("查询 runtime kv 失败: {error}"))?;
    let mut rows = statement
        .query(params![key])
        .map_err(|error| format!("执行 runtime kv 查询失败: {error}"))?;
    if let Some(row) = rows
        .next()
        .map_err(|error| format!("读取 runtime kv 查询结果失败: {error}"))?
    {
        let value: String = row
            .get(0)
            .map_err(|error| format!("读取 runtime kv value 失败: {error}"))?;
        return Ok(Some(value));
    }
    Ok(None)
}
