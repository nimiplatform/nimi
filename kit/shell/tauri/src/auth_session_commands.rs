use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};

const AUTH_SESSION_SCHEMA_VERSION: u32 = 1;
const AUTH_SESSION_DIR_NAME: &str = "auth";
const AUTH_SESSION_FILE_NAME: &str = "session.v1.json";
const AUTH_SESSION_DEV_FILE_NAME: &str = "session.dev.v1.json";
const AUTH_SESSION_KEY_SERVICE: &str = "nimi.desktop.auth-session";
const AUTH_SESSION_KEY_ACCOUNT: &str = "master-key.v1";
const AUTH_SESSION_DEV_USE_KEYCHAIN_ENV: &str = "NIMI_DESKTOP_DEV_USE_KEYCHAIN";
const AES_KEY_LEN: usize = 32;
const AES_NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionUser {
    pub id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionSavePayload {
    pub realm_base_url: String,
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub user: Option<AuthSessionUser>,
    pub updated_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AuthSessionLoadResult {
    pub realm_base_url: String,
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<AuthSessionUser>,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthSessionFile {
    schema_version: u32,
    realm_base_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    user: Option<AuthSessionUser>,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<String>,
    access_token_ciphertext: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_token_ciphertext: Option<String>,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(AUTH_SESSION_KEY_SERVICE, AUTH_SESSION_KEY_ACCOUNT)
        .map_err(|error| format!("初始化 auth session keyring 失败: {error}"))
}

fn auth_session_dir() -> Result<PathBuf, String> {
    let auth_dir = crate::desktop_paths::resolve_nimi_dir()?.join(AUTH_SESSION_DIR_NAME);
    fs::create_dir_all(&auth_dir).map_err(|error| {
        format!(
            "创建 ~/.nimi/auth 目录失败 ({}): {error}",
            auth_dir.display()
        )
    })?;
    Ok(auth_dir)
}

fn auth_session_path_for_file(file_name: &str) -> Result<PathBuf, String> {
    Ok(auth_session_dir()?.join(file_name))
}

fn auth_session_path() -> Result<PathBuf, String> {
    auth_session_path_for_file(AUTH_SESSION_FILE_NAME)
}

fn auth_session_dev_path() -> Result<PathBuf, String> {
    auth_session_path_for_file(AUTH_SESSION_DEV_FILE_NAME)
}

fn env_flag_enabled(raw: Option<&str>) -> bool {
    matches!(
        raw.map(str::trim).map(str::to_ascii_lowercase).as_deref(),
        Some("1" | "true" | "yes" | "on")
    )
}

fn should_use_keyring_session_storage_from_env(
    is_debug_build: bool,
    env_value: Option<&str>,
) -> bool {
    if !is_debug_build {
        return true;
    }
    env_flag_enabled(env_value)
}

fn should_use_keyring_session_storage() -> bool {
    should_use_keyring_session_storage_from_env(
        cfg!(debug_assertions),
        std::env::var(AUTH_SESSION_DEV_USE_KEYCHAIN_ENV)
            .ok()
            .as_deref(),
    )
}

fn read_or_create_master_key<FR, FW>(
    read_password: FR,
    write_password: FW,
) -> Result<Vec<u8>, String>
where
    FR: FnOnce() -> Result<Option<String>, String>,
    FW: FnOnce(&str) -> Result<(), String>,
{
    if let Some(encoded) = read_password()? {
        let decoded = BASE64_STANDARD
            .decode(encoded.trim())
            .map_err(|error| format!("auth session master key 解码失败: {error}"))?;
        if decoded.len() != AES_KEY_LEN {
            return Err(format!(
                "auth session master key 长度无效: expected={AES_KEY_LEN} actual={}",
                decoded.len()
            ));
        }
        return Ok(decoded);
    }

    let mut key = vec![0_u8; AES_KEY_LEN];
    OsRng.fill_bytes(&mut key);
    let encoded = BASE64_STANDARD.encode(&key);
    write_password(encoded.as_str())?;
    Ok(key)
}

fn normalize_master_key_read_result(
    result: Result<String, keyring::Error>,
) -> Result<Option<String>, String> {
    match result {
        Ok(value) => {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("读取 auth session master key 失败: {error}")),
    }
}

fn load_master_key() -> Result<Vec<u8>, String> {
    let entry = keyring_entry()?;
    read_or_create_master_key(
        || normalize_master_key_read_result(entry.get_password()),
        |value| {
            entry
                .set_password(value)
                .map_err(|error| format!("写入 auth session master key 失败: {error}"))
        },
    )
}

fn cipher_from_key(key: &[u8]) -> Result<Aes256Gcm, String> {
    if key.len() != AES_KEY_LEN {
        return Err(format!(
            "auth session key 长度无效: expected={AES_KEY_LEN} actual={}",
            key.len()
        ));
    }
    Aes256Gcm::new_from_slice(key)
        .map_err(|error| format!("初始化 auth session cipher 失败: {error}"))
}

fn encrypt_secret(key: &[u8], value: &str) -> Result<String, String> {
    let cipher = cipher_from_key(key)?;
    let mut nonce_bytes = [0_u8; AES_NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), value.as_bytes())
        .map_err(|error| format!("加密 auth session 字段失败: {error}"))?;
    let mut payload = Vec::with_capacity(AES_NONCE_LEN + ciphertext.len());
    payload.extend_from_slice(&nonce_bytes);
    payload.extend_from_slice(&ciphertext);
    Ok(BASE64_STANDARD.encode(payload))
}

fn decrypt_secret(key: &[u8], value: &str) -> Result<String, String> {
    let payload = BASE64_STANDARD
        .decode(value.trim())
        .map_err(|error| format!("解码 auth session 密文失败: {error}"))?;
    if payload.len() <= AES_NONCE_LEN {
        return Err("auth session 密文长度无效".to_string());
    }
    let (nonce_bytes, ciphertext) = payload.split_at(AES_NONCE_LEN);
    let cipher = cipher_from_key(key)?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|error| format!("解密 auth session 字段失败: {error}"))?;
    String::from_utf8(plaintext)
        .map_err(|error| format!("auth session 解密结果不是 UTF-8: {error}"))
}

fn write_restricted_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    let options = {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true).mode(0o600);
        options
    };
    #[cfg(not(unix))]
    let options = {
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        options
    };

    let mut file = options.open(path).map_err(|error| {
        format!(
            "写入 auth session 临时文件失败 ({}): {error}",
            path.display()
        )
    })?;
    use std::io::Write;
    file.write_all(bytes)
        .map_err(|error| format!("写入 auth session 内容失败 ({}): {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("刷新 auth session 文件失败 ({}): {error}", path.display()))?;
    Ok(())
}

fn atomic_write_session_file(path: &Path, payload: &AuthSessionFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("auth session 路径缺少父目录: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 auth session 目录失败 ({}): {error}", parent.display()))?;
    let serialized = serde_json::to_vec_pretty(payload)
        .map_err(|error| format!("序列化 auth session 文件失败: {error}"))?;
    let tmp_path = parent.join(format!(
        ".{}.tmp-{}",
        AUTH_SESSION_FILE_NAME,
        std::process::id()
    ));
    write_restricted_file(&tmp_path, &serialized)?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "替换 auth session 文件失败 (from={} to={}): {error}",
            tmp_path.display(),
            path.display()
        )
    })?;
    Ok(())
}

fn clear_session_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "删除 auth session 文件失败 ({}): {error}",
            path.display()
        )),
    }
}

fn save_auth_session_to_path(
    path: &Path,
    key: &[u8],
    payload: &AuthSessionSavePayload,
) -> Result<(), String> {
    let realm_base_url = payload.realm_base_url.trim().to_string();
    let access_token = payload.access_token.trim().to_string();
    let refresh_token = payload
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let updated_at = payload.updated_at.trim().to_string();
    let expires_at = payload
        .expires_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if realm_base_url.is_empty() {
        return Err("保存 auth session 失败: realmBaseUrl 不能为空".to_string());
    }
    if access_token.is_empty() {
        return Err("保存 auth session 失败: accessToken 不能为空".to_string());
    }
    if updated_at.is_empty() {
        return Err("保存 auth session 失败: updatedAt 不能为空".to_string());
    }
    if let Some(user) = payload.user.as_ref() {
        if user.id.trim().is_empty() {
            return Err("保存 auth session 失败: user.id 不能为空".to_string());
        }
    }

    let file_payload = AuthSessionFile {
        schema_version: AUTH_SESSION_SCHEMA_VERSION,
        realm_base_url,
        user: payload.user.clone(),
        updated_at,
        expires_at,
        access_token_ciphertext: encrypt_secret(key, access_token.as_str())?,
        refresh_token_ciphertext: match refresh_token {
            Some(value) => Some(encrypt_secret(key, value.as_str())?),
            None => None,
        },
    };

    atomic_write_session_file(path, &file_payload)
}

fn save_plaintext_auth_session_to_path(
    path: &Path,
    payload: &AuthSessionSavePayload,
) -> Result<(), String> {
    let session = AuthSessionLoadResult {
        realm_base_url: payload.realm_base_url.trim().to_string(),
        access_token: payload.access_token.trim().to_string(),
        refresh_token: payload
            .refresh_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        user: payload.user.clone(),
        updated_at: payload.updated_at.trim().to_string(),
        expires_at: payload
            .expires_at
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
    };

    if session.realm_base_url.is_empty() {
        return Err("保存 auth session 失败: realmBaseUrl 不能为空".to_string());
    }
    if session.access_token.is_empty() {
        return Err("保存 auth session 失败: accessToken 不能为空".to_string());
    }
    if session.updated_at.is_empty() {
        return Err("保存 auth session 失败: updatedAt 不能为空".to_string());
    }
    if let Some(user) = session.user.as_ref() {
        if user.id.trim().is_empty() {
            return Err("保存 auth session 失败: user.id 不能为空".to_string());
        }
    }

    let serialized = serde_json::to_vec_pretty(&session)
        .map_err(|error| format!("序列化开发态 auth session 文件失败: {error}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("auth session 路径缺少父目录: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("创建 auth session 目录失败 ({}): {error}", parent.display()))?;
    write_restricted_file(path, &serialized)
}

fn load_auth_session_from_path(
    path: &Path,
    key: &[u8],
) -> Result<Option<AuthSessionLoadResult>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "读取 auth session 文件失败 ({}): {error}",
                path.display()
            ))
        }
    };

    let parsed = match serde_json::from_str::<AuthSessionFile>(&raw) {
        Ok(value) => value,
        Err(error) => {
            let _ = clear_session_file(path);
            return Err(format!(
                "解析 auth session 文件失败并已清理 ({}): {error}",
                path.display()
            ));
        }
    };

    if parsed.schema_version != AUTH_SESSION_SCHEMA_VERSION {
        let _ = clear_session_file(path);
        return Err(format!(
            "auth session schemaVersion 无效并已清理: expected={} actual={}",
            AUTH_SESSION_SCHEMA_VERSION, parsed.schema_version
        ));
    }

    let access_token = match decrypt_secret(key, parsed.access_token_ciphertext.as_str()) {
        Ok(value) if !value.trim().is_empty() => value,
        Ok(_) => {
            let _ = clear_session_file(path);
            return Err("auth session access token 为空并已清理".to_string());
        }
        Err(error) => {
            let _ = clear_session_file(path);
            return Err(format!("{error}; auth session 已清理"));
        }
    };

    let refresh_token = match parsed.refresh_token_ciphertext.as_deref() {
        Some(value) => {
            let decrypted = decrypt_secret(key, value).map_err(|error| {
                let _ = clear_session_file(path);
                format!("{error}; auth session 已清理")
            })?;
            let normalized = decrypted.trim().to_string();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        }
        None => None,
    };

    Ok(Some(AuthSessionLoadResult {
        realm_base_url: parsed.realm_base_url,
        access_token,
        refresh_token,
        user: parsed.user,
        updated_at: parsed.updated_at,
        expires_at: parsed.expires_at,
    }))
}

fn load_plaintext_auth_session_from_path(
    path: &Path,
) -> Result<Option<AuthSessionLoadResult>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "读取开发态 auth session 文件失败 ({}): {error}",
                path.display()
            ))
        }
    };

    let parsed = match serde_json::from_str::<AuthSessionLoadResult>(&raw) {
        Ok(value) => value,
        Err(error) => {
            let _ = clear_session_file(path);
            return Err(format!(
                "解析开发态 auth session 文件失败并已清理 ({}): {error}",
                path.display()
            ));
        }
    };

    if parsed.realm_base_url.trim().is_empty() || parsed.access_token.trim().is_empty() {
        let _ = clear_session_file(path);
        return Err("开发态 auth session 缺少必填字段并已清理".to_string());
    }

    Ok(Some(parsed))
}

fn coerce_cleared_session_load_result(
    result: Result<Option<AuthSessionLoadResult>, String>,
) -> Result<Option<AuthSessionLoadResult>, String> {
    match result {
        Err(error) if error.contains("已清理") => Ok(None),
        other => other,
    }
}

#[tauri::command]
pub fn auth_session_load() -> Result<Option<AuthSessionLoadResult>, String> {
    if should_use_keyring_session_storage() {
        let path = auth_session_path()?;
        let key = load_master_key()?;
        return coerce_cleared_session_load_result(load_auth_session_from_path(
            path.as_path(),
            key.as_slice(),
        ));
    }

    let path = auth_session_dev_path()?;
    coerce_cleared_session_load_result(load_plaintext_auth_session_from_path(path.as_path()))
}

#[tauri::command]
pub fn auth_session_save(payload: AuthSessionSavePayload) -> Result<(), String> {
    if should_use_keyring_session_storage() {
        let path = auth_session_path()?;
        let key = load_master_key()?;
        return save_auth_session_to_path(path.as_path(), key.as_slice(), &payload);
    }

    let path = auth_session_dev_path()?;
    save_plaintext_auth_session_to_path(path.as_path(), &payload)
}

#[tauri::command]
pub fn auth_session_clear() -> Result<(), String> {
    let path = if should_use_keyring_session_storage() {
        auth_session_path()?
    } else {
        auth_session_dev_path()?
    };
    clear_session_file(path.as_path())
}

#[cfg(test)]
mod tests {
    use super::{
        clear_session_file, coerce_cleared_session_load_result, load_auth_session_from_path,
        load_plaintext_auth_session_from_path, normalize_master_key_read_result,
        read_or_create_master_key, save_auth_session_to_path, save_plaintext_auth_session_to_path,
        should_use_keyring_session_storage_from_env, AuthSessionLoadResult, AuthSessionSavePayload,
        AuthSessionUser, AES_KEY_LEN, AUTH_SESSION_DEV_USE_KEYCHAIN_ENV,
    };
    use crate::test_support::with_env;
    use std::cell::RefCell;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-auth-session-{name}-{suffix}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn session_path(name: &str) -> PathBuf {
        temp_dir(name).join("session.v1.json")
    }

    fn dev_session_path(name: &str) -> PathBuf {
        temp_dir(name).join("session.dev.v1.json")
    }

    fn fixed_key() -> Vec<u8> {
        vec![7_u8; AES_KEY_LEN]
    }

    #[test]
    fn master_key_is_generated_once_and_reused() {
        let stored: RefCell<Option<String>> = RefCell::new(None);
        let first = read_or_create_master_key(
            || Ok(stored.borrow().clone()),
            |value| {
                *stored.borrow_mut() = Some(value.to_string());
                Ok(())
            },
        )
        .expect("first key");
        let second = read_or_create_master_key(
            || Ok(stored.borrow().clone()),
            |_value| Err("should not rewrite".to_string()),
        )
        .expect("second key");
        assert_eq!(first, second);
    }

    #[test]
    fn save_and_load_round_trip() {
        let path = session_path("round-trip");
        let payload = AuthSessionSavePayload {
            realm_base_url: "https://realm.nimi.test".to_string(),
            access_token: "access-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            user: Some(AuthSessionUser {
                id: "user-1".to_string(),
                display_name: "User One".to_string(),
                email: Some("user@example.com".to_string()),
                avatar_url: None,
            }),
            updated_at: "2026-04-05T10:00:00.000Z".to_string(),
            expires_at: Some("2026-04-05T11:00:00.000Z".to_string()),
        };

        save_auth_session_to_path(path.as_path(), fixed_key().as_slice(), &payload).expect("save");
        let loaded = load_auth_session_from_path(path.as_path(), fixed_key().as_slice())
            .expect("load")
            .expect("session exists");

        assert_eq!(
            loaded,
            AuthSessionLoadResult {
                realm_base_url: payload.realm_base_url,
                access_token: "access-token".to_string(),
                refresh_token: Some("refresh-token".to_string()),
                user: payload.user,
                updated_at: payload.updated_at,
                expires_at: payload.expires_at,
            }
        );
    }

    #[test]
    fn corrupt_session_is_cleared_fail_closed() {
        let path = session_path("corrupt");
        fs::write(&path, "{not-json").expect("write corrupt file");

        let error = load_auth_session_from_path(path.as_path(), fixed_key().as_slice())
            .expect_err("load should fail");
        assert!(error.contains("已清理"));
        assert!(!path.exists());
    }

    #[test]
    fn cleared_session_load_error_is_coerced_to_none() {
        let normalized = coerce_cleared_session_load_result(Err(
            "解密 auth session 字段失败: aead::Error; auth session 已清理".to_string(),
        ))
        .expect("coerce cleared session error");
        assert_eq!(normalized, None);
    }

    #[test]
    fn missing_master_key_is_treated_as_absent() {
        let normalized = normalize_master_key_read_result(Err(keyring::Error::NoEntry))
            .expect("no entry should be treated as absent");
        assert_eq!(normalized, None);
    }

    #[test]
    fn inaccessible_master_key_is_not_treated_as_absent() {
        let error =
            normalize_master_key_read_result(Err(keyring::Error::NoStorageAccess(Box::new(
                std::io::Error::new(std::io::ErrorKind::PermissionDenied, "locked"),
            ))))
            .expect_err("storage access errors must not be coerced to missing");
        assert!(error.contains("读取 auth session master key 失败"));
    }

    #[test]
    fn debug_build_uses_plaintext_storage_by_default() {
        let uses_keyring = should_use_keyring_session_storage_from_env(true, None);
        assert!(!uses_keyring);
    }

    #[test]
    fn debug_build_can_force_keyring_storage_via_env() {
        let uses_keyring = should_use_keyring_session_storage_from_env(true, Some("1"));
        assert!(uses_keyring);
    }

    #[test]
    fn release_build_always_uses_keyring_storage() {
        let uses_keyring = should_use_keyring_session_storage_from_env(false, None);
        assert!(uses_keyring);
    }

    #[test]
    fn plaintext_session_round_trip() {
        let path = dev_session_path("plaintext-round-trip");
        let payload = AuthSessionSavePayload {
            realm_base_url: "https://realm.nimi.test".to_string(),
            access_token: "access-token".to_string(),
            refresh_token: Some("refresh-token".to_string()),
            user: Some(AuthSessionUser {
                id: "user-1".to_string(),
                display_name: "User One".to_string(),
                email: Some("user@example.com".to_string()),
                avatar_url: None,
            }),
            updated_at: "2026-04-05T10:00:00.000Z".to_string(),
            expires_at: Some("2026-04-05T11:00:00.000Z".to_string()),
        };

        save_plaintext_auth_session_to_path(path.as_path(), &payload).expect("save plaintext");
        let loaded = load_plaintext_auth_session_from_path(path.as_path())
            .expect("load plaintext")
            .expect("plaintext session exists");
        assert_eq!(loaded.realm_base_url, payload.realm_base_url);
        assert_eq!(loaded.access_token, payload.access_token);
        assert_eq!(loaded.refresh_token, payload.refresh_token);
        assert_eq!(loaded.updated_at, payload.updated_at);
        assert_eq!(loaded.expires_at, payload.expires_at);
        assert_eq!(loaded.user, payload.user);
    }

    #[test]
    fn auth_session_dev_env_override_is_respected() {
        with_env(&[(AUTH_SESSION_DEV_USE_KEYCHAIN_ENV, Some("1"))], || {
            assert!(super::should_use_keyring_session_storage());
        });
        with_env(&[(AUTH_SESSION_DEV_USE_KEYCHAIN_ENV, None)], || {
            #[cfg(debug_assertions)]
            assert!(!super::should_use_keyring_session_storage());
        });
    }

    #[test]
    fn clear_is_idempotent() {
        let path = session_path("clear");
        fs::write(&path, "x").expect("write file");
        clear_session_file(path.as_path()).expect("clear");
        clear_session_file(path.as_path()).expect("clear again");
        assert!(!path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn session_file_is_written_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let path = session_path("permissions");
        let payload = AuthSessionSavePayload {
            realm_base_url: "https://realm.nimi.test".to_string(),
            access_token: "access-token".to_string(),
            refresh_token: None,
            user: None,
            updated_at: "2026-04-05T10:00:00.000Z".to_string(),
            expires_at: None,
        };

        save_auth_session_to_path(path.as_path(), fixed_key().as_slice(), &payload).expect("save");
        let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
