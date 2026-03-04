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

