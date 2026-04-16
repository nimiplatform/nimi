pub mod migrations;
pub mod queries;

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::desktop_paths;

static DB_CONN: std::sync::OnceLock<Mutex<Connection>> = std::sync::OnceLock::new();
static DB_SCOPE: std::sync::OnceLock<Mutex<String>> = std::sync::OnceLock::new();

const LEGACY_DB_FILE_NAME: &str = "parentos.db";
const ANONYMOUS_DB_SCOPE: &str = "anonymous";

fn db_scope_lock() -> &'static Mutex<String> {
    DB_SCOPE.get_or_init(|| Mutex::new(ANONYMOUS_DB_SCOPE.to_string()))
}

fn hash_subject_user_id(subject_user_id: &str) -> u64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET;
    for byte in subject_user_id.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn normalize_db_scope(subject_user_id: Option<&str>) -> String {
    let normalized_subject = subject_user_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match normalized_subject {
        Some(subject_user_id) => format!("user-{:016x}", hash_subject_user_id(subject_user_id)),
        None => ANONYMOUS_DB_SCOPE.to_string(),
    }
}

fn resolve_db_path_for_scope(scope: &str) -> Result<PathBuf, String> {
    let data_dir = desktop_paths::resolve_nimi_data_dir()?;
    if scope == ANONYMOUS_DB_SCOPE {
        return Ok(data_dir.join(LEGACY_DB_FILE_NAME));
    }

    Ok(data_dir.join(format!("parentos-{scope}.db")))
}

pub fn resolve_db_path() -> Result<PathBuf, String> {
    let scope = db_scope_lock()
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    resolve_db_path_for_scope(&scope)
}

fn open_connection_for_scope(scope: &str) -> Result<Connection, String> {
    let db_path = resolve_db_path_for_scope(scope)?;
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("failed to open parentos db at {}: {e}", db_path.display()))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| format!("failed to set pragmas: {e}"))?;
    migrations::run_migrations(&conn)?;
    Ok(conn)
}

pub fn get_conn() -> Result<&'static Mutex<Connection>, String> {
    if let Some(conn) = DB_CONN.get() {
        return Ok(conn);
    }

    let scope = db_scope_lock()
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    let conn = Mutex::new(open_connection_for_scope(&scope)?);
    let _ = DB_CONN.set(conn);

    DB_CONN
        .get()
        .ok_or_else(|| "failed to initialize parentos sqlite connection".to_string())
}

#[tauri::command]
pub fn db_init(subject_user_id: Option<String>) -> Result<String, String> {
    let requested_scope = normalize_db_scope(subject_user_id.as_deref());
    let mut current_scope = db_scope_lock()
        .lock()
        .map_err(|error| error.to_string())?;

    if let Some(conn_mutex) = DB_CONN.get() {
        if *current_scope != requested_scope {
            let mut conn = conn_mutex.lock().map_err(|error| error.to_string())?;
            *conn = open_connection_for_scope(&requested_scope)?;
            *current_scope = requested_scope.clone();
        }
    } else {
        let conn = Mutex::new(open_connection_for_scope(&requested_scope)?);
        let _ = DB_CONN.set(conn);
        *current_scope = requested_scope.clone();
    }

    Ok(resolve_db_path_for_scope(&requested_scope)?
        .display()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::{db_init, resolve_db_path};
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    static TEST_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    fn test_home_dir(label: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("parentos-sqlite-scope-tests-{label}-{}", std::process::id()));
        path
    }

    #[test]
    fn db_init_uses_legacy_path_for_anonymous_scope() {
        let _guard = TEST_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock sqlite test mutex");
        let home_dir = test_home_dir("anonymous");
        std::fs::create_dir_all(&home_dir).expect("create temp home");
        std::env::set_var("HOME", &home_dir);

        let db_path = db_init(None).expect("init anonymous db");
        assert!(db_path.ends_with("parentos.db"), "unexpected path: {db_path}");
        assert!(
            resolve_db_path()
                .expect("resolve current db path")
                .ends_with("parentos.db")
        );
    }

    #[test]
    fn db_init_switches_to_account_scoped_path() {
        let _guard = TEST_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("lock sqlite test mutex");
        let home_dir = test_home_dir("account");
        std::fs::create_dir_all(&home_dir).expect("create temp home");
        std::env::set_var("HOME", &home_dir);

        let anonymous_path = db_init(None).expect("init anonymous db");
        let account_path = db_init(Some("user-123".to_string())).expect("init scoped db");

        assert!(anonymous_path.ends_with("parentos.db"));
        assert_ne!(anonymous_path, account_path);
        assert!(
            account_path.contains("parentos-user-"),
            "unexpected scoped path: {account_path}"
        );
        assert_eq!(
            resolve_db_path()
                .expect("resolve current db path")
                .display()
                .to_string(),
            account_path
        );
    }
}
