use std::collections::BTreeMap;

use prost_types::{
    value::Kind as ProtoValueKind, ListValue, Struct as ProtoStruct, Value as ProtoValue,
};
use serde_json::{json, Map, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::{
    ai_config_capability_intent, ai_config_owner,
    runtime_ai_service_client::RuntimeAiServiceClient, AiConfig, AiConfigCapabilityIntent,
    AiConfigCloudIntent, AiConfigLocalIntent, CapabilityImplementationIdentity,
    GetAppAiConfigRequest, OverwriteAppAiConfigRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{LocalAppAIConfigOverwriteRequest, LocalAppOperationError, LocalAppReasonCode};

const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;

pub async fn get(channel: Channel) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAiServiceClient::new(channel)
        .get_app_ai_config(GetAppAiConfigRequest { owner: None })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_config(response.config.ok_or_else(untrusted)?)
}

pub async fn overwrite(
    channel: Channel,
    request: LocalAppAIConfigOverwriteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let capabilities = parse_capabilities(request.capabilities)?;
    let response = RuntimeAiServiceClient::new(channel)
        .overwrite_app_ai_config(OverwriteAppAiConfigRequest {
            config: Some(AiConfig {
                owner: None,
                capabilities,
            }),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_config(response.config.ok_or_else(untrusted)?)
}

pub(super) fn parse_capabilities(
    value: JsonValue,
) -> Result<Vec<AiConfigCapabilityIntent>, LocalAppOperationError> {
    let entries = value.as_array().ok_or_else(invalid_payload)?;
    let mut budget = 0usize;
    entries
        .iter()
        .map(|entry| parse_capability(entry, &mut budget))
        .collect()
}

fn parse_capability(
    value: &JsonValue,
    budget: &mut usize,
) -> Result<AiConfigCapabilityIntent, LocalAppOperationError> {
    count_node(budget, 0)?;
    let object = exact_object(
        value,
        &[
            "capabilityContract",
            "requiredFeatures",
            "defaults",
            "route",
        ],
        &["capabilityContract", "requiredFeatures", "route"],
    )?;
    let capability_contract = required_text(object.get("capabilityContract"))?;
    let required_features = object
        .get("requiredFeatures")
        .and_then(JsonValue::as_array)
        .ok_or_else(invalid_payload)?
        .iter()
        .map(|feature| required_text(Some(feature)))
        .collect::<Result<Vec<_>, _>>()?;
    let defaults = object
        .get("defaults")
        .map(|value| parse_proto_struct(value, budget, 1))
        .transpose()?;
    let route = parse_route(object.get("route").ok_or_else(invalid_payload)?, budget)?;
    Ok(AiConfigCapabilityIntent {
        capability_contract,
        required_features,
        defaults,
        route: Some(route),
    })
}

fn parse_route(
    value: &JsonValue,
    budget: &mut usize,
) -> Result<ai_config_capability_intent::Route, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    match object.get("oneofKind").and_then(JsonValue::as_str) {
        Some("local") => {
            exact_keys(object, &["oneofKind", "local"], &["oneofKind", "local"])?;
            let local = exact_object(object.get("local").ok_or_else(invalid_payload)?, &[], &[])?;
            if !local.is_empty() {
                return Err(invalid_payload());
            }
            Ok(ai_config_capability_intent::Route::Local(
                AiConfigLocalIntent {},
            ))
        }
        Some("cloud") => {
            exact_keys(object, &["oneofKind", "cloud"], &["oneofKind", "cloud"])?;
            let cloud = exact_object(
                object.get("cloud").ok_or_else(invalid_payload)?,
                &["implementation", "providerModelTarget", "connectorGrantId"],
                &["implementation", "connectorGrantId"],
            )?;
            let implementation =
                parse_implementation(cloud.get("implementation").ok_or_else(invalid_payload)?)?;
            let provider_model_target = cloud
                .get("providerModelTarget")
                .map(|value| parse_proto_struct(value, budget, 1))
                .transpose()?;
            let connector_grant_id = canonical_optional_text(cloud.get("connectorGrantId"))?;
            Ok(ai_config_capability_intent::Route::Cloud(
                AiConfigCloudIntent {
                    implementation: Some(implementation),
                    provider_model_target,
                    connector_grant_id,
                },
            ))
        }
        _ => Err(invalid_payload()),
    }
}

fn parse_implementation(
    value: &JsonValue,
) -> Result<CapabilityImplementationIdentity, LocalAppOperationError> {
    let object = exact_object(
        value,
        &["implementationId", "driverId", "driverDialect"],
        &["implementationId", "driverId", "driverDialect"],
    )?;
    Ok(CapabilityImplementationIdentity {
        implementation_id: required_text(object.get("implementationId"))?,
        driver_id: required_text(object.get("driverId"))?,
        driver_dialect: required_text(object.get("driverDialect"))?,
    })
}

fn parse_proto_struct(
    value: &JsonValue,
    budget: &mut usize,
    depth: usize,
) -> Result<ProtoStruct, LocalAppOperationError> {
    count_node(budget, depth)?;
    let object = exact_object(value, &["fields"], &["fields"])?;
    let fields = object
        .get("fields")
        .and_then(JsonValue::as_object)
        .ok_or_else(invalid_payload)?;
    let mut projected = BTreeMap::new();
    for (key, entry) in fields {
        projected.insert(key.clone(), parse_proto_value(entry, budget, depth + 1)?);
    }
    Ok(ProtoStruct { fields: projected })
}

fn parse_proto_value(
    value: &JsonValue,
    budget: &mut usize,
    depth: usize,
) -> Result<ProtoValue, LocalAppOperationError> {
    count_node(budget, depth)?;
    let object = exact_object(value, &["kind"], &["kind"])?;
    let kind = object
        .get("kind")
        .and_then(JsonValue::as_object)
        .ok_or_else(invalid_payload)?;
    let oneof = kind
        .get("oneofKind")
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    let value_kind = match oneof {
        "nullValue" => {
            exact_keys(
                kind,
                &["oneofKind", "nullValue"],
                &["oneofKind", "nullValue"],
            )?;
            if kind.get("nullValue").and_then(JsonValue::as_i64) != Some(0) {
                return Err(invalid_payload());
            }
            ProtoValueKind::NullValue(0)
        }
        "numberValue" => {
            exact_keys(
                kind,
                &["oneofKind", "numberValue"],
                &["oneofKind", "numberValue"],
            )?;
            ProtoValueKind::NumberValue(
                kind.get("numberValue")
                    .and_then(JsonValue::as_f64)
                    .filter(|value| value.is_finite())
                    .ok_or_else(invalid_payload)?,
            )
        }
        "stringValue" => {
            exact_keys(
                kind,
                &["oneofKind", "stringValue"],
                &["oneofKind", "stringValue"],
            )?;
            ProtoValueKind::StringValue(
                kind.get("stringValue")
                    .and_then(JsonValue::as_str)
                    .ok_or_else(invalid_payload)?
                    .to_string(),
            )
        }
        "boolValue" => {
            exact_keys(
                kind,
                &["oneofKind", "boolValue"],
                &["oneofKind", "boolValue"],
            )?;
            ProtoValueKind::BoolValue(
                kind.get("boolValue")
                    .and_then(JsonValue::as_bool)
                    .ok_or_else(invalid_payload)?,
            )
        }
        "structValue" => {
            exact_keys(
                kind,
                &["oneofKind", "structValue"],
                &["oneofKind", "structValue"],
            )?;
            ProtoValueKind::StructValue(parse_proto_struct(
                kind.get("structValue").ok_or_else(invalid_payload)?,
                budget,
                depth + 1,
            )?)
        }
        "listValue" => {
            exact_keys(
                kind,
                &["oneofKind", "listValue"],
                &["oneofKind", "listValue"],
            )?;
            let list = exact_object(
                kind.get("listValue").ok_or_else(invalid_payload)?,
                &["values"],
                &["values"],
            )?;
            let values = list
                .get("values")
                .and_then(JsonValue::as_array)
                .ok_or_else(invalid_payload)?
                .iter()
                .map(|entry| parse_proto_value(entry, budget, depth + 1))
                .collect::<Result<Vec<_>, _>>()?;
            ProtoValueKind::ListValue(ListValue { values })
        }
        _ => return Err(invalid_payload()),
    };
    Ok(ProtoValue {
        kind: Some(value_kind),
    })
}

fn project_config(config: AiConfig) -> Result<JsonValue, LocalAppOperationError> {
    let app_id = match config.owner.and_then(|owner| owner.owner) {
        Some(ai_config_owner::Owner::App(app)) if !app.app_id.trim().is_empty() => app.app_id,
        _ => return Err(untrusted()),
    };
    let capabilities = config
        .capabilities
        .into_iter()
        .map(project_capability)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "owner": {
            "owner": {
                "oneofKind": "app",
                "app": { "appId": app_id },
            },
        },
        "capabilities": capabilities,
    }))
}

pub(super) fn project_capability(
    intent: AiConfigCapabilityIntent,
) -> Result<JsonValue, LocalAppOperationError> {
    if intent.capability_contract.trim().is_empty()
        || intent
            .required_features
            .iter()
            .any(|feature| feature.trim().is_empty())
    {
        return Err(untrusted());
    }
    let route = match intent.route.ok_or_else(untrusted)? {
        ai_config_capability_intent::Route::Local(_) => {
            json!({ "oneofKind": "local", "local": {} })
        }
        ai_config_capability_intent::Route::Cloud(cloud) => {
            let implementation = cloud.implementation.ok_or_else(untrusted)?;
            if implementation.implementation_id.trim().is_empty()
                || implementation.driver_id.trim().is_empty()
                || implementation.driver_dialect.trim().is_empty()
            {
                return Err(untrusted());
            }
            let mut projected = Map::from_iter([
                (
                    "implementation".to_string(),
                    json!({
                        "implementationId": implementation.implementation_id,
                        "driverId": implementation.driver_id,
                        "driverDialect": implementation.driver_dialect,
                    }),
                ),
                (
                    "connectorGrantId".to_string(),
                    JsonValue::String(cloud.connector_grant_id),
                ),
            ]);
            if let Some(target) = cloud.provider_model_target {
                projected.insert(
                    "providerModelTarget".to_string(),
                    project_proto_struct(target)?,
                );
            }
            json!({ "oneofKind": "cloud", "cloud": projected })
        }
    };
    let mut projected = Map::from_iter([
        (
            "capabilityContract".to_string(),
            JsonValue::String(intent.capability_contract),
        ),
        (
            "requiredFeatures".to_string(),
            JsonValue::Array(
                intent
                    .required_features
                    .into_iter()
                    .map(JsonValue::String)
                    .collect(),
            ),
        ),
        ("route".to_string(), route),
    ]);
    if let Some(defaults) = intent.defaults {
        projected.insert("defaults".to_string(), project_proto_struct(defaults)?);
    }
    Ok(JsonValue::Object(projected))
}

fn project_proto_struct(value: ProtoStruct) -> Result<JsonValue, LocalAppOperationError> {
    let fields = value
        .fields
        .into_iter()
        .map(|(key, value)| Ok((key, project_proto_value(value)?)))
        .collect::<Result<Map<_, _>, LocalAppOperationError>>()?;
    Ok(json!({ "fields": fields }))
}

fn project_proto_value(value: ProtoValue) -> Result<JsonValue, LocalAppOperationError> {
    let kind = match value.kind.ok_or_else(untrusted)? {
        ProtoValueKind::NullValue(0) => json!({ "oneofKind": "nullValue", "nullValue": 0 }),
        ProtoValueKind::NullValue(_) => return Err(untrusted()),
        ProtoValueKind::NumberValue(value) if value.is_finite() => {
            json!({ "oneofKind": "numberValue", "numberValue": value })
        }
        ProtoValueKind::NumberValue(_) => return Err(untrusted()),
        ProtoValueKind::StringValue(value) => {
            json!({ "oneofKind": "stringValue", "stringValue": value })
        }
        ProtoValueKind::BoolValue(value) => {
            json!({ "oneofKind": "boolValue", "boolValue": value })
        }
        ProtoValueKind::StructValue(value) => {
            json!({ "oneofKind": "structValue", "structValue": project_proto_struct(value)? })
        }
        ProtoValueKind::ListValue(value) => {
            let values = value
                .values
                .into_iter()
                .map(project_proto_value)
                .collect::<Result<Vec<_>, _>>()?;
            json!({ "oneofKind": "listValue", "listValue": { "values": values } })
        }
    };
    Ok(json!({ "kind": kind }))
}

fn exact_object<'a>(
    value: &'a JsonValue,
    allowed: &[&str],
    required: &[&str],
) -> Result<&'a Map<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    exact_keys(object, allowed, required)?;
    Ok(object)
}

fn exact_keys(
    object: &Map<String, JsonValue>,
    allowed: &[&str],
    required: &[&str],
) -> Result<(), LocalAppOperationError> {
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || required.iter().any(|key| !object.contains_key(*key))
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn required_text(value: Option<&JsonValue>) -> Result<String, LocalAppOperationError> {
    let value = value
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    if value.is_empty() || value.trim() != value {
        return Err(invalid_payload());
    }
    Ok(value.to_string())
}

fn canonical_optional_text(value: Option<&JsonValue>) -> Result<String, LocalAppOperationError> {
    let value = value
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    if value.trim() != value {
        return Err(invalid_payload());
    }
    Ok(value.to_string())
}

fn count_node(budget: &mut usize, depth: usize) -> Result<(), LocalAppOperationError> {
    *budget = budget.saturating_add(1);
    if depth > MAX_JSON_DEPTH || *budget > MAX_JSON_NODES {
        return Err(invalid_payload());
    }
    Ok(())
}

fn invalid_payload() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false)
}

fn untrusted() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::{AiConfigAppOwner, AiConfigOwner};

    #[test]
    fn capability_round_trip_preserves_local_and_cloud_intent_without_owner_input() {
        let source = json!([
            {
                "capabilityContract": "text.generate",
                "requiredFeatures": ["input.image"],
                "defaults": {
                    "fields": {
                        "temperature": {
                            "kind": { "oneofKind": "numberValue", "numberValue": 0.7 }
                        }
                    }
                },
                "route": { "oneofKind": "local", "local": {} }
            },
            {
                "capabilityContract": "image.generate",
                "requiredFeatures": [],
                "route": {
                    "oneofKind": "cloud",
                    "cloud": {
                        "implementation": {
                            "implementationId": "dashscope.image",
                            "driverId": "dashscope",
                            "driverDialect": "v1"
                        },
                        "providerModelTarget": {
                            "fields": {
                                "model": {
                                    "kind": { "oneofKind": "stringValue", "stringValue": "wanx-v1" }
                                }
                            }
                        },
                        "connectorGrantId": "grant-1"
                    }
                }
            }
        ]);
        let capabilities = parse_capabilities(source.clone()).unwrap();
        let projected = project_config(AiConfig {
            owner: Some(AiConfigOwner {
                owner: Some(ai_config_owner::Owner::App(AiConfigAppOwner {
                    app_id: "app.example".to_string(),
                })),
            }),
            capabilities,
        })
        .unwrap();
        assert_eq!(projected["capabilities"], source);
        assert_eq!(projected["owner"]["owner"]["app"]["appId"], "app.example");
    }

    #[test]
    fn capability_input_rejects_owner_injection() {
        let error = parse_capabilities(json!([{
            "capabilityContract": "text.generate",
            "requiredFeatures": [],
            "route": { "oneofKind": "local", "local": {} },
            "owner": { "appId": "forged" }
        }]))
        .unwrap_err();
        assert_eq!(error.reason_code(), LocalAppReasonCode::InvalidPayload);
    }
}
