use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::params_from_iter;
use serde_json::{Map as JsonMap, Number as JsonNumber};
use std::path::Component;
use std::time::UNIX_EPOCH;

const SQLITE_MAIN_FILE_NAME: &str = "main.db";
const SQLITE_FORBIDDEN_TOKENS: [&str; 4] = ["attach", "detach", "vacuum into", "load_extension"];

fn validate_mod_storage_mod_id(mod_id: &str) -> Result<String, String> {
    let normalized = mod_id.trim();
    if normalized.is_empty() {
        return Err("mod storage requires non-empty mod_id".to_string());
    }
    if normalized.contains('/') || normalized.contains('\\') {
        return Err(format!("mod storage mod_id must not contain path separators: {normalized}"));
    }
    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_')
    {
        return Err(format!("mod storage mod_id contains unsupported characters: {normalized}"));
    }
    Ok(normalized.to_string())
}

fn mod_storage_root(mod_id: &str) -> Result<PathBuf, String> {
    let normalized_mod_id = validate_mod_storage_mod_id(mod_id)?;
    let root = crate::desktop_paths::resolve_nimi_data_dir()?
        .join("mod-data")
        .join(normalized_mod_id);
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create mod storage root ({}): {error}", root.display()))?;
    Ok(root)
}

fn mod_storage_files_root(mod_id: &str) -> Result<PathBuf, String> {
    let root = mod_storage_root(mod_id)?.join("files");
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create mod storage files root ({}): {error}", root.display()))?;
    Ok(root)
}

fn mod_storage_sqlite_path(mod_id: &str) -> Result<PathBuf, String> {
    let sqlite_dir = mod_storage_root(mod_id)?.join("sqlite");
    fs::create_dir_all(&sqlite_dir)
        .map_err(|error| format!("failed to create mod storage sqlite dir ({}): {error}", sqlite_dir.display()))?;
    Ok(sqlite_dir.join(SQLITE_MAIN_FILE_NAME))
}

fn normalize_relative_storage_path(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("mod storage path must not be empty".to_string());
    }
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        return Err(format!("mod storage path must be relative: {trimmed}"));
    }
    let mut normalized = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(segment) => normalized.push(segment),
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("mod storage path escapes files root: {trimmed}"));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err("mod storage path must not resolve to files root".to_string());
    }
    Ok(normalized)
}

fn canonicalize_existing_parent(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("mod storage path has no parent: {}", path.display()))?;
    fs::canonicalize(parent)
        .map_err(|error| format!("failed to canonicalize mod storage parent ({}): {error}", parent.display()))
}

fn ensure_child_path(root: &Path, candidate: &Path) -> Result<(), String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("failed to canonicalize mod storage root ({}): {error}", root.display()))?;
    let canonical_parent = canonicalize_existing_parent(candidate)?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err(format!(
            "mod storage path escapes files root: root={} candidate={}",
            canonical_root.display(),
            candidate.display()
        ));
    }
    Ok(())
}

fn resolve_mod_storage_file_path(mod_id: &str, path: &str) -> Result<(PathBuf, PathBuf), String> {
    let files_root = mod_storage_files_root(mod_id)?;
    let relative = normalize_relative_storage_path(path)?;
    let candidate = files_root.join(&relative);
    Ok((files_root, candidate))
}

fn file_modified_at(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|value| chrono::DateTime::<chrono::Utc>::from_timestamp(value.as_secs() as i64, value.subsec_nanos()))
        .flatten()
        .map(|value| value.to_rfc3339())
}

fn open_mod_storage_sqlite(mod_id: &str) -> Result<Connection, String> {
    let path = mod_storage_sqlite_path(mod_id)?;
    let conn = Connection::open(&path)
        .map_err(|error| format!("failed to open mod storage sqlite ({}): {error}", path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("failed to enable WAL for mod storage sqlite: {error}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("failed to enable foreign_keys for mod storage sqlite: {error}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5_000))
        .map_err(|error| format!("failed to set busy_timeout for mod storage sqlite: {error}"))?;
    Ok(conn)
}

fn ensure_sql_is_allowed(sql: &str) -> Result<(), String> {
    let normalized = sql.to_ascii_lowercase();
    for token in SQLITE_FORBIDDEN_TOKENS {
        if normalized.contains(token) {
            return Err(format!("mod storage sqlite statement is forbidden: {token}"));
        }
    }
    Ok(())
}

fn json_to_sql_value(value: &JsonValue) -> Result<SqlValue, String> {
    match value {
        JsonValue::Null => Ok(SqlValue::Null),
        JsonValue::Bool(value) => Ok(SqlValue::Integer(if *value { 1 } else { 0 })),
        JsonValue::Number(value) => {
            if let Some(int) = value.as_i64() {
                return Ok(SqlValue::Integer(int));
            }
            if let Some(uint) = value.as_u64() {
                return i64::try_from(uint)
                    .map(SqlValue::Integer)
                    .map_err(|_| format!("sqlite param is too large for i64: {uint}"));
            }
            value
                .as_f64()
                .map(SqlValue::Real)
                .ok_or_else(|| format!("sqlite param number is invalid: {value}"))
        }
        JsonValue::String(value) => Ok(SqlValue::Text(value.clone())),
        JsonValue::Array(_) | JsonValue::Object(_) => serde_json::to_string(value)
            .map(SqlValue::Text)
            .map_err(|error| format!("failed to serialize sqlite param json: {error}")),
    }
}

fn sql_value_ref_to_json(value: ValueRef<'_>) -> JsonValue {
    match value {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(value) => JsonValue::Number(JsonNumber::from(value)),
        ValueRef::Real(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .unwrap_or(JsonValue::Null),
        ValueRef::Text(value) => JsonValue::String(String::from_utf8_lossy(value).to_string()),
        ValueRef::Blob(value) => JsonValue::Array(
            value
                .iter()
                .map(|byte| JsonValue::Number(JsonNumber::from(*byte)))
                .collect(),
        ),
    }
}

fn query_sqlite_rows(
    conn: &Connection,
    sql: &str,
    params_value: &[JsonValue],
) -> Result<Vec<JsonValue>, String> {
    let sql_params = params_value
        .iter()
        .map(json_to_sql_value)
        .collect::<Result<Vec<_>, _>>()?;
    let mut statement = conn
        .prepare(sql)
        .map_err(|error| format!("failed to prepare mod storage sqlite query: {error}"))?;
    let column_names = statement
        .column_names()
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let rows = statement
        .query_map(params_from_iter(sql_params.iter()), |row| {
            let mut record = JsonMap::new();
            for (index, column_name) in column_names.iter().enumerate() {
                let value = row.get_ref(index)?;
                record.insert(column_name.clone(), sql_value_ref_to_json(value));
            }
            Ok(JsonValue::Object(record))
        })
        .map_err(|error| format!("failed to execute mod storage sqlite query: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect mod storage sqlite rows: {error}"))
}

pub fn mod_storage_file_read(
    _app: &AppHandle,
    payload: &RuntimeModStorageFileReadPayload,
) -> Result<RuntimeModStorageFileReadResultPayload, String> {
    let (_, path) = resolve_mod_storage_file_path(&payload.mod_id, &payload.path)?;
    ensure_child_path(&mod_storage_files_root(&payload.mod_id)?, &path)?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to stat mod storage file ({}): {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("mod storage path is not a file: {}", path.display()));
    }
    let format = payload
        .format
        .as_deref()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_else(|| "text".to_string());
    let bytes = fs::read(&path)
        .map_err(|error| format!("failed to read mod storage file ({}): {error}", path.display()))?;
    let (text, bytes_payload) = if format == "bytes" {
        (None, Some(bytes))
    } else {
        let text = String::from_utf8(bytes)
            .map_err(|error| format!("mod storage file is not valid utf-8 ({}): {error}", path.display()))?;
        (Some(text.clone()), None)
    };
    Ok(RuntimeModStorageFileReadResultPayload {
        path: payload.path.trim().to_string(),
        text,
        bytes: bytes_payload,
        size_bytes: metadata.len(),
        modified_at: file_modified_at(&metadata),
    })
}

pub fn mod_storage_file_write(
    _app: &AppHandle,
    payload: &RuntimeModStorageFileWritePayload,
) -> Result<RuntimeModStorageFileWriteResultPayload, String> {
    let (files_root, path) = resolve_mod_storage_file_path(&payload.mod_id, &payload.path)?;
    let content = match (&payload.text, &payload.bytes) {
        (Some(text), None) => text.as_bytes().to_vec(),
        (None, Some(bytes)) => bytes.clone(),
        (Some(_), Some(_)) => {
            return Err("mod storage file write accepts exactly one of text or bytes".to_string())
        }
        (None, None) => return Err("mod storage file write requires text or bytes".to_string()),
    };
    let parent = path
        .parent()
        .ok_or_else(|| format!("mod storage file path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create mod storage parent ({}): {error}", parent.display()))?;
    ensure_child_path(&files_root, &path)?;
    let temp_path = parent.join(format!(
        ".tmp-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    fs::write(&temp_path, &content)
        .map_err(|error| format!("failed to write mod storage temp file ({}): {error}", temp_path.display()))?;
    fs::rename(&temp_path, &path)
        .map_err(|error| format!("failed to replace mod storage file ({}): {error}", path.display()))?;
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to stat written mod storage file ({}): {error}", path.display()))?;
    Ok(RuntimeModStorageFileWriteResultPayload {
        path: payload.path.trim().to_string(),
        size_bytes: metadata.len(),
        modified_at: file_modified_at(&metadata),
    })
}

pub fn mod_storage_file_delete(
    _app: &AppHandle,
    payload: &RuntimeModStorageFileDeletePayload,
) -> Result<bool, String> {
    let (files_root, path) = resolve_mod_storage_file_path(&payload.mod_id, &payload.path)?;
    ensure_child_path(&files_root, &path)?;
    if !path.exists() {
        return Ok(false);
    }
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("failed to stat mod storage delete target ({}): {error}", path.display()))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&path)
            .map_err(|error| format!("failed to delete mod storage dir ({}): {error}", path.display()))?;
    } else {
        fs::remove_file(&path)
            .map_err(|error| format!("failed to delete mod storage file ({}): {error}", path.display()))?;
    }
    Ok(true)
}

pub fn mod_storage_file_list(
    _app: &AppHandle,
    payload: &RuntimeModStorageFileListPayload,
) -> Result<Vec<RuntimeModStorageFileEntryPayload>, String> {
    let files_root = mod_storage_files_root(&payload.mod_id)?;
    let target_dir = match payload.path.as_deref() {
        Some(path) if !path.trim().is_empty() => {
            let normalized = normalize_relative_storage_path(path)?;
            files_root.join(normalized)
        }
        _ => files_root.clone(),
    };
    ensure_child_path(&files_root, &target_dir.join("__list_marker__"))?;
    if !target_dir.exists() {
        return Ok(Vec::new());
    }
    if !target_dir.is_dir() {
        return Err(format!("mod storage list path is not a directory: {}", target_dir.display()));
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&target_dir)
        .map_err(|error| format!("failed to read mod storage directory ({}): {error}", target_dir.display()))?
    {
        let entry = entry.map_err(|error| format!("failed to iterate mod storage directory: {error}"))?;
        let entry_path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("failed to stat mod storage directory entry ({}): {error}", entry_path.display()))?;
        let relative = entry_path
            .strip_prefix(&files_root)
            .map_err(|error| format!("failed to relativize mod storage path ({}): {error}", entry_path.display()))?;
        entries.push(RuntimeModStorageFileEntryPayload {
            path: relative.to_string_lossy().to_string(),
            kind: if metadata.is_dir() { "directory".to_string() } else { "file".to_string() },
            size_bytes: if metadata.is_file() { metadata.len() } else { 0 },
            modified_at: file_modified_at(&metadata),
        });
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

pub fn mod_storage_file_stat(
    _app: &AppHandle,
    payload: &RuntimeModStorageFileStatPayload,
) -> Result<Option<RuntimeModStorageFileEntryPayload>, String> {
    let (files_root, path) = resolve_mod_storage_file_path(&payload.mod_id, &payload.path)?;
    ensure_child_path(&files_root, &path)?;
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("failed to stat mod storage path ({}): {error}", path.display()))?;
    let relative = path
        .strip_prefix(&files_root)
        .map_err(|error| format!("failed to relativize mod storage stat path ({}): {error}", path.display()))?;
    Ok(Some(RuntimeModStorageFileEntryPayload {
        path: relative.to_string_lossy().to_string(),
        kind: if metadata.is_dir() { "directory".to_string() } else { "file".to_string() },
        size_bytes: if metadata.is_file() { metadata.len() } else { 0 },
        modified_at: file_modified_at(&metadata),
    }))
}

pub fn mod_storage_sqlite_query(
    _app: &AppHandle,
    payload: &RuntimeModStorageSqliteQueryPayload,
) -> Result<RuntimeModStorageSqliteQueryResultPayload, String> {
    ensure_sql_is_allowed(&payload.sql)?;
    let conn = open_mod_storage_sqlite(&payload.mod_id)?;
    let rows = query_sqlite_rows(&conn, &payload.sql, payload.params.as_deref().unwrap_or(&[]))?;
    Ok(RuntimeModStorageSqliteQueryResultPayload { rows })
}

pub fn mod_storage_sqlite_execute(
    _app: &AppHandle,
    payload: &RuntimeModStorageSqliteQueryPayload,
) -> Result<RuntimeModStorageSqliteExecuteResultPayload, String> {
    ensure_sql_is_allowed(&payload.sql)?;
    let conn = open_mod_storage_sqlite(&payload.mod_id)?;
    let sql_params = payload
        .params
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(json_to_sql_value)
        .collect::<Result<Vec<_>, _>>()?;
    let rows_affected = conn
        .execute(&payload.sql, params_from_iter(sql_params.iter()))
        .map_err(|error| format!("failed to execute mod storage sqlite statement: {error}"))?;
    Ok(RuntimeModStorageSqliteExecuteResultPayload {
        rows_affected,
        last_insert_rowid: conn.last_insert_rowid(),
    })
}

pub fn mod_storage_sqlite_transaction(
    _app: &AppHandle,
    payload: &RuntimeModStorageSqliteTransactionPayload,
) -> Result<RuntimeModStorageSqliteExecuteResultPayload, String> {
    if payload.statements.is_empty() {
        return Ok(RuntimeModStorageSqliteExecuteResultPayload {
            rows_affected: 0,
            last_insert_rowid: 0,
        });
    }
    let mut conn = open_mod_storage_sqlite(&payload.mod_id)?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("failed to start mod storage sqlite transaction: {error}"))?;
    let mut rows_affected: usize = 0;
    for statement in &payload.statements {
        ensure_sql_is_allowed(&statement.sql)?;
        let sql_params = statement
            .params
            .as_deref()
            .unwrap_or(&[])
            .iter()
            .map(json_to_sql_value)
            .collect::<Result<Vec<_>, _>>()?;
        rows_affected += tx
            .execute(&statement.sql, params_from_iter(sql_params.iter()))
            .map_err(|error| format!("failed to execute mod storage sqlite transaction statement: {error}"))?;
    }
    tx.commit()
        .map_err(|error| format!("failed to commit mod storage sqlite transaction: {error}"))?;
    Ok(RuntimeModStorageSqliteExecuteResultPayload {
        rows_affected,
        last_insert_rowid: conn.last_insert_rowid(),
    })
}

pub fn purge_mod_storage_data(_app: &AppHandle, mod_id: &str) -> Result<bool, String> {
    let root = mod_storage_root(mod_id)?;
    if !root.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(&root)
        .map_err(|error| format!("failed to purge mod storage data ({}): {error}", root.display()))?;
    Ok(true)
}

#[cfg(test)]
mod mod_storage_tests {
    use super::*;

    #[test]
    fn validate_mod_storage_mod_id_rejects_path_escape_inputs() {
        assert!(validate_mod_storage_mod_id("").is_err());
        assert!(validate_mod_storage_mod_id("mod/alpha").is_err());
        assert!(validate_mod_storage_mod_id("mod\\alpha").is_err());
        assert!(validate_mod_storage_mod_id("../alpha").is_err());
        assert!(validate_mod_storage_mod_id("alpha beta").is_err());
        assert_eq!(
            validate_mod_storage_mod_id("world.nimi.alpha-01_ok").unwrap(),
            "world.nimi.alpha-01_ok"
        );
    }

    #[test]
    fn normalize_relative_storage_path_rejects_absolute_and_parent_segments() {
        assert!(normalize_relative_storage_path("").is_err());
        assert!(normalize_relative_storage_path("/tmp/alpha").is_err());
        assert!(normalize_relative_storage_path("../alpha").is_err());
        assert!(normalize_relative_storage_path("notes/../../alpha").is_err());
        assert_eq!(
            normalize_relative_storage_path("./notes/alpha.txt").unwrap(),
            PathBuf::from("notes/alpha.txt")
        );
    }

    #[test]
    fn ensure_sql_is_allowed_blocks_escape_primitives() {
        assert!(ensure_sql_is_allowed("select * from notes").is_ok());
        assert!(ensure_sql_is_allowed("ATTACH DATABASE 'other.db' AS other").is_err());
        assert!(ensure_sql_is_allowed("detach database other").is_err());
        assert!(ensure_sql_is_allowed("vacuum into 'export.db'").is_err());
        assert!(ensure_sql_is_allowed("select load_extension('unsafe')").is_err());
    }
}
