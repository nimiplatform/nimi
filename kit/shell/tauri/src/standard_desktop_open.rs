use aes_gcm::aead::rand_core::{OsRng, RngCore};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use chrono::{DateTime, Utc};
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use url::Url;

const DESKTOP_OPEN_PATH: &str = "/v1/open-intent";
const MAX_HEARTBEAT_AGE_MS: i64 = 10_000;
const TAURI_IDENTIFIER_PREFIX: &str = "ai.nimi.apps.";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct DesktopOpenRendererRequest {
    #[serde(default)]
    request_id: Option<String>,
    intent: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopOpenPresenceDescriptor {
    schema_version: u8,
    bridge_id: String,
    endpoint: String,
    token: String,
    last_heartbeat_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DesktopOpenIntentHostParseError {
    reason_code: &'static str,
    message: String,
}

impl DesktopOpenIntentHostParseError {
    fn reason_code(&self) -> &'static str {
        self.reason_code
    }
}

pub async fn desktop_open_intent_open_intent(
    app: tauri::AppHandle,
    payload: Value,
) -> Result<Value, String> {
    let envelope = match compose_envelope(&app, payload) {
        Ok(value) => value,
        Err(error) => return Ok(rejected(error.reason_code(), "fix_desktop_open_intent")),
    };
    let descriptor = match read_presence_descriptor() {
        Ok(value) => value,
        Err(_) => {
            return Ok(rejected(
                "desktop-open-desktop-not-running",
                "open_desktop_first",
            ))
        }
    };
    let client = reqwest::Client::new();
    let response = match client
        .post(format!("{}{}", descriptor.endpoint, DESKTOP_OPEN_PATH))
        .bearer_auth(&descriptor.token)
        .header("content-type", "application/json")
        .body(
            serde_json::to_vec(&envelope)
                .map_err(|error| format!("DesktopOpenIntent envelope serialize failed: {error}"))?,
        )
        .send()
        .await
    {
        Ok(value) => value,
        Err(_) => {
            return Ok(rejected(
                "desktop-open-desktop-not-running",
                "open_desktop_first",
            ))
        }
    };
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) {
        return Ok(rejected(
            "desktop-open-bridge-auth-failed",
            "check_desktop_runtime_bridge",
        ));
    }
    let body = match response.text().await {
        Ok(value) => value,
        Err(_) => {
            return Ok(rejected(
                "desktop-open-desktop-not-running",
                "open_desktop_first",
            ))
        }
    };
    let raw = match serde_json::from_str::<Value>(&body) {
        Ok(value) => value,
        Err(_) => {
            return Ok(rejected(
                "desktop-open-desktop-not-running",
                "open_desktop_first",
            ))
        }
    };
    Ok(project_bridge_result(
        raw,
        &descriptor.bridge_id,
        envelope
            .get("requestId")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        envelope
            .get("intent")
            .and_then(Value::as_object)
            .and_then(|intent| intent.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or_default(),
    ))
}

fn compose_envelope(
    app: &tauri::AppHandle,
    payload: Value,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    compose_envelope_for_source(app.config().identifier.as_str(), payload)
}

fn compose_envelope_for_source(
    source_app_value: &str,
    payload: Value,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    let request: DesktopOpenRendererRequest = serde_json::from_value(payload).map_err(|error| {
        invalid_parse(format!(
            "DesktopOpenIntent renderer request is invalid: {error}"
        ))
    })?;
    let request_id = match request.request_id {
        Some(value) => validate_request_id(&value)?,
        None => generate_request_id(),
    };
    let source_app = normalize_source_app(source_app_value)?;
    let intent = parse_desktop_open_intent(request.intent)?;
    Ok(json!({
        "schemaVersion": 1,
        "sourceApp": source_app,
        "sourceHost": "tauri-standard-shell",
        "requestId": request_id,
        "intent": intent,
    }))
}

fn read_presence_descriptor() -> Result<DesktopOpenPresenceDescriptor, String> {
    let descriptor_path = presence_descriptor_path()?;
    assert_no_symlink_ancestry(&descriptor_path)?;
    let text = fs::read_to_string(&descriptor_path)
        .map_err(|error| format!("Desktop Open presence descriptor read failed: {error}"))?;
    let mut descriptor: DesktopOpenPresenceDescriptor = serde_json::from_str(&text)
        .map_err(|error| format!("Desktop Open presence descriptor parse failed: {error}"))?;
    if descriptor.schema_version != 1 {
        return Err("Desktop Open presence descriptor schemaVersion must be 1".to_string());
    }
    descriptor.bridge_id = validate_request_id(&descriptor.bridge_id).map_err(|error| {
        format!(
            "Desktop Open presence descriptor bridgeId invalid: {}",
            error.message
        )
    })?;
    descriptor.endpoint = normalize_endpoint(&descriptor.endpoint)?;
    if descriptor.token.trim().is_empty() {
        return Err("Desktop Open presence descriptor token is empty".to_string());
    }
    let heartbeat = DateTime::parse_from_rfc3339(&descriptor.last_heartbeat_at)
        .map_err(|error| format!("Desktop Open presence heartbeat invalid: {error}"))?
        .with_timezone(&Utc);
    let age_ms = Utc::now()
        .signed_duration_since(heartbeat)
        .num_milliseconds();
    if age_ms > MAX_HEARTBEAT_AGE_MS {
        return Err("Desktop Open presence descriptor is stale".to_string());
    }
    Ok(descriptor)
}

fn presence_descriptor_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Desktop Open host cannot resolve home directory".to_string())?;
    Ok(home
        .join(".nimi")
        .join("run")
        .join("desktop")
        .join("open-intent")
        .join("presence.v1.json"))
}

fn assert_no_symlink_ancestry(path: &Path) -> Result<(), String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Desktop Open host cannot resolve home directory".to_string())?;
    let relative = path
        .strip_prefix(&home)
        .map_err(|_| "Desktop Open descriptor must live under home".to_string())?;
    let mut current = home;
    for component in relative.components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("Desktop Open descriptor metadata failed: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("Desktop Open descriptor ancestry must not contain symlinks".to_string());
        }
        if current == path && !metadata.is_file() {
            return Err("Desktop Open descriptor must be a regular file".to_string());
        }
    }
    Ok(())
}

fn normalize_endpoint(value: &str) -> Result<String, String> {
    let parsed = Url::parse(value.trim())
        .map_err(|error| format!("Desktop Open endpoint URL invalid: {error}"))?;
    if parsed.scheme() != "http" {
        return Err("Desktop Open endpoint must use http loopback".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Desktop Open endpoint must not include userinfo".to_string());
    }
    if !matches!(parsed.host_str(), Some("127.0.0.1" | "::1" | "[::1]")) {
        return Err("Desktop Open endpoint must be exact loopback".to_string());
    }
    if parsed.port().is_none()
        || (parsed.path() != "/" && !parsed.path().is_empty())
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Desktop Open endpoint must be an origin only".to_string());
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn normalize_source_app(value: &str) -> Result<String, DesktopOpenIntentHostParseError> {
    let normalized = value.trim().to_ascii_lowercase();
    let app_id = normalized
        .strip_prefix(TAURI_IDENTIFIER_PREFIX)
        .unwrap_or(normalized.as_str());
    if app_id.len() > 96 || !is_valid_app_id(app_id) {
        return Err(invalid_parse("DesktopOpenIntent sourceApp is invalid"));
    }
    Ok(app_id.to_string())
}

fn validate_request_id(value: &str) -> Result<String, DesktopOpenIntentHostParseError> {
    let request_id = value.trim();
    let suffix = request_id.strip_prefix("desktop-open-").unwrap_or("");
    if request_id.len() > 128
        || !matches!(suffix.chars().next(), Some(character) if character.is_ascii_alphanumeric())
        || !suffix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
    {
        return Err(invalid_parse("DesktopOpenIntent requestId is invalid"));
    }
    Ok(request_id.to_string())
}

fn generate_request_id() -> String {
    let mut bytes = [0_u8; 18];
    OsRng.fill_bytes(&mut bytes);
    format!("desktop-open-{}", URL_SAFE_NO_PAD.encode(bytes))
}

fn is_valid_app_id(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment.chars().all(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
                })
                && segment.chars().next().is_some_and(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit()
                })
                && segment.chars().last().is_some_and(|character| {
                    character.is_ascii_lowercase() || character.is_ascii_digit()
                })
        })
}

fn parse_desktop_open_intent(value: Value) -> Result<Value, DesktopOpenIntentHostParseError> {
    let record = value
        .as_object()
        .ok_or_else(|| invalid_parse("DesktopOpenIntent intent must be an object"))?;
    let kind = required_string(record.get("kind"), "intent.kind")?;
    match kind.as_str() {
        "open-explore" => parse_explore_intent(record),
        "open-runtime-config" => parse_runtime_config_intent(record),
        "open-agents" => parse_agents_intent(record),
        "open-apps" => parse_apps_intent(record),
        "open-settings" => parse_settings_intent(record),
        "open-url" => Err(invalid_parse(
            "DesktopOpenIntent does not admit raw URL payloads",
        )),
        _ => Err(unsupported_parse(
            "DesktopOpenIntent target is not admitted",
        )),
    }
}

fn parse_explore_intent(
    record: &serde_json::Map<String, Value>,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    assert_allowed_fields(
        record,
        &["kind", "section", "productIntent", "query"],
        "explore intent",
    )?;
    let section = required_string(record.get("section"), "intent.section")?;
    if !matches!(section.as_str(), "worlds" | "personas" | "activity") {
        return Err(unsupported_parse(
            "DesktopOpenIntent explore section is not admitted",
        ));
    }
    let product_intent = optional_string(record.get("productIntent"), "intent.productIntent")?;
    if let Some(value) = &product_intent {
        let admitted = match section.as_str() {
            "worlds" => value == "discover-worlds",
            "personas" => value == "discover-personas" || value == "select-partner",
            "activity" => value == "view-activity",
            _ => false,
        };
        if !admitted {
            return Err(unsupported_parse(
                "DesktopOpenIntent explore productIntent is not admitted for section",
            ));
        }
    }
    let query = optional_string(record.get("query"), "intent.query")?;
    if query
        .as_ref()
        .is_some_and(|value| value.chars().count() > 160)
    {
        return Err(invalid_parse(
            "DesktopOpenIntent query must be 160 characters or fewer",
        ));
    }
    let mut output = json!({
        "kind": "open-explore",
        "section": section,
    });
    if let Some(value) = product_intent {
        output["productIntent"] = Value::String(value);
    }
    if let Some(value) = query {
        output["query"] = Value::String(value);
    }
    Ok(output)
}

fn parse_runtime_config_intent(
    record: &serde_json::Map<String, Value>,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    assert_allowed_fields(record, &["kind", "page", "action"], "runtime config intent")?;
    let page = required_string(record.get("page"), "intent.page")?;
    let action = required_string(record.get("action"), "intent.action")?;
    let admitted = (page == "cloud" && action == "add-connector")
        || (page == "models" && action == "install-model");
    if !admitted {
        return Err(unsupported_parse(
            "DesktopOpenIntent runtime config target is not admitted",
        ));
    }
    Ok(json!({
        "kind": "open-runtime-config",
        "page": page,
        "action": action,
    }))
}

fn parse_agents_intent(
    record: &serde_json::Map<String, Value>,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    assert_allowed_fields(record, &["kind", "view"], "agents intent")?;
    let view = required_string(record.get("view"), "intent.view")?;
    if view != "inventory" {
        return Err(unsupported_parse(
            "DesktopOpenIntent agents view is not admitted",
        ));
    }
    Ok(json!({
        "kind": "open-agents",
        "view": view,
    }))
}

fn parse_apps_intent(
    record: &serde_json::Map<String, Value>,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    assert_allowed_fields(record, &["kind", "appId"], "apps intent")?;
    let app_id = optional_string(record.get("appId"), "intent.appId")?;
    if let Some(value) = &app_id {
        if value.len() > 96 || !is_valid_app_id(value) {
            return Err(invalid_parse("DesktopOpenIntent appId is invalid"));
        }
    }
    let mut output = json!({ "kind": "open-apps" });
    if let Some(value) = app_id {
        output["appId"] = Value::String(value);
    }
    Ok(output)
}

fn parse_settings_intent(
    record: &serde_json::Map<String, Value>,
) -> Result<Value, DesktopOpenIntentHostParseError> {
    assert_allowed_fields(record, &["kind", "section"], "settings intent")?;
    let section = required_string(record.get("section"), "intent.section")?;
    if section != "profile" {
        return Err(unsupported_parse(
            "DesktopOpenIntent settings section is not admitted",
        ));
    }
    Ok(json!({
        "kind": "open-settings",
        "section": section,
    }))
}

fn project_bridge_result(
    raw: Value,
    expected_bridge_id: &str,
    expected_request_id: &str,
    expected_target: &str,
) -> Value {
    match parse_bridge_result(
        raw,
        expected_bridge_id,
        expected_request_id,
        expected_target,
    ) {
        Ok(value) => value,
        Err(reason) => rejected(reason, "fix_desktop_open_intent"),
    }
}

fn parse_bridge_result(
    raw: Value,
    expected_bridge_id: &str,
    expected_request_id: &str,
    expected_target: &str,
) -> Result<Value, &'static str> {
    let Some(record) = raw.as_object() else {
        return Err("desktop-open-intent-invalid");
    };
    if record
        .get("bridgeId")
        .and_then(Value::as_str)
        .map(str::trim)
        != Some(expected_bridge_id)
    {
        return Ok(rejected(
            "desktop-open-desktop-not-running",
            "open_desktop_first",
        ));
    }
    let status = required_result_string(record.get("status"))?;
    match status.as_str() {
        "accepted" => {
            assert_result_fields(
                record,
                &[
                    "status",
                    "confirmation",
                    "bridgeId",
                    "requestId",
                    "appliedTarget",
                ],
            )?;
            if record.get("confirmation").and_then(Value::as_str) != Some("desktop-accepted") {
                return Err("desktop-open-intent-invalid");
            }
            let request_id = validate_request_id(
                record
                    .get("requestId")
                    .and_then(Value::as_str)
                    .ok_or("desktop-open-intent-invalid")?,
            )
            .map_err(|_| "desktop-open-intent-invalid")?;
            if request_id != expected_request_id {
                return Err("desktop-open-intent-invalid");
            }
            let applied_target = required_result_string(record.get("appliedTarget"))?;
            if !matches!(
                applied_target.as_str(),
                "open-explore"
                    | "open-runtime-config"
                    | "open-agents"
                    | "open-apps"
                    | "open-settings"
            ) {
                return Err("desktop-open-intent-invalid");
            }
            if applied_target != expected_target {
                return Err("desktop-open-intent-invalid");
            }
            Ok(Value::Object(record.clone()))
        }
        "rejected" => {
            assert_result_fields(record, &["status", "bridgeId", "reasonCode", "actionHint"])?;
            let reason_code = required_result_string(record.get("reasonCode"))?;
            if !is_admitted_result_reason_code(&reason_code) {
                return Err("desktop-open-intent-invalid");
            }
            let action_hint = required_result_string(record.get("actionHint"))?;
            if !is_admitted_action_hint(&action_hint) {
                return Err("desktop-open-intent-invalid");
            }
            Ok(json!({
                "status": "rejected",
                "reasonCode": reason_code,
                "actionHint": action_hint,
            }))
        }
        _ => Err("desktop-open-intent-invalid"),
    }
}

fn assert_allowed_fields(
    record: &serde_json::Map<String, Value>,
    allowed: &[&str],
    label: &str,
) -> Result<(), DesktopOpenIntentHostParseError> {
    for field in record.keys() {
        if !allowed.contains(&field.as_str()) {
            return Err(invalid_parse(format!(
                "DesktopOpenIntent {label} contains unsupported field"
            )));
        }
    }
    Ok(())
}

fn required_string(
    value: Option<&Value>,
    field: &str,
) -> Result<String, DesktopOpenIntentHostParseError> {
    let Some(raw) = value.and_then(Value::as_str) else {
        return Err(invalid_parse(format!(
            "DesktopOpenIntent {field} must be a string"
        )));
    };
    let normalized = raw.trim();
    if normalized.is_empty() {
        return Err(invalid_parse(format!(
            "DesktopOpenIntent {field} is required"
        )));
    }
    Ok(normalized.to_string())
}

fn optional_string(
    value: Option<&Value>,
    field: &str,
) -> Result<Option<String>, DesktopOpenIntentHostParseError> {
    match value {
        Some(_) => Ok(Some(required_string(value, field)?)),
        None => Ok(None),
    }
}

fn invalid_parse(message: impl Into<String>) -> DesktopOpenIntentHostParseError {
    DesktopOpenIntentHostParseError {
        reason_code: "desktop-open-intent-invalid",
        message: message.into(),
    }
}

fn unsupported_parse(message: impl Into<String>) -> DesktopOpenIntentHostParseError {
    DesktopOpenIntentHostParseError {
        reason_code: "desktop-open-target-unsupported",
        message: message.into(),
    }
}

fn assert_result_fields(
    record: &serde_json::Map<String, Value>,
    allowed: &[&str],
) -> Result<(), &'static str> {
    for field in record.keys() {
        if !allowed.contains(&field.as_str()) {
            return Err("desktop-open-intent-invalid");
        }
    }
    Ok(())
}

fn required_result_string(value: Option<&Value>) -> Result<String, &'static str> {
    let Some(raw) = value.and_then(Value::as_str) else {
        return Err("desktop-open-intent-invalid");
    };
    let normalized = raw.trim();
    if normalized.is_empty() {
        return Err("desktop-open-intent-invalid");
    }
    Ok(normalized.to_string())
}

fn is_admitted_result_reason_code(value: &str) -> bool {
    matches!(
        value,
        "desktop-open-desktop-not-running"
            | "desktop-open-desktop-not-ready"
            | "desktop-open-intent-invalid"
            | "desktop-open-target-unsupported"
            | "desktop-open-bridge-auth-failed"
            | "desktop-open-host-unavailable"
    )
}

fn is_admitted_action_hint(value: &str) -> bool {
    matches!(
        value,
        "open_desktop_first"
            | "wait_for_desktop_ready"
            | "fix_desktop_open_intent"
            | "check_desktop_runtime_bridge"
    )
}

fn rejected(reason_code: &str, action_hint: &str) -> Value {
    json!({
        "status": "rejected",
        "reasonCode": reason_code,
        "actionHint": action_hint,
    })
}

#[cfg(test)]
mod tests {
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
        assert!(normalize_endpoint("http://user:pass@127.0.0.1:4500").is_err());
        assert!(normalize_endpoint("http://user:pass@[::1]:4500").is_err());
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

        assert!(compose_envelope_for_source(
            "nimi.bad-",
            json!({ "intent": { "kind": "open-apps" } }),
        )
        .is_err());
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
            let envelope = vector.envelope.as_object().unwrap_or_else(|| {
                panic!("{} accepted vector envelope must be an object", vector.id)
            });
            let payload = json!({
                "requestId": envelope.get("requestId").cloned().unwrap_or_else(|| {
                    panic!("{} accepted vector missing requestId", vector.id)
                }),
                "intent": envelope.get("intent").cloned().unwrap_or_else(|| {
                    panic!("{} accepted vector missing intent", vector.id)
                }),
            });
            let parsed = compose_envelope_for_source("ai.nimi.apps.nimi.tauri", payload)
                .unwrap_or_else(|error| {
                    panic!("{} should parse but failed: {:?}", vector.id, error)
                });
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

    fn read_golden_vectors() -> GoldenVectorTable {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../../.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml",
        );
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
            "agent-center-target-v1" => (
                "nimi.tauri",
                json!({ "intent": { "kind": "open-agents", "view": "agent-center" } }),
            ),
            "agent-center-local-agent-ref-v1" => (
                "nimi.tauri",
                json!({ "intent": { "kind": "open-agents", "view": "agent-center", "localAgentRef": "agent-local-1" } }),
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
}
