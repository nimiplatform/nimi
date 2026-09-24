use super::{
    compose_envelope_for_source, normalize_endpoint, project_bridge_result, rejected,
    validate_request_id,
};
use serde_json::json;

#[derive(Debug, serde::Deserialize)]
struct GoldenVectorTable {
    accepted: Option<Vec<AcceptedGoldenVector>>,
    rejected: Option<Vec<RejectedGoldenVector>>,
}

#[derive(Debug, serde::Deserialize)]
struct AcceptedGoldenVector {
    id: String,
    envelope: serde_json::Value,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RejectedGoldenVector {
    id: String,
    reason_code: String,
}

#[test]
fn endpoint_accepts_exact_loopback_origins_only() {
    assert_eq!(
        normalize_endpoint("http://127.0.0.1:4500").expect("loopback"),
        "http://127.0.0.1:4500",
    );
    assert_eq!(
        normalize_endpoint("http://[::1]:4500").expect("ipv6 loopback"),
        "http://[::1]:4500",
    );
    assert!(normalize_endpoint("http://localhost:4500").is_err());
    assert!(normalize_endpoint("http://0.0.0.0:4500").is_err());
    assert!(normalize_endpoint("http://127.0.0.1:4500/v1/open-intent").is_err());
    assert!(normalize_endpoint("http://user:pass@127.0.0.1:4500").is_err()); // pragma: allowlist secret -- rejected placeholder credentials
    assert!(normalize_endpoint("http://user:pass@[::1]:4500").is_err()); // pragma: allowlist secret -- rejected placeholder credentials
}

#[test]
fn request_id_requires_desktop_open_prefix() {
    assert_eq!(
        validate_request_id("desktop-open-tauri-test").expect("request id"),
        "desktop-open-tauri-test",
    );
    assert!(validate_request_id("tauri-test").is_err());
    assert!(validate_request_id("desktop-open--tauri-test").is_err());
}

#[test]
fn creator_trial_is_not_an_admitted_desktop_open_target() {
    let result = compose_envelope_for_source(
        "nimi.realm-world-studio",
        json!({ "intent": { "kind": "open-world-character-preview" } }),
    );
    assert_eq!(result.expect_err("creator trial must not open").reason_code(), "desktop-open-target-unsupported");
}

#[test]
fn renderer_request_rejects_invalid_intent_before_descriptor_io() {
    let result = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "worlds",
                "productIntent": "select-partner"
            }
        }),
    );

    assert!(result.is_err());
}

#[test]
fn renderer_request_preserves_unsupported_target_reason_code_before_descriptor_io() {
    let result = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "worlds",
                "productIntent": "select-partner"
            }
        }),
    );

    let error = result.expect_err("unsupported target must reject before descriptor IO");
    assert_eq!(error.reason_code(), "desktop-open-target-unsupported");
}

#[test]
fn source_app_and_app_id_use_canonical_nimi_app_id_grammar() {
    let accepted = compose_envelope_for_source(
        "1P.NIMI9",
        json!({
            "intent": {
                "kind": "open-apps",
                "appId": "9app.plugin-2"
            }
        }),
    )
    .expect("canonical app ids should parse");
    assert_eq!(accepted["sourceApp"], "1p.nimi9");
    assert_eq!(accepted["intent"]["appId"], "9app.plugin-2");

    assert!(
        compose_envelope_for_source("nimi.bad-", json!({ "intent": { "kind": "open-apps" } }),)
            .is_err()
    );
    assert!(compose_envelope_for_source(
        "nimi.tauri",
        json!({ "intent": { "kind": "open-apps", "appId": "nimi..bad" } }),
    )
    .is_err());
}

#[test]
fn tauri_identifier_maps_to_canonical_source_app() {
    let accepted = compose_envelope_for_source(
        "ai.nimi.apps.nimi.desktop",
        json!({
            "intent": {
                "kind": "open-apps"
            }
        }),
    )
    .expect("tauri identifier should resolve to canonical app id");

    assert_eq!(accepted["sourceApp"], "nimi.desktop");
}

#[test]
fn query_length_counts_unicode_scalar_values() {
    let admitted_query = "😀".repeat(160);
    let accepted = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "personas",
                "query": admitted_query,
            }
        }),
    )
    .expect("160 Unicode scalar values should parse");
    assert_eq!(accepted["intent"]["kind"], "open-explore");

    let error = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-explore",
                "section": "personas",
                "query": "😀".repeat(161),
            }
        }),
    )
    .expect_err("161 Unicode scalar values must fail closed");
    assert_eq!(error.reason_code(), "desktop-open-intent-invalid");
}

#[test]
fn standard_desktop_open_golden_vectors_match_platform_table() {
    let vectors = read_golden_vectors();

    for vector in vectors.accepted.unwrap_or_default() {
        let envelope = vector
            .envelope
            .as_object()
            .unwrap_or_else(|| panic!("{} accepted vector envelope must be an object", vector.id));
        let payload = json!({
            "requestId": envelope.get("requestId").cloned().unwrap_or_else(|| {
                panic!("{} accepted vector missing requestId", vector.id)
            }),
            "intent": envelope.get("intent").cloned().unwrap_or_else(|| {
                panic!("{} accepted vector missing intent", vector.id)
            }),
        });
        let parsed = compose_envelope_for_source("ai.nimi.apps.nimi.tauri", payload)
            .unwrap_or_else(|error| panic!("{} should parse but failed: {:?}", vector.id, error));
        assert_eq!(parsed["sourceApp"], "nimi.tauri", "{}", vector.id);
        assert_eq!(
            parsed["intent"],
            envelope.get("intent").expect("accepted intent").clone(),
            "{}",
            vector.id,
        );
    }

    for vector in vectors.rejected.unwrap_or_default() {
        let (source_app, payload) = rejected_golden_case(&vector.id)
            .unwrap_or_else(|| panic!("{} has executable Tauri coverage", vector.id));
        let error = compose_envelope_for_source(source_app, payload)
            .expect_err("rejected vector must fail closed");
        assert_eq!(
            error.reason_code(),
            vector.reason_code,
            "{} rejected with stable reason code",
            vector.id,
        );
    }
}

#[test]
fn standard_desktop_open_apps_section_requires_an_app_and_exact_section() {
    let missing_app = compose_envelope_for_source(
        "nimi.tauri",
        json!({ "intent": { "kind": "open-apps", "section": "ai-models" } }),
    )
    .expect_err("an Apps section without appId must fail closed");
    assert_eq!(missing_app.reason_code(), "desktop-open-intent-invalid");

    let unsupported_section = compose_envelope_for_source(
        "nimi.tauri",
        json!({
            "intent": {
                "kind": "open-apps",
                "appId": "nimi.example",
                "section": "access",
            }
        }),
    )
    .expect_err("only the AI models Apps section is admitted");
    assert_eq!(
        unsupported_section.reason_code(),
        "desktop-open-target-unsupported"
    );
}

fn read_golden_vectors() -> GoldenVectorTable {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/testdata/desktop-open-intent-golden-vectors.yaml");
    serde_yaml::from_str(
        &std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("failed to read {}: {error}", path.display())),
    )
    .unwrap_or_else(|error| panic!("failed to parse {}: {error}", path.display()))
}

fn rejected_golden_case(id: &str) -> Option<(&'static str, serde_json::Value)> {
    Some(match id {
        "source-app-missing" => (
            "",
            json!({ "intent": { "kind": "open-settings", "section": "profile" } }),
        ),
        "unknown-field-authorization" => (
            "nimi.tauri",
            json!({
                "authorization": "secret",
                "intent": { "kind": "open-settings", "section": "profile" },
            }),
        ),
        "unknown-target" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-developer-tools" } }),
        ),
        "invalid-runtime-action-page-pair" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "cloud", "action": "install-model" } }),
        ),
        "invalid-explore-worlds-select-partner-pair" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-explore", "section": "worlds", "productIntent": "select-partner" } }),
        ),
        "invalid-explore-activity-discover-personas-pair" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-explore", "section": "activity", "productIntent": "discover-personas" } }),
        ),
        "invalid-source-host" => (
            "nimi.tauri",
            json!({
                "sourceHost": "unknown-shell",
                "intent": { "kind": "open-settings", "section": "profile" },
            }),
        ),
        "invalid-request-id" => (
            "nimi.tauri",
            json!({
                "requestId": "desktop-open--reject-7b",
                "intent": { "kind": "open-settings", "section": "profile" },
            }),
        ),
        "invalid-app-id" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-apps", "appId": "Nimi.Bad" } }),
        ),
        "invalid-query-too-long" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-explore", "section": "personas", "query": "x".repeat(161) } }),
        ),
        "developer-tools-settings-target-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-settings", "section": "developer-tools" } }),
        ),
        "retired-agents-target-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-agents", "view": "inventory" } }),
        ),
        "runtime-profiles-manage-profile-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "profiles", "action": "manage-profile" } }),
        ),
        "runtime-advanced-inspect-runtime-v1" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "advanced", "action": "inspect-runtime" } }),
        ),
        "os-scheme-url" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-url", "url": format!("{}{}", "nimi-desktop", "://runtime-config/cloud") } }),
        ),
        "raw-url-payload" => (
            "nimi.tauri",
            json!({ "url": "http://127.0.0.1:1/v1/open-intent" }),
        ),
        "renderer-provided-source-app" => (
            "nimi.tauri",
            json!({ "sourceApp": "nimi.spoof", "intent": { "kind": "open-apps" } }),
        ),
        "provider-model-credential-fields" => (
            "nimi.tauri",
            json!({ "intent": { "kind": "open-runtime-config", "page": "models", "action": "install-model", "providerApiKey": "secret" } }),
        ),
        _ => return None,
    })
}

#[test]
fn result_mapping_rejects_malformed_accepted_result() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "accepted",
                "confirmation": "desktop-accepted",
                "bridgeId": "desktop-open-bridge-test",
                "requestId": "desktop-open-request-test",
                "appliedTarget": "open-apps",
                "extra": true
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
}

#[test]
fn result_mapping_rejects_accepted_result_mismatched_to_request() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "accepted",
                "confirmation": "desktop-accepted",
                "bridgeId": "desktop-open-bridge-test",
                "requestId": "desktop-open-other-request",
                "appliedTarget": "open-apps"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "accepted",
                "confirmation": "desktop-accepted",
                "bridgeId": "desktop-open-bridge-test",
                "requestId": "desktop-open-request-test",
                "appliedTarget": "open-settings"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
}

#[test]
fn result_mapping_rejects_unknown_reason_codes() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "rejected",
                "bridgeId": "desktop-open-bridge-test",
                "reasonCode": "desktop-open-bridge-unavailable",
                "actionHint": "check_desktop_runtime_bridge"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        rejected("desktop-open-intent-invalid", "fix_desktop_open_intent"),
    );
}

#[test]
fn result_mapping_strips_bridge_id_from_valid_rejected_result() {
    assert_eq!(
        project_bridge_result(
            json!({
                "status": "rejected",
                "bridgeId": "desktop-open-bridge-test",
                "reasonCode": "desktop-open-desktop-not-ready",
                "actionHint": "wait_for_desktop_ready"
            }),
            "desktop-open-bridge-test",
            "desktop-open-request-test",
            "open-apps",
        ),
        json!({
            "status": "rejected",
            "reasonCode": "desktop-open-desktop-not-ready",
            "actionHint": "wait_for_desktop_ready"
        }),
    );
}

const ACTIVITY_OPEN_REQUEST_ID: &str = "aor_Q2l0eUxpZ2h0c0FyZUJyaWdodFRvbmln";
const ACTIVITY_BRIDGE_ID: &str = "desktop-open-bridge-test";

fn activity_launch_descriptor(port: u16) -> super::DesktopOpenPresenceDescriptor {
    super::DesktopOpenPresenceDescriptor {
        schema_version: 1,
        bridge_id: ACTIVITY_BRIDGE_ID.to_string(),
        endpoint: format!("http://127.0.0.1:{port}"),
        token: "fixture-bridge-token".to_string(),
        last_heartbeat_at: "2026-09-20T09:00:00Z".to_string(),
    }
}

/// Serves exactly one HTTP exchange on loopback and returns the raw request.
fn serve_activity_launch_once(
    status_line: &'static str,
    body: &'static str,
) -> (u16, std::thread::JoinHandle<String>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind loopback fixture");
    let port = listener.local_addr().expect("fixture address").port();
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept launch request");
        socket
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .expect("read timeout");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        loop {
            let read = socket.read(&mut buffer).expect("read launch request");
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
            let Some(header_end) = request.windows(4).position(|window| window == b"\r\n\r\n")
            else {
                continue;
            };
            let headers = String::from_utf8_lossy(&request[..header_end]).to_ascii_lowercase();
            let length = headers
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .map(|value| value.trim().parse::<usize>().expect("content length"))
                .unwrap_or(0);
            if request.len() >= header_end + 4 + length {
                break;
            }
        }
        let response = format!(
            "{status_line}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        socket
            .write_all(response.as_bytes())
            .expect("write launch response");
        String::from_utf8(request).expect("UTF-8 launch request")
    });
    (port, server)
}

#[tokio::test]
async fn activity_source_launch_posts_only_the_open_request_with_bridge_bearer_auth() {
    let (port, server) = serve_activity_launch_once(
        "HTTP/1.1 200 OK",
        r#"{"bridgeId":"desktop-open-bridge-test","status":"requested"}"#,
    );
    let outcome = super::send_app_activity_source_launch(
        &activity_launch_descriptor(port),
        ACTIVITY_OPEN_REQUEST_ID,
    )
    .await;
    assert_eq!(outcome, super::AppActivitySourceLaunch::Requested);
    let request = server.join().expect("launch fixture");
    assert!(request.starts_with("POST /v1/app-activity-source-launch HTTP/1.1\r\n"));
    let (headers, body) = request.split_once("\r\n\r\n").expect("HTTP request framing");
    assert!(headers
        .to_ascii_lowercase()
        .contains("\r\nauthorization: bearer fixture-bridge-token"));
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(body).expect("JSON launch body"),
        json!({ "schemaVersion": 1, "openRequestId": ACTIVITY_OPEN_REQUEST_ID }),
    );
}

#[tokio::test]
async fn activity_source_launch_maps_refused_or_unreadable_desktop_to_host_unavailable() {
    let (port, server) = serve_activity_launch_once("HTTP/1.1 403 Forbidden", "{}");
    assert_eq!(
        super::send_app_activity_source_launch(
            &activity_launch_descriptor(port),
            ACTIVITY_OPEN_REQUEST_ID,
        )
        .await,
        super::AppActivitySourceLaunch::HOST_UNAVAILABLE,
    );
    server.join().expect("refusing fixture");

    let (port, server) = serve_activity_launch_once("HTTP/1.1 200 OK", "not-json");
    assert_eq!(
        super::send_app_activity_source_launch(
            &activity_launch_descriptor(port),
            ACTIVITY_OPEN_REQUEST_ID,
        )
        .await,
        super::AppActivitySourceLaunch::HOST_UNAVAILABLE,
    );
    server.join().expect("unreadable fixture");

    let closed_port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind closed port");
        listener.local_addr().expect("closed address").port()
    };
    assert_eq!(
        super::send_app_activity_source_launch(
            &activity_launch_descriptor(closed_port),
            ACTIVITY_OPEN_REQUEST_ID,
        )
        .await,
        super::AppActivitySourceLaunch::HOST_UNAVAILABLE,
    );
}

#[test]
fn activity_source_launch_accepts_only_the_closed_desktop_vocabulary() {
    use super::AppActivitySourceLaunch;
    let parse =
        |raw: serde_json::Value| super::parse_app_activity_source_launch(&raw, ACTIVITY_BRIDGE_ID);
    assert_eq!(
        parse(json!({ "bridgeId": ACTIVITY_BRIDGE_ID, "status": "requested" })),
        AppActivitySourceLaunch::Requested,
    );
    assert_eq!(
        parse(json!({
            "bridgeId": ACTIVITY_BRIDGE_ID, "status": "unavailable", "reason": "source-unavailable",
        })),
        AppActivitySourceLaunch::Declined {
            outcome: "unavailable",
            reason: "source-unavailable",
        },
    );
    assert_eq!(
        parse(json!({
            "bridgeId": ACTIVITY_BRIDGE_ID, "status": "unavailable", "reason": "host-unavailable",
        })),
        AppActivitySourceLaunch::HOST_UNAVAILABLE,
    );
    assert_eq!(
        parse(json!({
            "bridgeId": ACTIVITY_BRIDGE_ID, "status": "failed", "reason": "launch-failed",
        })),
        AppActivitySourceLaunch::LAUNCH_FAILED,
    );
    for malformed in [
        json!({ "bridgeId": "desktop-open-other-bridge", "status": "requested" }),
        json!({ "status": "requested" }),
        json!({ "bridgeId": ACTIVITY_BRIDGE_ID, "status": "requested", "reason": "opened" }),
        json!({ "bridgeId": ACTIVITY_BRIDGE_ID, "status": "opened" }),
        json!({ "bridgeId": ACTIVITY_BRIDGE_ID, "status": "failed", "reason": "host-unavailable" }),
        json!({ "bridgeId": ACTIVITY_BRIDGE_ID, "status": "unavailable", "reason": "launch-failed" }),
        json!({ "bridgeId": ACTIVITY_BRIDGE_ID, "status": "requested", "appId": "nimi.forged" }),
        json!(["requested"]),
    ] {
        assert_eq!(
            parse(malformed.clone()),
            AppActivitySourceLaunch::LAUNCH_FAILED,
            "{malformed}"
        );
    }
}

#[test]
fn activity_open_request_id_is_the_exact_runtime_shape() {
    assert!(super::valid_app_activity_open_request_id(
        ACTIVITY_OPEN_REQUEST_ID
    ));
    for invalid in [
        "",
        "aor_",
        "aod_Q2l0eUxpZ2h0c0FyZUJyaWdodFRvbmln",
        "aor_Q2l0eUxpZ2h0c0FyZUJyaWdodFRvbml",
        "aor_Q2l0eUxpZ2h0c0FyZUJyaWdodFRvbmlnX", // pragma: allowlist secret -- malformed request-id fixture
        "aor_Q2l0eUxpZ2h0c0FyZUJyaWdodFRvbm/n", // pragma: allowlist secret -- malformed request-id fixture
    ] {
        assert!(
            !super::valid_app_activity_open_request_id(invalid),
            "{invalid}"
        );
    }
}
