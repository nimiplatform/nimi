use super::{
    is_authorized_desktop_open_request, is_desktop_open_ready, reject_unknown_desktop_open_route,
    set_desktop_open_ready, write_presence_descriptor, DesktopOpenPresenceDescriptor,
    DESKTOP_OPEN_INTENT_PATH, RENDERER_READY_HEARTBEAT_TTL_MS,
};
use axum::{
    body::Body,
    http::{header, HeaderMap, HeaderValue, Method, Request, StatusCode},
    routing::post,
    Router,
};
use std::fs;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};
use tower::ServiceExt;

fn test_descriptor() -> DesktopOpenPresenceDescriptor {
    DesktopOpenPresenceDescriptor {
        schema_version: 1,
        desktop_app_id: "nimi.desktop".to_string(),
        bridge_id: "desktop-open-bridge-test".to_string(),
        pid: 12345,
        endpoint: "http://127.0.0.1:49152".to_string(),
        token: "desktop-open-token-test".to_string(),
        started_at: "2026-07-08T00:00:00.000Z".to_string(),
        last_heartbeat_at: "2026-07-08T00:00:01.000Z".to_string(),
    }
}

#[test]
fn desktop_open_presence_descriptor_writes_owner_only_file_and_directory() {
    let temp = tempfile::tempdir().expect("tempdir");
    let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
    let descriptor_path = temp_root
        .join("run")
        .join("desktop")
        .join("open-intent")
        .join("presence.v1.json");

    write_presence_descriptor(&descriptor_path, &test_descriptor()).expect("write descriptor");

    let parent = descriptor_path.parent().expect("descriptor parent");
    assert!(descriptor_path.is_file());
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(
            fs::read_to_string(&descriptor_path)
                .expect("read descriptor")
                .as_str()
        )
        .expect("descriptor json")["token"],
        "desktop-open-token-test",
    );
    assert_owner_only_dir(parent);
    assert_owner_only_file(&descriptor_path);
}

#[test]
fn desktop_open_presence_descriptor_replaces_existing_descriptor() {
    let temp = tempfile::tempdir().expect("tempdir");
    let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
    let descriptor_path = temp_root
        .join("run")
        .join("desktop")
        .join("open-intent")
        .join("presence.v1.json");
    write_presence_descriptor(&descriptor_path, &test_descriptor()).expect("write descriptor");

    let mut heartbeat_descriptor = test_descriptor();
    heartbeat_descriptor.token = "desktop-open-token-rotated".to_string();
    heartbeat_descriptor.last_heartbeat_at = "2026-07-08T00:00:09.000Z".to_string();
    write_presence_descriptor(&descriptor_path, &heartbeat_descriptor)
        .expect("replace existing descriptor");

    let descriptor_json = serde_json::from_str::<serde_json::Value>(
        fs::read_to_string(&descriptor_path)
            .expect("read descriptor")
            .as_str(),
    )
    .expect("descriptor json");
    assert_eq!(descriptor_json["token"], "desktop-open-token-rotated");
    assert_eq!(
        descriptor_json["lastHeartbeatAt"],
        "2026-07-08T00:00:09.000Z"
    );
    assert_owner_only_file(&descriptor_path);
}

#[cfg(unix)]
#[test]
fn desktop_open_presence_descriptor_rejects_descriptor_symlink_before_token_write() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("tempdir");
    let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
    let parent = temp_root.join("run/desktop/open-intent");
    fs::create_dir_all(&parent).expect("create parent");
    let descriptor_path = parent.join("presence.v1.json");
    let target_path = temp_root.join("attacker-target");
    fs::write(&target_path, "before").expect("seed target");
    symlink(&target_path, &descriptor_path).expect("descriptor symlink");

    let error = write_presence_descriptor(&descriptor_path, &test_descriptor())
        .expect_err("descriptor symlink must reject");

    assert!(error.contains("symlink"), "{error}");
    assert_eq!(
        fs::read_to_string(&target_path).expect("read target"),
        "before"
    );
}

#[cfg(unix)]
#[test]
fn desktop_open_presence_descriptor_rejects_parent_symlink_before_token_write() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("tempdir");
    let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
    let real_parent = temp_root.join("real-open-intent");
    fs::create_dir_all(&real_parent).expect("create real parent");
    let link_parent = temp_root.join("run").join("desktop").join("open-intent");
    fs::create_dir_all(link_parent.parent().expect("link parent parent"))
        .expect("create link parent parent");
    symlink(&real_parent, &link_parent).expect("parent symlink");
    let descriptor_path = link_parent.join("presence.v1.json");

    let error = write_presence_descriptor(&descriptor_path, &test_descriptor())
        .expect_err("parent symlink must reject");

    assert!(error.contains("symlink"), "{error}");
    assert!(!real_parent.join("presence.v1.json").exists());
}

#[cfg(unix)]
#[test]
fn desktop_open_presence_descriptor_rejects_temp_symlink_before_token_write() {
    use std::os::unix::fs::symlink;

    let temp = tempfile::tempdir().expect("tempdir");
    let temp_root = fs::canonicalize(temp.path()).expect("canonical tempdir");
    let parent = temp_root.join("run/desktop/open-intent");
    fs::create_dir_all(&parent).expect("create parent");
    let descriptor_path = parent.join("presence.v1.json");
    let temp_path = descriptor_path.with_extension("json.tmp");
    let target_path = temp_root.join("attacker-temp-target");
    fs::write(&target_path, "before").expect("seed target");
    symlink(&target_path, &temp_path).expect("temp symlink");

    let error = write_presence_descriptor(&descriptor_path, &test_descriptor())
        .expect_err("temp symlink must reject");

    assert!(
        error.contains("temp") || error.contains("symlink"),
        "{error}"
    );
    assert_eq!(
        fs::read_to_string(&target_path).expect("read target"),
        "before"
    );
    assert!(!descriptor_path.exists());
}

#[test]
fn desktop_open_bridge_auth_rejects_invalid_token() {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer attacker-token"),
    );

    assert!(!is_authorized_desktop_open_request(
        &headers,
        "desktop-open-token-test",
    ));

    headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer desktop-open-token-test"),
    );
    assert!(is_authorized_desktop_open_request(
        &headers,
        "desktop-open-token-test",
    ));
}

#[tokio::test]
async fn desktop_open_bridge_route_is_post_only_and_has_no_cors_surface() {
    let router = Router::new()
        .route(DESKTOP_OPEN_INTENT_PATH, post(|| async { StatusCode::OK }))
        .fallback(reject_unknown_desktop_open_route);

    let get_response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(DESKTOP_OPEN_INTENT_PATH)
                .body(Body::empty())
                .expect("GET request"),
        )
        .await
        .expect("GET response");
    assert_eq!(get_response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_has_no_cors_headers(get_response.headers());

    let options_response = router
        .oneshot(
            Request::builder()
                .method(Method::OPTIONS)
                .uri(DESKTOP_OPEN_INTENT_PATH)
                .body(Body::empty())
                .expect("OPTIONS request"),
        )
        .await
        .expect("OPTIONS response");
    assert_eq!(options_response.status(), StatusCode::METHOD_NOT_ALLOWED);
    assert_has_no_cors_headers(options_response.headers());
}

#[test]
fn desktop_open_ready_lifecycle_expires_stale_renderer_heartbeat() {
    let ready = AtomicBool::new(false);
    let heartbeat = Mutex::new(None);

    set_desktop_open_ready(&ready, &heartbeat, true);
    assert!(is_desktop_open_ready(&ready, &heartbeat));

    {
        let mut heartbeat = heartbeat.lock().expect("heartbeat lock");
        *heartbeat =
            Some(Instant::now() - Duration::from_millis(RENDERER_READY_HEARTBEAT_TTL_MS + 1_000));
    }

    assert!(!is_desktop_open_ready(&ready, &heartbeat));
    assert!(!ready.load(Ordering::SeqCst));
}

#[cfg(unix)]
fn assert_owner_only_dir(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path)
        .expect("dir metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o700);
}

#[cfg(not(unix))]
fn assert_owner_only_dir(_path: &std::path::Path) {}

#[cfg(unix)]
fn assert_owner_only_file(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path)
        .expect("file metadata")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600);
}

#[cfg(not(unix))]
fn assert_owner_only_file(_path: &std::path::Path) {}

fn assert_has_no_cors_headers(headers: &HeaderMap) {
    assert!(!headers.contains_key("access-control-allow-origin"));
    assert!(!headers.contains_key("access-control-allow-methods"));
    assert!(!headers.contains_key("access-control-allow-headers"));
}
