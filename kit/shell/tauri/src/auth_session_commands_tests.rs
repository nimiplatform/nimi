use super::{
    clear_session_file, coerce_unreadable_session_load_result, load_auth_session_from_path,
    load_e2e_master_key, normalize_master_key_read_result, read_or_create_master_key,
    save_auth_session_to_path, should_use_e2e_encrypted_file_storage_from_env,
    should_use_keyring_session_storage_from_env, AuthSessionLoadResult, AuthSessionSavePayload,
    AuthSessionUser, AES_KEY_LEN, AUTH_SESSION_E2E_MASTER_KEY_ENV,
};
use crate::test_support::with_env;
use base64::Engine as _;
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
fn corrupt_session_is_ignored_without_deleting_shared_session() {
    let path = session_path("corrupt");
    fs::write(&path, "{not-json").expect("write corrupt file");

    let error = load_auth_session_from_path(path.as_path(), fixed_key().as_slice())
        .expect_err("load should fail");
    assert!(error.contains("已忽略"));
    assert!(path.exists());
}

#[test]
fn decrypt_failure_is_ignored_without_deleting_shared_session() {
    let path = session_path("wrong-key");
    let payload = AuthSessionSavePayload {
        realm_base_url: "https://realm.nimi.test".to_string(),
        access_token: "access-token".to_string(),
        refresh_token: Some("refresh-token".to_string()),
        user: None,
        updated_at: "2026-04-05T10:00:00.000Z".to_string(),
        expires_at: Some("2026-04-05T11:00:00.000Z".to_string()),
    };
    save_auth_session_to_path(path.as_path(), fixed_key().as_slice(), &payload).expect("save");

    let wrong_key = vec![8_u8; AES_KEY_LEN];
    let error = load_auth_session_from_path(path.as_path(), wrong_key.as_slice())
        .expect_err("load with wrong key should fail");
    assert!(error.contains("已忽略"));
    assert!(path.exists());
}

#[test]
fn unreadable_session_load_error_is_coerced_to_none() {
    let normalized = coerce_unreadable_session_load_result(Err(
        "解密 auth session 字段失败: aead::Error; auth session 已忽略".to_string(),
    ))
    .expect("coerce unreadable session error");
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
    let error = normalize_master_key_read_result(Err(keyring::Error::NoStorageAccess(Box::new(
        std::io::Error::new(std::io::ErrorKind::PermissionDenied, "locked"),
    ))))
    .expect_err("storage access errors must not be coerced to missing");
    assert!(error.contains("读取 auth session master key 失败"));
}

#[test]
fn debug_build_uses_keyring_storage_by_default() {
    let uses_keyring = should_use_keyring_session_storage_from_env(true, None);
    assert!(uses_keyring);
}

#[test]
fn debug_build_does_not_allow_env_to_disable_keyring_storage() {
    let uses_keyring = should_use_keyring_session_storage_from_env(true, Some("0"));
    assert!(uses_keyring);
}

#[test]
fn release_build_always_uses_keyring_storage() {
    let uses_keyring = should_use_keyring_session_storage_from_env(false, None);
    assert!(uses_keyring);
}

#[test]
fn auth_session_dev_env_override_cannot_disable_secure_storage() {
    with_env(&[("NIMI_DESKTOP_DEV_USE_KEYCHAIN", Some("1"))], || {
        assert!(super::should_use_keyring_session_storage());
    });
    with_env(&[("NIMI_DESKTOP_DEV_USE_KEYCHAIN", Some("0"))], || {
        assert!(super::should_use_keyring_session_storage());
    });
}

#[test]
fn e2e_encrypted_file_storage_requires_explicit_smoke_context() {
    assert!(!should_use_e2e_encrypted_file_storage_from_env(
        Some("encrypted-file"),
        Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa="),
        false,
        true,
    ));
    assert!(!should_use_e2e_encrypted_file_storage_from_env(
        Some("encrypted-file"),
        Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa="),
        true,
        false,
    ));
    assert!(should_use_e2e_encrypted_file_storage_from_env(
        Some("encrypted-file"),
        Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa="),
        true,
        true,
    ));
}

#[test]
fn e2e_master_key_must_decode_to_aes_key() {
    let encoded = base64::engine::general_purpose::STANDARD.encode(vec![3_u8; AES_KEY_LEN]);
    with_env(
        &[(AUTH_SESSION_E2E_MASTER_KEY_ENV, Some(encoded.as_str()))],
        || {
            assert_eq!(load_e2e_master_key().expect("key"), vec![3_u8; AES_KEY_LEN]);
        },
    );
    with_env(
        &[(AUTH_SESSION_E2E_MASTER_KEY_ENV, Some("not-base64"))],
        || {
            assert!(load_e2e_master_key().is_err());
        },
    );
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
