pub fn db_path(_app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
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
    crate::desktop_paths::normalize_desktop_absolute_path(path)
}

fn local_mods_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(custom_dir) = runtime_mod_env_override_dir()? {
        fs::create_dir_all(&custom_dir).map_err(|error| {
            format!(
                "无法创建 runtime mods override 目录 ({}): {error}",
                custom_dir.display()
            )
        })?;
        return Ok(custom_dir);
    }

    let base_dir = crate::desktop_paths::resolve_nimi_data_dir()?;
    let mods_dir = base_dir.join("mods");
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("无法创建默认 mods 目录 ({}): {error}", mods_dir.display()))?;
    Ok(mods_dir)
}
