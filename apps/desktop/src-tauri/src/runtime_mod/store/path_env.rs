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

fn local_mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(custom_dir) = runtime_mod_env_override_dir()? {
        return Ok(custom_dir);
    }

    let base_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 app_data_dir: {error}"))?;
    Ok(base_dir.join("mods"))
}
