use chrono::Utc as ChronoUtc;
use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::{HashMap as StdHashMap, HashSet as StdHashSet};
use std::sync::{Mutex as StdMutex, OnceLock as StdOnceLock};
use std::thread as std_thread;
use std::time::Duration as StdDuration;

const DEFAULT_INSTALLED_SOURCE_ID: &str = "default-installed";
const SOURCE_TYPE_INSTALLED: &str = "installed";
const SOURCE_TYPE_DEV: &str = "dev";
const RUNTIME_MOD_DEVELOPER_MODE_KEY: &str = "runtime_mod_developer_mode";
const RUNTIME_MOD_AUTO_RELOAD_KEY: &str = "runtime_mod_auto_reload_enabled";
const RUNTIME_MOD_SOURCE_CHANGED_EVENT: &str = "runtime-mod://source-changed";
const RUNTIME_MOD_RELOAD_RESULT_EVENT: &str = "runtime-mod://reload-result";

#[derive(Debug, Clone)]
struct RuntimeModDiscoverySnapshot {
    manifests: Vec<RuntimeLocalManifestSummary>,
    diagnostics: Vec<RuntimeModDiagnosticRecord>,
}

#[derive(Debug, Clone)]
struct RuntimeModSourceDebounceState {
    seq: u64,
    paths: Vec<String>,
}

fn runtime_mod_source_watchers() -> &'static StdMutex<StdHashMap<String, RecommendedWatcher>> {
    static STORE: StdOnceLock<StdMutex<StdHashMap<String, RecommendedWatcher>>> = StdOnceLock::new();
    STORE.get_or_init(|| StdMutex::new(StdHashMap::new()))
}

fn runtime_mod_source_debounce() -> &'static StdMutex<StdHashMap<String, RuntimeModSourceDebounceState>> {
    static STORE: StdOnceLock<StdMutex<StdHashMap<String, RuntimeModSourceDebounceState>>> = StdOnceLock::new();
    STORE.get_or_init(|| StdMutex::new(StdHashMap::new()))
}

fn runtime_mod_reload_results() -> &'static StdMutex<Vec<RuntimeModReloadResultPayload>> {
    static STORE: StdOnceLock<StdMutex<Vec<RuntimeModReloadResultPayload>>> = StdOnceLock::new();
    STORE.get_or_init(|| StdMutex::new(Vec::new()))
}

fn now_rfc3339_source_registry() -> String {
    ChronoUtc::now().to_rfc3339()
}

fn generate_source_id() -> String {
    format!(
        "runtime-mod-source-{}-{}",
        std::process::id(),
        ChronoUtc::now().timestamp_millis()
    )
}

fn normalize_source_type(source_type: &str) -> Result<String, String> {
    let normalized = source_type.trim().to_ascii_lowercase();
    match normalized.as_str() {
        SOURCE_TYPE_INSTALLED | SOURCE_TYPE_DEV => Ok(normalized),
        _ => Err(format!("不支持的 mod source type: {source_type}")),
    }
}

fn normalize_source_dir(source_dir: &str) -> Result<PathBuf, String> {
    let trimmed = source_dir.trim();
    if trimmed.is_empty() {
        return Err("mod source directory 不能为空".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!(
            "mod source directory 必须是绝对路径，当前值: {}",
            trimmed
        ));
    }
    Ok(normalize_absolute_path(&path))
}

fn runtime_mod_env_override_dir() -> Result<Option<PathBuf>, String> {
    if let Ok(custom_dir) = std::env::var("NIMI_RUNTIME_MODS_DIR") {
        let trimmed = custom_dir.trim();
        if !trimmed.is_empty() {
            return Ok(Some(normalize_source_dir(trimmed)?));
        }
    }
    Ok(None)
}

fn runtime_mod_default_source_record_for_dir(source_dir: &Path) -> RuntimeModSourceRecord {
    RuntimeModSourceRecord {
        source_id: DEFAULT_INSTALLED_SOURCE_ID.to_string(),
        source_type: SOURCE_TYPE_INSTALLED.to_string(),
        source_dir: source_dir.display().to_string(),
        enabled: true,
        is_default: true,
    }
}

fn runtime_mod_default_source_record(app: &AppHandle) -> Result<RuntimeModSourceRecord, String> {
    let source_dir = local_mods_dir(app)?;
    Ok(runtime_mod_default_source_record_for_dir(&source_dir))
}

fn source_record_from_row(row: &rusqlite::Row<'_>) -> Result<RuntimeModSourceRecord, rusqlite::Error> {
    Ok(RuntimeModSourceRecord {
        source_id: row.get(0)?,
        source_type: row.get(1)?,
        source_dir: row.get(2)?,
        enabled: row.get::<_, i64>(3)? != 0,
        is_default: row.get::<_, i64>(4)? != 0,
    })
}

fn ensure_default_runtime_mod_source_for_dir(
    conn: &Connection,
    source_dir: &Path,
    env_override_active: bool,
) -> Result<RuntimeModSourceRecord, String> {
    let default_record = runtime_mod_default_source_record_for_dir(source_dir);
    if env_override_active {
        return Ok(default_record);
    }
    conn.execute(
        r#"
        INSERT INTO runtime_mod_sources (
          source_id, source_type, source_dir, enabled, is_default, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, 1, 1, ?4, ?4)
        ON CONFLICT(source_id) DO UPDATE SET
          source_type = excluded.source_type,
          source_dir = excluded.source_dir,
          enabled = 1,
          is_default = 1,
          updated_at = excluded.updated_at
        "#,
        params![
            default_record.source_id.clone(),
            default_record.source_type.clone(),
            default_record.source_dir.clone(),
            now_rfc3339_source_registry()
        ],
    )
    .map_err(|error| format!("写入默认 mod source 失败: {error}"))?;
    Ok(default_record)
}

fn ensure_default_runtime_mod_source(conn: &Connection, app: &AppHandle) -> Result<RuntimeModSourceRecord, String> {
    let source_dir = local_mods_dir(app)?;
    ensure_default_runtime_mod_source_for_dir(
        conn,
        &source_dir,
        runtime_mod_env_override_dir()?.is_some(),
    )
}

fn validate_user_managed_source_input(
    source_type: &str,
    source_dir: &str,
    default_source_dir: &str,
) -> Result<(String, String), String> {
    let normalized_type = normalize_source_type(source_type)?;
    if normalized_type != SOURCE_TYPE_DEV {
        return Err("Desktop 只允许用户添加 dev source".to_string());
    }
    let normalized_dir = normalize_source_dir(source_dir)?.display().to_string();
    if normalized_dir == default_source_dir {
        return Err("默认 installed source 路径已由 Desktop 管理，不允许重复添加".to_string());
    }
    Ok((normalized_type, normalized_dir))
}

pub fn list_runtime_mod_sources(app: &AppHandle) -> Result<Vec<RuntimeModSourceRecord>, String> {
    let conn = open_db(app)?;
    let default_record = ensure_default_runtime_mod_source(&conn, app)?;
    let env_override_active = runtime_mod_env_override_dir()?.is_some();
    let mut statement = conn
        .prepare(
            r#"
            SELECT source_id, source_type, source_dir, enabled, is_default
            FROM runtime_mod_sources
            WHERE (?1 = 1 AND source_id != ?2) OR (?1 = 0)
            ORDER BY is_default DESC, source_type ASC, source_dir ASC
            "#,
        )
        .map_err(|error| format!("查询 mod source registry 失败: {error}"))?;
    let rows = statement
        .query_map(params![if env_override_active { 1 } else { 0 }, DEFAULT_INSTALLED_SOURCE_ID], source_record_from_row)
        .map_err(|error| format!("读取 mod source registry 失败: {error}"))?;
    let mut sources = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("收集 mod source registry 失败: {error}"))?;
    if env_override_active {
        sources.insert(0, default_record);
    } else if !sources.iter().any(|item| item.source_id == DEFAULT_INSTALLED_SOURCE_ID) {
        sources.insert(0, default_record);
    }
    Ok(sources)
}

fn enabled_runtime_mod_sources(app: &AppHandle) -> Result<Vec<RuntimeModSourceRecord>, String> {
    Ok(list_runtime_mod_sources(app)?
        .into_iter()
        .filter(|item| item.enabled)
        .collect())
}

pub fn upsert_runtime_mod_source(
    app: &AppHandle,
    source_id: Option<&str>,
    source_type: &str,
    source_dir: &str,
    enabled: bool,
) -> Result<RuntimeModSourceRecord, String> {
    let conn = open_db(app)?;
    let default_record = ensure_default_runtime_mod_source(&conn, app)?;
    let normalized_id = source_id.map(|item| item.trim().to_string()).filter(|item| !item.is_empty());
    if normalized_id.as_deref() == Some(DEFAULT_INSTALLED_SOURCE_ID) {
        return Err("默认 installed source 不允许编辑".to_string());
    }
    let (normalized_type, normalized_dir) =
        validate_user_managed_source_input(source_type, source_dir, &default_record.source_dir)?;

    let next_source_id = normalized_id.unwrap_or_else(generate_source_id);
    let now = now_rfc3339_source_registry();
    conn.execute(
        r#"
        INSERT INTO runtime_mod_sources (
          source_id, source_type, source_dir, enabled, is_default, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
        ON CONFLICT(source_id) DO UPDATE SET
          source_type = excluded.source_type,
          source_dir = excluded.source_dir,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
        "#,
        params![
            next_source_id,
            normalized_type,
            normalized_dir,
            if enabled { 1 } else { 0 },
            now
        ],
    )
    .map_err(|error| format!("写入 mod source registry 失败: {error}"))?;
    sync_runtime_mod_source_watchers(app)?;
    list_runtime_mod_sources(app)?
        .into_iter()
        .find(|item| item.source_id == next_source_id)
        .ok_or_else(|| format!("mod source 未找到: {next_source_id}"))
}

pub fn remove_runtime_mod_source(app: &AppHandle, source_id: &str) -> Result<bool, String> {
    let normalized_id = source_id.trim();
    if normalized_id.is_empty() {
        return Err("sourceId 不能为空".to_string());
    }
    if normalized_id == DEFAULT_INSTALLED_SOURCE_ID {
        return Err("默认 installed source 不允许删除".to_string());
    }
    let conn = open_db(app)?;
    ensure_default_runtime_mod_source(&conn, app)?;
    let removed = conn
        .execute(
            "DELETE FROM runtime_mod_sources WHERE source_id = ?1",
            params![normalized_id],
        )
        .map_err(|error| format!("删除 mod source 失败: {error}"))?;
    sync_runtime_mod_source_watchers(app)?;
    Ok(removed > 0)
}

pub fn get_runtime_mod_developer_mode_state(
    app: &AppHandle,
) -> Result<RuntimeModDeveloperModeState, String> {
    let conn = open_db(app)?;
    let enabled = get_runtime_kv(&conn, RUNTIME_MOD_DEVELOPER_MODE_KEY)?
        .map(|item| item == "true")
        .unwrap_or(false);
    let auto_reload_enabled = get_runtime_kv(&conn, RUNTIME_MOD_AUTO_RELOAD_KEY)?
        .map(|item| item == "true")
        .unwrap_or(false);
    Ok(RuntimeModDeveloperModeState {
        enabled,
        auto_reload_enabled,
    })
}

pub fn set_runtime_mod_developer_mode_state(
    app: &AppHandle,
    enabled: bool,
    auto_reload_enabled: Option<bool>,
) -> Result<RuntimeModDeveloperModeState, String> {
    let conn = open_db(app)?;
    let current = get_runtime_mod_developer_mode_state(app)?;
    let next = RuntimeModDeveloperModeState {
        enabled,
        auto_reload_enabled: auto_reload_enabled.unwrap_or(current.auto_reload_enabled),
    };
    let now = now_rfc3339_source_registry();
    set_runtime_kv(
        &conn,
        RUNTIME_MOD_DEVELOPER_MODE_KEY,
        if next.enabled { "true" } else { "false" },
        &now,
    )?;
    set_runtime_kv(
        &conn,
        RUNTIME_MOD_AUTO_RELOAD_KEY,
        if next.auto_reload_enabled { "true" } else { "false" },
        &now,
    )?;
    sync_runtime_mod_source_watchers(app)?;
    Ok(next)
}

include!("source_registry_runtime.rs");
