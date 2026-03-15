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

fn watchable_runtime_mod_source_ids(
    sources: &[RuntimeModSourceRecord],
    developer_mode: &RuntimeModDeveloperModeState,
) -> StdHashSet<String> {
    if !developer_mode.enabled || !developer_mode.auto_reload_enabled {
        return StdHashSet::new();
    }
    sources
        .iter()
        .filter(|item| item.enabled && item.source_type == SOURCE_TYPE_DEV)
        .map(|item| item.source_id.clone())
        .collect()
}

pub fn sync_runtime_mod_source_watchers(app: &AppHandle) -> Result<(), String> {
    let developer_mode = get_runtime_mod_developer_mode_state(app)?;
    let desired_sources = enabled_runtime_mod_sources(app)?;
    let desired_ids = watchable_runtime_mod_source_ids(&desired_sources, &developer_mode);
    let mut registry = runtime_mod_source_watchers()
        .lock()
        .map_err(|_| "runtime mod source watcher 锁已损坏".to_string())?;
    registry.retain(|source_id, _| desired_ids.contains(source_id));
    drop(registry);

    let mut registry = runtime_mod_source_watchers()
        .lock()
        .map_err(|_| "runtime mod source watcher 锁已损坏".to_string())?;
    for source in desired_sources {
        if !desired_ids.contains(&source.source_id) || registry.contains_key(&source.source_id) {
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

#[cfg(test)]
mod source_registry_tests {
    use super::{
        ensure_default_runtime_mod_source_for_dir, runtime_mod_default_source_record_for_dir,
        validate_user_managed_source_input, watchable_runtime_mod_source_ids,
        DEFAULT_INSTALLED_SOURCE_ID, RuntimeModDeveloperModeState, RuntimeModSourceRecord,
    };
    use crate::runtime_mod::store::init_schema;
    use crate::test_support::with_env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use rusqlite::Connection;

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-source-registry-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    #[test]
    fn default_installed_source_uses_nimi_data_dir_mods() {
        let home = temp_home("default-source");
        let installed_dir = home.join(".nimi").join("data").join("mods");
        let installed = runtime_mod_default_source_record_for_dir(&installed_dir);

        assert_eq!(installed.source_id, DEFAULT_INSTALLED_SOURCE_ID);
        assert_eq!(installed.source_type, "installed");
        assert_eq!(installed.source_dir, installed_dir.display().to_string());
        assert!(installed.enabled);
        assert!(installed.is_default);
    }

    #[test]
    fn runtime_mods_dir_override_is_session_only_and_not_persisted() {
        let home = temp_home("override");
        let override_dir = home.join("override-mods");
        let conn = Connection::open_in_memory().expect("open sqlite");
        init_schema(&conn).expect("init schema");
        let record = ensure_default_runtime_mod_source_for_dir(&conn, &override_dir, true)
            .expect("default source with override");

        assert_eq!(record.source_dir, override_dir.display().to_string());

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM runtime_mod_sources", [], |row| row.get(0))
            .expect("query source count");
        assert_eq!(count, 0);
    }

    #[test]
    fn installed_source_persists_when_override_is_not_active() {
        let home = temp_home("persisted-default");
        let installed_dir = home.join(".nimi").join("data").join("mods");
        let conn = Connection::open_in_memory().expect("open sqlite");
        init_schema(&conn).expect("init schema");

        let record = ensure_default_runtime_mod_source_for_dir(&conn, &installed_dir, false)
            .expect("persisted default source");
        assert_eq!(record.source_dir, installed_dir.display().to_string());

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM runtime_mod_sources", [], |row| row.get(0))
            .expect("query source count");
        assert_eq!(count, 1);
    }

    #[test]
    fn installed_source_cannot_be_added_or_removed() {
        let home = temp_home("installed-guardrails");
        let candidate_dir = home.join("dev-source");
        std::fs::create_dir_all(&candidate_dir).expect("create candidate dir");
        let default_dir = home.join(".nimi").join("data").join("mods");

        let add_result = validate_user_managed_source_input(
            "installed",
            candidate_dir.to_str().expect("candidate dir"),
            default_dir.to_str().expect("default dir"),
        );
        assert!(add_result.is_err());
        assert!(
            add_result
                .expect_err("installed source add must fail")
                .contains("Desktop 只允许用户添加 dev source")
        );

        let duplicate_result = validate_user_managed_source_input(
            "dev",
            default_dir.to_str().expect("default dir"),
            default_dir.to_str().expect("default dir"),
        );
        assert!(duplicate_result.is_err());
        assert!(
            duplicate_result
                .expect_err("duplicate installed path must fail")
                .contains("默认 installed source 路径已由 Desktop 管理，不允许重复添加")
        );
    }

    #[test]
    fn auto_reload_watchers_only_track_dev_sources() {
        let sources = vec![
            RuntimeModSourceRecord {
                source_id: DEFAULT_INSTALLED_SOURCE_ID.to_string(),
                source_type: "installed".to_string(),
                source_dir: "/tmp/installed".to_string(),
                enabled: true,
                is_default: true,
            },
            RuntimeModSourceRecord {
                source_id: "dev-enabled".to_string(),
                source_type: "dev".to_string(),
                source_dir: "/tmp/dev-enabled".to_string(),
                enabled: true,
                is_default: false,
            },
            RuntimeModSourceRecord {
                source_id: "dev-disabled".to_string(),
                source_type: "dev".to_string(),
                source_dir: "/tmp/dev-disabled".to_string(),
                enabled: false,
                is_default: false,
            },
        ];
        let developer_mode = RuntimeModDeveloperModeState {
            enabled: true,
            auto_reload_enabled: true,
        };

        let watcher_ids = watchable_runtime_mod_source_ids(&sources, &developer_mode);
        assert_eq!(watcher_ids.len(), 1);
        assert!(watcher_ids.contains("dev-enabled"));
        assert!(!watcher_ids.contains(DEFAULT_INSTALLED_SOURCE_ID));
        assert!(!watcher_ids.contains("dev-disabled"));
    }

    #[test]
    fn auto_reload_watchers_disable_cleanly_when_developer_mode_is_off() {
        let sources = vec![RuntimeModSourceRecord {
            source_id: "dev-enabled".to_string(),
            source_type: "dev".to_string(),
            source_dir: "/tmp/dev-enabled".to_string(),
            enabled: true,
            is_default: false,
        }];
        let developer_mode = RuntimeModDeveloperModeState {
            enabled: false,
            auto_reload_enabled: true,
        };

        let watcher_ids = watchable_runtime_mod_source_ids(&sources, &developer_mode);
        assert!(watcher_ids.is_empty());
    }

    #[test]
    fn with_env_helper_restores_environment() {
        let home = temp_home("env-restore");
        with_env(&[("HOME", home.to_str())], || {
            assert_eq!(std::env::var("HOME").ok().as_deref(), home.to_str());
        });
    }
}
