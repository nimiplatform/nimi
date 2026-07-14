use super::{DesktopOpenIntentEnvelope, DesktopOpenIntentError, DesktopOpenIntentTarget};
use serde_json::{Map, Value};
use std::collections::BTreeSet;
pub(crate) fn parse_desktop_open_intent_envelope(
    value: Value,
) -> Result<DesktopOpenIntentEnvelope, DesktopOpenIntentError> {
    let record = object(value, "DesktopOpenIntent envelope")?;
    assert_fields(
        &record,
        &[
            "schemaVersion",
            "sourceApp",
            "sourceHost",
            "requestId",
            "intent",
        ],
        "DesktopOpenIntent envelope",
    )?;
    if record.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err(invalid(
            "schemaVersion",
            "DesktopOpenIntent envelope schemaVersion must be 1",
        ));
    }
    let source_app = parse_app_id(record.get("sourceApp"), "sourceApp")?;
    let source_host = required_string(record.get("sourceHost"), "sourceHost")?;
    if !matches!(
        source_host.as_str(),
        "electron-standard-shell"
            | "tauri-standard-shell"
            | "desktop-electron-local-app-host"
            | "dev-fixture"
    ) {
        return Err(invalid(
            "sourceHost",
            "DesktopOpenIntent sourceHost is not admitted",
        ));
    }
    let request_id = parse_request_id(record.get("requestId"), "requestId")?;
    let intent = parse_desktop_open_intent_target(
        record
            .get("intent")
            .cloned()
            .ok_or_else(|| invalid("intent", "DesktopOpenIntent intent is required"))?,
    )?;
    Ok(DesktopOpenIntentEnvelope {
        schema_version: 1,
        source_app,
        source_host,
        request_id,
        intent,
    })
}

fn parse_desktop_open_intent_target(
    value: Value,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    let record = object(value, "DesktopOpenIntent intent")?;
    let kind = required_string(record.get("kind"), "intent.kind")?;
    match kind.as_str() {
        "open-explore" => parse_explore_target(record),
        "open-runtime-config" => parse_runtime_config_target(record),
        "open-agents" => parse_agents_target(record),
        "open-apps" => parse_apps_target(record),
        "open-settings" => parse_settings_target(record),
        "open-url" => Err(invalid(
            "intent.kind",
            "DesktopOpenIntent does not admit raw URL payloads",
        )),
        _ => Err(unsupported(
            "intent.kind",
            "DesktopOpenIntent target is not admitted",
        )),
    }
}

fn parse_explore_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "section", "productIntent", "query"],
        "DesktopOpenIntent explore intent",
    )?;
    let section = required_string(record.get("section"), "intent.section")?;
    if !matches!(section.as_str(), "worlds" | "personas" | "activity") {
        return Err(unsupported(
            "intent.section",
            "DesktopOpenIntent explore section is not admitted",
        ));
    }
    let product_intent = optional_string(record.get("productIntent"), "intent.productIntent")?;
    if let Some(product_intent_value) = &product_intent {
        let admitted = match section.as_str() {
            "worlds" => product_intent_value == "discover-worlds",
            "personas" => {
                product_intent_value == "discover-personas"
                    || product_intent_value == "select-partner"
            }
            "activity" => product_intent_value == "view-activity",
            _ => false,
        };
        if !admitted {
            return Err(unsupported(
                "intent.productIntent",
                "DesktopOpenIntent explore productIntent is not admitted for section",
            ));
        }
    }
    let query = optional_string(record.get("query"), "intent.query")?;
    if query
        .as_ref()
        .is_some_and(|value| value.chars().count() > 160)
    {
        return Err(invalid(
            "intent.query",
            "DesktopOpenIntent query must be 160 characters or fewer",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-explore".to_string(),
        section: Some(section),
        product_intent,
        query,
        page: None,
        action: None,
        view: None,
        app_id: None,
    })
}

fn parse_runtime_config_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "page", "action"],
        "DesktopOpenIntent runtime config intent",
    )?;
    let page = required_string(record.get("page"), "intent.page")?;
    let action = required_string(record.get("action"), "intent.action")?;
    let admitted = (page == "cloud" && action == "add-connector")
        || (page == "models" && action == "install-model");
    if !admitted {
        return Err(unsupported(
            "intent.action",
            "DesktopOpenIntent runtime config target is not admitted",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-runtime-config".to_string(),
        section: None,
        product_intent: None,
        query: None,
        page: Some(page),
        action: Some(action),
        view: None,
        app_id: None,
    })
}

fn parse_agents_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "view"],
        "DesktopOpenIntent agents intent",
    )?;
    let view = required_string(record.get("view"), "intent.view")?;
    if view != "inventory" {
        return Err(unsupported(
            "intent.view",
            "DesktopOpenIntent agents view is not admitted",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-agents".to_string(),
        section: None,
        product_intent: None,
        query: None,
        page: None,
        action: None,
        view: Some(view),
        app_id: None,
    })
}

fn parse_apps_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(&record, &["kind", "appId"], "DesktopOpenIntent apps intent")?;
    let app_id = match record.get("appId") {
        Some(value) => Some(parse_app_id(Some(value), "intent.appId")?),
        None => None,
    };
    Ok(DesktopOpenIntentTarget {
        kind: "open-apps".to_string(),
        section: None,
        product_intent: None,
        query: None,
        page: None,
        action: None,
        view: None,
        app_id,
    })
}

fn parse_settings_target(
    record: Map<String, Value>,
) -> Result<DesktopOpenIntentTarget, DesktopOpenIntentError> {
    assert_fields(
        &record,
        &["kind", "section"],
        "DesktopOpenIntent settings intent",
    )?;
    let section = required_string(record.get("section"), "intent.section")?;
    if section != "profile" {
        return Err(unsupported(
            "intent.section",
            "DesktopOpenIntent settings section is not admitted",
        ));
    }
    Ok(DesktopOpenIntentTarget {
        kind: "open-settings".to_string(),
        section: Some(section),
        product_intent: None,
        query: None,
        page: None,
        action: None,
        view: None,
        app_id: None,
    })
}

fn object(value: Value, label: &str) -> Result<Map<String, Value>, DesktopOpenIntentError> {
    match value {
        Value::Object(record) => Ok(record),
        _ => Err(invalid("", &format!("{label} must be an object"))),
    }
}

fn assert_fields(
    record: &Map<String, Value>,
    fields: &[&str],
    label: &str,
) -> Result<(), DesktopOpenIntentError> {
    let allowed: BTreeSet<&str> = fields.iter().copied().collect();
    for field in record.keys() {
        if !allowed.contains(field.as_str()) {
            return Err(invalid(
                field,
                &format!("{label} contains unsupported field"),
            ));
        }
    }
    Ok(())
}

fn optional_string(
    value: Option<&Value>,
    field: &str,
) -> Result<Option<String>, DesktopOpenIntentError> {
    value
        .map(|inner| required_string(Some(inner), field))
        .transpose()
}

fn required_string(value: Option<&Value>, field: &str) -> Result<String, DesktopOpenIntentError> {
    let Some(Value::String(value)) = value else {
        return Err(invalid(field, "DesktopOpenIntent field must be a string"));
    };
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(invalid(field, "DesktopOpenIntent field is required"));
    }
    Ok(normalized.to_string())
}

fn parse_app_id(value: Option<&Value>, field: &str) -> Result<String, DesktopOpenIntentError> {
    let app_id = required_string(value, field)?;
    if app_id.len() > 96 || !is_valid_app_id(&app_id) {
        return Err(invalid(field, "DesktopOpenIntent app id is invalid"));
    }
    Ok(app_id)
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

fn parse_request_id(value: Option<&Value>, field: &str) -> Result<String, DesktopOpenIntentError> {
    let request_id = required_string(value, field)?;
    let suffix = request_id.strip_prefix("desktop-open-").unwrap_or("");
    if request_id.len() > 128
        || !matches!(suffix.chars().next(), Some(character) if character.is_ascii_alphanumeric())
        || !suffix.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | ':' | '-')
        })
    {
        return Err(invalid(field, "DesktopOpenIntent requestId is invalid"));
    }
    Ok(request_id)
}

fn invalid(field: &str, message: &str) -> DesktopOpenIntentError {
    DesktopOpenIntentError {
        reason_code: "desktop-open-intent-invalid".to_string(),
        field: (!field.is_empty()).then(|| field.to_string()),
        message: message.to_string(),
    }
}

fn unsupported(field: &str, message: &str) -> DesktopOpenIntentError {
    DesktopOpenIntentError {
        reason_code: "desktop-open-target-unsupported".to_string(),
        field: (!field.is_empty()).then(|| field.to_string()),
        message: message.to_string(),
    }
}
