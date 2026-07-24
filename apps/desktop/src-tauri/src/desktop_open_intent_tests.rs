use serde_json::json;

use crate::desktop_open_intent::{
    parse_desktop_open_intent_envelope, project_desktop_open_bridge_response,
};

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

fn envelope(intent: serde_json::Value) -> serde_json::Value {
    json!({
        "schemaVersion": 1,
        "sourceApp": "nimi.zhiyu",
        "sourceHost": "electron-standard-shell",
        "requestId": "desktop-open-test-request",
        "intent": intent,
    })
}

#[test]
fn desktop_open_intent_accepts_admitted_targets() {
    let explore = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-explore",
        "section": "activity",
        "productIntent": "view-activity",
    })))
    .expect("activity explore target should parse");
    assert_eq!(explore.intent.kind, "open-explore");
    assert_eq!(explore.intent.section.as_deref(), Some("activity"));

    let runtime = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-runtime-config",
        "page": "cloud",
        "action": "add-connector",
    })))
    .expect("runtime cloud connector target should parse");
    assert_eq!(runtime.intent.kind, "open-runtime-config");
    assert_eq!(runtime.intent.page.as_deref(), Some("cloud"));
}

#[test]
fn desktop_open_intent_uses_canonical_app_id_grammar() {
    let accepted = parse_desktop_open_intent_envelope(json!({
        "schemaVersion": 1,
        "sourceApp": "1p.nimi9",
        "sourceHost": "electron-standard-shell",
        "requestId": "desktop-open-test-request",
        "intent": {
            "kind": "open-apps",
            "appId": "9app.plugin-2",
        },
    }))
    .expect("canonical digit-leading app ids should parse");
    assert_eq!(accepted.intent.kind, "open-apps");

    let trailing_hyphen = parse_desktop_open_intent_envelope(json!({
        "schemaVersion": 1,
        "sourceApp": "nimi.bad-",
        "sourceHost": "electron-standard-shell",
        "requestId": "desktop-open-test-request",
        "intent": { "kind": "open-apps" },
    }))
    .expect_err("segment trailing hyphen must fail closed");
    assert_eq!(trailing_hyphen.reason_code, "desktop-open-intent-invalid");

    let empty_segment = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-apps",
        "appId": "nimi..bad",
    })))
    .expect_err("empty app id segment must fail closed");
    assert_eq!(empty_segment.reason_code, "desktop-open-intent-invalid");

    let invalid_request_id = parse_desktop_open_intent_envelope(json!({
        "schemaVersion": 1,
        "sourceApp": "nimi.test",
        "sourceHost": "electron-standard-shell",
        "requestId": "desktop-open--bad",
        "intent": { "kind": "open-apps" },
    }))
    .expect_err("request id suffix must start with an alphanumeric character");
    assert_eq!(
        invalid_request_id.reason_code,
        "desktop-open-intent-invalid"
    );
}

#[test]
fn desktop_open_intent_counts_query_length_by_unicode_scalar_values() {
    let admitted_query = "😀".repeat(160);
    let accepted = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-explore",
        "section": "personas",
        "query": admitted_query,
    })))
    .expect("160 Unicode scalar values should parse");
    assert_eq!(accepted.intent.kind, "open-explore");

    let too_long = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-explore",
        "section": "personas",
        "query": "😀".repeat(161),
    })))
    .expect_err("161 Unicode scalar values must fail closed");
    assert_eq!(too_long.reason_code, "desktop-open-intent-invalid");
}

#[test]
fn desktop_open_intent_rejects_unsupported_pairs_and_raw_urls() {
    let invalid_pair = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-explore",
        "section": "worlds",
        "productIntent": "select-partner",
    })))
    .expect_err("worlds/select-partner must fail closed");
    assert_eq!(invalid_pair.reason_code, "desktop-open-target-unsupported");

    let raw_url = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-url",
        "url": "nimi-desktop://runtime-config/cloud",
    })))
    .expect_err("raw URL payloads are outside the running-only standard");
    assert_eq!(raw_url.reason_code, "desktop-open-intent-invalid");
}

#[test]
fn desktop_open_intent_bridge_rejects_until_renderer_is_ready() {
    let parsed = parse_desktop_open_intent_envelope(envelope(json!({
        "kind": "open-settings",
        "section": "profile",
    })))
    .expect("settings profile target should parse");

    let rejected = project_desktop_open_bridge_response("desktop-open-bridge-test", false, &parsed);
    assert_eq!(rejected.status, "rejected");
    assert_eq!(
        rejected.reason_code.as_deref(),
        Some("desktop-open-desktop-not-ready"),
    );

    let accepted = project_desktop_open_bridge_response("desktop-open-bridge-test", true, &parsed);
    assert_eq!(accepted.status, "accepted");
    assert_eq!(
        accepted.request_id.as_deref(),
        Some("desktop-open-test-request")
    );
    assert_eq!(accepted.applied_target.as_deref(), Some("open-settings"));
}

#[test]
fn desktop_open_intent_golden_vectors_match_platform_table() {
    let vectors = read_golden_vectors();

    for vector in vectors.accepted.unwrap_or_default() {
        let parsed = parse_desktop_open_intent_envelope(vector.envelope)
            .unwrap_or_else(|error| panic!("{} should parse but failed: {error}", vector.id));
        assert!(
            !parsed.intent.kind.is_empty(),
            "{} parsed target kind",
            vector.id
        );
    }

    for vector in vectors.rejected.unwrap_or_default() {
        let payload = rejected_golden_payload(&vector.id)
            .unwrap_or_else(|| panic!("{} has executable Desktop Rust coverage", vector.id));
        let error = parse_desktop_open_intent_envelope(payload)
            .unwrap_err_or_else(|| panic!("{} should reject but parsed", vector.id));
        assert_eq!(
            error.reason_code, vector.reason_code,
            "{} rejected with stable reason code",
            vector.id,
        );
    }
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

trait UnwrapErrOrElse<T, E> {
    fn unwrap_err_or_else<F: FnOnce() -> E>(self, f: F) -> E;
}

impl<T, E> UnwrapErrOrElse<T, E> for Result<T, E> {
    fn unwrap_err_or_else<F: FnOnce() -> E>(self, f: F) -> E {
        match self {
            Ok(_) => f(),
            Err(error) => error,
        }
    }
}

fn rejected_golden_payload(id: &str) -> Option<serde_json::Value> {
    Some(match id {
        "source-app-missing" => json!({
            "schemaVersion": 1,
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-1",
            "intent": { "kind": "open-settings", "section": "profile" },
        }),
        "unknown-field-authorization" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-2",
            "authorization": "secret",
            "intent": { "kind": "open-settings", "section": "profile" },
        }),
        "unknown-target" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-3",
            "intent": { "kind": "open-developer-tools" },
        }),
        "invalid-runtime-action-page-pair" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-4",
            "intent": { "kind": "open-runtime-config", "page": "cloud", "action": "install-model" },
        }),
        "invalid-explore-worlds-select-partner-pair" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-5",
            "intent": { "kind": "open-explore", "section": "worlds", "productIntent": "select-partner" },
        }),
        "invalid-explore-activity-discover-personas-pair" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-6",
            "intent": { "kind": "open-explore", "section": "activity", "productIntent": "discover-personas" },
        }),
        "invalid-source-host" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "unknown-shell",
            "requestId": "desktop-open-reject-7",
            "intent": { "kind": "open-settings", "section": "profile" },
        }),
        "invalid-request-id" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open--reject-7b",
            "intent": { "kind": "open-settings", "section": "profile" },
        }),
        "invalid-app-id" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-8",
            "intent": { "kind": "open-apps", "appId": "Nimi.Bad" },
        }),
        "invalid-query-too-long" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-9",
            "intent": { "kind": "open-explore", "section": "personas", "query": "x".repeat(161) },
        }),
        "developer-tools-settings-target-v1" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-10",
            "intent": { "kind": "open-settings", "section": "developer-tools" },
        }),
        "agent-center-target-v1" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-11",
            "intent": { "kind": "open-agents", "view": "agent-center" },
        }),
        "agent-center-local-agent-ref-v1" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-14",
            "intent": { "kind": "open-agents", "view": "agent-center", "localAgentRef": "agent-local-1" },
        }),
        "runtime-profiles-manage-profile-v1" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-15",
            "intent": { "kind": "open-runtime-config", "page": "profiles", "action": "manage-profile" },
        }),
        "runtime-advanced-inspect-runtime-v1" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-16",
            "intent": { "kind": "open-runtime-config", "page": "advanced", "action": "inspect-runtime" },
        }),
        "os-scheme-url" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-12",
            "intent": { "kind": "open-url", "url": "nimi-desktop://runtime-config/cloud" },
        }),
        "raw-url-payload" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-13",
            "url": "http://127.0.0.1:1/v1/open-intent",
        }),
        "renderer-provided-source-app" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-18",
            "rendererSourceApp": "nimi.spoof",
            "intent": { "kind": "open-apps" },
        }),
        "provider-model-credential-fields" => json!({
            "schemaVersion": 1,
            "sourceApp": "nimi.test",
            "sourceHost": "electron-standard-shell",
            "requestId": "desktop-open-reject-17",
            "intent": { "kind": "open-runtime-config", "page": "models", "action": "install-model", "providerApiKey": "secret" },
        }),
        _ => return None,
    })
}
