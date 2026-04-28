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
const AUTH_SESSION_E2E_FILE_NAME: &str = "session.e2e.v1.json";
const AUTH_SESSION_KEY_SERVICE: &str = "nimi.desktop.auth-session";
const AUTH_SESSION_KEY_ACCOUNT: &str = "master-key.v1";
const AUTH_SESSION_E2E_STORAGE_ENV: &str = "NIMI_E2E_AUTH_SESSION_STORAGE";
const AUTH_SESSION_E2E_STORAGE_ENCRYPTED_FILE: &str = "encrypted-file";
const AUTH_SESSION_E2E_MASTER_KEY_ENV: &str = "NIMI_E2E_AUTH_SESSION_MASTER_KEY";
const AUTH_SESSION_E2E_PROFILE_ENV: &str = "NIMI_E2E_PROFILE";
const AUTH_SESSION_E2E_FIXTURE_PATH_ENV: &str = "NIMI_E2E_FIXTURE_PATH";
const AES_KEY_LEN: usize = 32;
const AES_NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthSessionStorageMode {
    Keyring,
    E2eEncryptedFile,
}

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

fn auth_session_e2e_path() -> Result<PathBuf, String> {
    auth_session_path_for_file(AUTH_SESSION_E2E_FILE_NAME)
}

fn should_use_keyring_session_storage_from_env(
    _is_debug_build: bool,
    _env_value: Option<&str>,
) -> bool {
    true
}

fn should_use_keyring_session_storage() -> bool {
    should_use_keyring_session_storage_from_env(cfg!(debug_assertions), None)
}

fn non_empty_env(name: &str) -> bool {
    std::env::var(name)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
}

fn should_use_e2e_encrypted_file_storage_from_env(
    storage_value: Option<&str>,
    master_key_value: Option<&str>,
    has_profile: bool,
    has_fixture_path: bool,
) -> bool {
    matches!(
        storage_value.map(str::trim),
        Some(AUTH_SESSION_E2E_STORAGE_ENCRYPTED_FILE)
    ) && master_key_value
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
        && has_profile
        && has_fixture_path
}

fn should_use_e2e_encrypted_file_storage() -> bool {
    should_use_e2e_encrypted_file_storage_from_env(
        std::env::var(AUTH_SESSION_E2E_STORAGE_ENV).ok().as_deref(),
        std::env::var(AUTH_SESSION_E2E_MASTER_KEY_ENV)
            .ok()
            .as_deref(),
        non_empty_env(AUTH_SESSION_E2E_PROFILE_ENV),
        non_empty_env(AUTH_SESSION_E2E_FIXTURE_PATH_ENV),
    )
}

fn auth_session_storage_mode() -> AuthSessionStorageMode {
    if should_use_e2e_encrypted_file_storage() {
        return AuthSessionStorageMode::E2eEncryptedFile;
    }
    if should_use_keyring_session_storage() {
        return AuthSessionStorageMode::Keyring;
    }
    AuthSessionStorageMode::Keyring
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

fn load_existing_master_key() -> Result<Option<Vec<u8>>, String> {
    let entry = keyring_entry()?;
    match normalize_master_key_read_result(entry.get_password())? {
        Some(encoded) => {
            let decoded = BASE64_STANDARD
                .decode(encoded.trim())
                .map_err(|error| format!("auth session master key 解码失败: {error}"))?;
            if decoded.len() != AES_KEY_LEN {
                return Err(format!(
                    "auth session master key 长度无效: expected={AES_KEY_LEN} actual={}",
                    decoded.len()
                ));
            }
            Ok(Some(decoded))
        }
        None => Ok(None),
    }
}

fn load_or_create_master_key() -> Result<Vec<u8>, String> {
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

fn load_e2e_master_key() -> Result<Vec<u8>, String> {
    let encoded = std::env::var(AUTH_SESSION_E2E_MASTER_KEY_ENV)
        .map_err(|_| "E2E auth session master key is not configured".to_string())?;
    let decoded = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|error| format!("E2E auth session master key 解码失败: {error}"))?;
    if decoded.len() != AES_KEY_LEN {
        return Err(format!(
            "E2E auth session master key 长度无效: expected={AES_KEY_LEN} actual={}",
            decoded.len()
        ));
    }
    Ok(decoded)
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

    let parsed = serde_json::from_str::<AuthSessionFile>(&raw).map_err(|error| {
        format!(
            "解析 auth session 文件失败，已忽略当前 session ({}): {error}",
            path.display()
        )
    })?;

    if parsed.schema_version != AUTH_SESSION_SCHEMA_VERSION {
        return Err(format!(
            "auth session schemaVersion 无效，已忽略当前 session: expected={} actual={}",
            AUTH_SESSION_SCHEMA_VERSION, parsed.schema_version
        ));
    }

    let access_token = match decrypt_secret(key, parsed.access_token_ciphertext.as_str()) {
        Ok(value) if !value.trim().is_empty() => value,
        Ok(_) => {
            return Err("auth session access token 为空，已忽略当前 session".to_string());
        }
        Err(error) => {
            return Err(format!("{error}; auth session 已忽略"));
        }
    };

    let refresh_token = match parsed.refresh_token_ciphertext.as_deref() {
        Some(value) => {
            let decrypted = decrypt_secret(key, value)
                .map_err(|error| format!("{error}; auth session 已忽略"))?;
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

fn coerce_unreadable_session_load_result(
    result: Result<Option<AuthSessionLoadResult>, String>,
) -> Result<Option<AuthSessionLoadResult>, String> {
    match result {
        Err(error) if error.contains("已忽略") => Ok(None),
        other => other,
    }
}

fn clear_legacy_plaintext_dev_session_file() -> Result<(), String> {
    let path = auth_session_dev_path()?;
    clear_session_file(path.as_path())
}

#[tauri::command]
pub fn auth_session_load() -> Result<Option<AuthSessionLoadResult>, String> {
    return Err("auth_session_load is disabled for local first-party account truth; use RuntimeAccountService".to_string());
    #[allow(unreachable_code)]
    {
        clear_legacy_plaintext_dev_session_file()?;
        if matches!(
            auth_session_storage_mode(),
            AuthSessionStorageMode::E2eEncryptedFile
        ) {
            let path = auth_session_e2e_path()?;
            let key = load_e2e_master_key()?;
            return coerce_unreadable_session_load_result(load_auth_session_from_path(
                path.as_path(),
                key.as_slice(),
            ));
        }
        let path = auth_session_path()?;
        let Some(key) = load_existing_master_key()? else {
            return Ok(None);
        };
        coerce_unreadable_session_load_result(load_auth_session_from_path(
            path.as_path(),
            key.as_slice(),
        ))
    }
}

#[tauri::command]
pub fn auth_session_save(_payload: AuthSessionSavePayload) -> Result<(), String> {
    return Err("auth_session_save is disabled for local first-party account truth; Runtime owns account custody".to_string());
    #[allow(unreachable_code)]
    {
        if matches!(
            auth_session_storage_mode(),
            AuthSessionStorageMode::E2eEncryptedFile
        ) {
            let path = auth_session_e2e_path()?;
            let key = load_e2e_master_key()?;
            save_auth_session_to_path(path.as_path(), key.as_slice(), &_payload)?;
            return clear_legacy_plaintext_dev_session_file();
        }
        let path = auth_session_path()?;
        let key = load_or_create_master_key()?;
        save_auth_session_to_path(path.as_path(), key.as_slice(), &_payload)?;
        clear_legacy_plaintext_dev_session_file()
    }
}

#[tauri::command]
pub fn auth_session_clear() -> Result<(), String> {
    return Err("auth_session_clear is disabled for local first-party account truth; use RuntimeAccountService.Logout".to_string());
    #[allow(unreachable_code)]
    {
        let path = if matches!(
            auth_session_storage_mode(),
            AuthSessionStorageMode::E2eEncryptedFile
        ) {
            auth_session_e2e_path()?
        } else {
            auth_session_path()?
        };
        clear_session_file(path.as_path())?;
        clear_legacy_plaintext_dev_session_file()
    }
}

#[cfg(test)]
mod auth_session_commands_tests;
