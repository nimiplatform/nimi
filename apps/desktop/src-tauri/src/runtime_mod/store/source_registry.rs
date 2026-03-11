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

fn runtime_mod_default_source_record(app: &AppHandle) -> Result<RuntimeModSourceRecord, String> {
    let source_dir = local_mods_dir(app)?;
    Ok(RuntimeModSourceRecord {
        source_id: DEFAULT_INSTALLED_SOURCE_ID.to_string(),
        source_type: SOURCE_TYPE_INSTALLED.to_string(),
        source_dir: source_dir.display().to_string(),
        enabled: true,
        is_default: true,
    })
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

fn ensure_default_runtime_mod_source(conn: &Connection, app: &AppHandle) -> Result<RuntimeModSourceRecord, String> {
    let default_record = runtime_mod_default_source_record(app)?;
    if runtime_mod_env_override_dir()?.is_some() {
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
            default_record.source_id,
            default_record.source_type,
            default_record.source_dir,
            now_rfc3339_source_registry()
        ],
    )
    .map_err(|error| format!("写入默认 mod source 失败: {error}"))?;
    Ok(default_record)
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
    let normalized_type = normalize_source_type(source_type)?;
    if normalized_type != SOURCE_TYPE_DEV {
        return Err("Desktop 只允许用户添加 dev source".to_string());
    }
    let normalized_dir = normalize_source_dir(source_dir)?.display().to_string();
    if normalized_dir == default_record.source_dir {
        return Err("默认 installed source 路径已由 Desktop 管理，不允许重复添加".to_string());
    }

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

fn scan_source_candidate_roots(source_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !source_dir.exists() {
        return Ok(Vec::new());
    }
    if find_manifest_path(source_dir).is_some() {
        return Ok(vec![source_dir.to_path_buf()]);
    }

    let entries = fs::read_dir(source_dir)
        .map_err(|error| format!("读取 mod source 目录失败 ({}): {error}", source_dir.display()))?;
    let mut roots = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 mod source 子目录失败: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if find_manifest_path(&path).is_some() {
            roots.push(path);
        }
    }
    Ok(roots)
}

fn attach_source_metadata(
    mut summary: RuntimeLocalManifestSummary,
    source: &RuntimeModSourceRecord,
) -> RuntimeLocalManifestSummary {
    summary.source_id = Some(source.source_id.clone());
    summary.source_type = Some(source.source_type.clone());
    summary.source_dir = Some(source.source_dir.clone());
    summary
}

fn scan_runtime_mod_sources(app: &AppHandle) -> Result<RuntimeModDiscoverySnapshot, String> {
    let sources = enabled_runtime_mod_sources(app)?;
    let mut diagnostics = Vec::new();
    let mut candidates = Vec::new();

    for source in &sources {
        let source_dir = PathBuf::from(&source.source_dir);
        fs::create_dir_all(&source_dir).map_err(|error| {
            format!(
                "创建 mod source 目录失败 ({}): {error}",
                source_dir.display()
            )
        })?;
        let candidate_roots = scan_source_candidate_roots(&source_dir)?;
        for root in candidate_roots {
            let Some(manifest_path) = find_manifest_path(&root) else {
                continue;
            };
            match parse_manifest_file(&manifest_path) {
                Some(summary) => {
                    candidates.push(attach_source_metadata(summary, source));
                }
                None => {
                    diagnostics.push(RuntimeModDiagnosticRecord {
                        mod_id: root
                            .file_name()
                            .and_then(|item| item.to_str())
                            .map(|item| item.trim().to_string())
                            .filter(|item| !item.is_empty())
                            .unwrap_or_else(|| "invalid-manifest".to_string()),
                        status: "invalid".to_string(),
                        source_id: source.source_id.clone(),
                        source_type: source.source_type.clone(),
                        source_dir: source.source_dir.clone(),
                        manifest_path: Some(manifest_path.display().to_string()),
                        entry_path: None,
                        error: Some(format!(
                            "解析 mod manifest 失败: {}",
                            manifest_path.display()
                        )),
                        conflict_paths: None,
                    });
                }
            }
        }
    }

    let mut grouped = StdHashMap::<String, Vec<RuntimeLocalManifestSummary>>::new();
    for candidate in candidates {
        grouped
            .entry(candidate.id.clone())
            .or_default()
            .push(candidate);
    }

    let mut manifests = Vec::new();
    for (mod_id, group) in grouped {
        if group.len() > 1 {
            let conflict_paths = group
                .iter()
                .map(|item| item.path.clone())
                .collect::<Vec<_>>();
            for item in group {
                diagnostics.push(RuntimeModDiagnosticRecord {
                    mod_id: mod_id.clone(),
                    status: "conflict".to_string(),
                    source_id: item.source_id.clone().unwrap_or_default(),
                    source_type: item.source_type.clone().unwrap_or_default(),
                    source_dir: item.source_dir.clone().unwrap_or_default(),
                    manifest_path: Some(item.path.clone()),
                    entry_path: item.entry_path.clone(),
                    error: Some(format!("Duplicate mod id: {mod_id}")),
                    conflict_paths: Some(conflict_paths.clone()),
                });
            }
            continue;
        }

        let item = group.into_iter().next().expect("group must contain one item");
        diagnostics.push(RuntimeModDiagnosticRecord {
            mod_id: item.id.clone(),
            status: "resolved".to_string(),
            source_id: item.source_id.clone().unwrap_or_default(),
            source_type: item.source_type.clone().unwrap_or_default(),
            source_dir: item.source_dir.clone().unwrap_or_default(),
            manifest_path: Some(item.path.clone()),
            entry_path: item.entry_path.clone(),
            error: None,
            conflict_paths: None,
        });
        manifests.push(item);
    }

    manifests.sort_by(|left, right| left.id.cmp(&right.id));
    diagnostics.sort_by(|left, right| {
        left.status
            .cmp(&right.status)
            .then(left.mod_id.cmp(&right.mod_id))
            .then(left.source_dir.cmp(&right.source_dir))
    });
    Ok(RuntimeModDiscoverySnapshot {
        manifests,
        diagnostics,
    })
}

pub fn list_runtime_mod_diagnostics(app: &AppHandle) -> Result<Vec<RuntimeModDiagnosticRecord>, String> {
    Ok(scan_runtime_mod_sources(app)?.diagnostics)
}

pub fn list_local_mod_manifests(app: &AppHandle) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    Ok(scan_runtime_mod_sources(app)?.manifests)
}

pub fn list_installed_runtime_mods(app: &AppHandle) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    let default_source = runtime_mod_default_source_record(app)?;
    Ok(scan_runtime_mod_sources(app)?
        .manifests
        .into_iter()
        .filter(|item| item.source_id.as_deref() == Some(default_source.source_id.as_str()))
        .collect())
}

fn normalize_entry_path_within_roots(
    allowed_roots: &[PathBuf],
    target: &str,
) -> Result<PathBuf, String> {
    if allowed_roots.is_empty() {
        return Err("当前没有启用的 mod source 目录".to_string());
    }
    let raw_target = PathBuf::from(target);
    let mut attempts = Vec::new();
    for root in allowed_roots {
        let base = root.canonicalize().map_err(|error| {
            format!("规范化 mod source 目录失败 ({}): {error}", root.display())
        })?;
        let candidate = if raw_target.is_absolute() {
            raw_target.clone()
        } else {
            base.join(&raw_target)
        };
        attempts.push(candidate.clone());
        let Ok(normalized) = candidate.canonicalize() else {
            continue;
        };
        if normalized.starts_with(&base) {
            return Ok(normalized);
        }
    }
    Err(format!(
        "拒绝访问已启用 mod source 外的路径: {}",
        attempts
            .into_iter()
            .map(|item| item.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn enabled_runtime_mod_source_dirs(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    Ok(enabled_runtime_mod_sources(app)?
        .into_iter()
        .map(|item| PathBuf::from(item.source_dir))
        .collect())
}

fn allowed_open_dir_roots(app: &AppHandle) -> Result<Vec<PathBuf>, String> {
    let mut roots = enabled_runtime_mod_source_dirs(app)?;
    roots.push(crate::desktop_paths::resolve_nimi_data_dir()?);
    roots.push(crate::desktop_paths::resolve_nimi_dir()?);
    Ok(roots)
}

fn emit_runtime_mod_reload_results_for_source(
    app: &AppHandle,
    source_id: Option<&str>,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    let snapshot = scan_runtime_mod_sources(app)?;
    let mut results = Vec::new();
    let source_filter = source_id.unwrap_or_default().trim();
    let mut seen = StdHashSet::new();

    for item in &snapshot.diagnostics {
        if !source_filter.is_empty() && item.source_id != source_filter {
            continue;
        }
        let key = format!("{}::{}::{}", item.source_id, item.mod_id, item.status);
        if !seen.insert(key) {
            continue;
        }
        let result = RuntimeModReloadResultPayload {
            mod_id: item.mod_id.clone(),
            source_id: item.source_id.clone(),
            status: item.status.clone(),
            occurred_at: now_rfc3339_source_registry(),
            error: item.error.clone(),
        };
        app.emit(RUNTIME_MOD_RELOAD_RESULT_EVENT, &result)
            .map_err(|error| format!("发送 runtime mod reload 事件失败: {error}"))?;
        results.push(result.clone());
        let mut store = runtime_mod_reload_results()
            .lock()
            .map_err(|_| "runtime mod reload store 锁已损坏".to_string())?;
        store.push(result);
        if store.len() > 100 {
            let overflow = store.len() - 100;
            store.drain(0..overflow);
        }
    }

    Ok(results)
}

fn handle_runtime_mod_source_watch_event(
    app: AppHandle,
    source: RuntimeModSourceRecord,
    event: Event,
) -> Result<(), String> {
    let mut debounce = runtime_mod_source_debounce()
        .lock()
        .map_err(|_| "runtime mod source debounce 锁已损坏".to_string())?;
    let current = debounce
        .entry(source.source_id.clone())
        .or_insert(RuntimeModSourceDebounceState {
            seq: 0,
            paths: Vec::new(),
        });
    current.seq += 1;
    current.paths = event
        .paths
        .into_iter()
        .map(|item| item.display().to_string())
        .collect();
    let current_seq = current.seq;
    drop(debounce);

    std_thread::spawn(move || {
        std_thread::sleep(StdDuration::from_millis(500));
        let payload = {
            let debounce = match runtime_mod_source_debounce().lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(current) = debounce.get(&source.source_id) else {
                return;
            };
            if current.seq != current_seq {
                return;
            }
            RuntimeModSourceChangeEventPayload {
                source_id: source.source_id.clone(),
                source_type: source.source_type.clone(),
                source_dir: source.source_dir.clone(),
                occurred_at: now_rfc3339_source_registry(),
                paths: current.paths.clone(),
            }
        };
        let _ = app.emit(RUNTIME_MOD_SOURCE_CHANGED_EVENT, &payload);
        let _ = emit_runtime_mod_reload_results_for_source(&app, Some(&source.source_id));
    });

    Ok(())
}

pub fn sync_runtime_mod_source_watchers(app: &AppHandle) -> Result<(), String> {
    let developer_mode = get_runtime_mod_developer_mode_state(app)?;
    let desired_sources = if developer_mode.enabled && developer_mode.auto_reload_enabled {
        enabled_runtime_mod_sources(app)?
            .into_iter()
            .filter(|item| item.source_type == SOURCE_TYPE_DEV)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let desired_ids = desired_sources
        .iter()
        .map(|item| item.source_id.clone())
        .collect::<StdHashSet<_>>();
    let mut registry = runtime_mod_source_watchers()
        .lock()
        .map_err(|_| "runtime mod source watcher 锁已损坏".to_string())?;
    registry.retain(|source_id, _| desired_ids.contains(source_id));
    drop(registry);

    let mut registry = runtime_mod_source_watchers()
        .lock()
        .map_err(|_| "runtime mod source watcher 锁已损坏".to_string())?;
    for source in desired_sources {
        if registry.contains_key(&source.source_id) {
            continue;
        }
        let app_handle = app.clone();
        let source_for_callback = source.clone();
        let mut watcher = recommended_watcher(move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                let _ = handle_runtime_mod_source_watch_event(
                    app_handle.clone(),
                    source_for_callback.clone(),
                    event,
                );
            }
        })
        .map_err(|error| format!("创建 mod source watcher 失败: {error}"))?;
        watcher
            .watch(Path::new(&source.source_dir), RecursiveMode::Recursive)
            .map_err(|error| {
                format!(
                    "监听 mod source 目录失败 ({}): {error}",
                    source.source_dir
                )
            })?;
        registry.insert(source.source_id.clone(), watcher);
    }
    Ok(())
}

pub fn reload_runtime_mod(
    app: &AppHandle,
    mod_id: &str,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    let normalized_mod_id = mod_id.trim();
    if normalized_mod_id.is_empty() {
        return Err("modId 不能为空".to_string());
    }
    let results = emit_runtime_mod_reload_results_for_source(app, None)?;
    Ok(results
        .into_iter()
        .filter(|item| item.mod_id == normalized_mod_id)
        .collect())
}

pub fn reload_all_runtime_mods(
    app: &AppHandle,
) -> Result<Vec<RuntimeModReloadResultPayload>, String> {
    emit_runtime_mod_reload_results_for_source(app, None)
}

fn reveal_path_in_os(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open mod dir failed: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open mod dir failed: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open mod dir failed: {e}"))?;
    }
    Ok(())
}

pub fn open_runtime_mod_dir(app: &AppHandle, path: &str) -> Result<(), String> {
    let normalized = normalize_entry_path_within_roots(&allowed_open_dir_roots(app)?, path)?;
    let target = if normalized.is_dir() {
        normalized
    } else {
        normalized
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("无法解析 mod 目录: {}", normalized.display()))?
    };
    reveal_path_in_os(&target)
}
