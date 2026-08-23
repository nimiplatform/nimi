use std::collections::BTreeMap;

use prost_types::{
    value::Kind as ProtoValueKind, ListValue, Struct as ProtoStruct, Value as ProtoValue,
};
use serde_json::{json, Map, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::{
    ai_config_capability_intent, ai_config_effective_selection, ai_config_owner,
    list_app_ai_config_options_request, list_app_ai_config_options_response,
    runtime_ai_service_client::RuntimeAiServiceClient, AiConfig, AiConfigCapabilityIntent,
    AiConfigCloudConnectorOptionsQuery, AiConfigCloudConnectorProjection, AiConfigCloudIntent,
    AiConfigCloudTargetOptionsQuery, AiConfigCloudTargetProjection, AiConfigEffectiveSelection,
    AiConfigEffectiveState, AiConfigLocalIntent, AiConfigLocalLoadoutOptionsQuery,
    AiConfigLocalResourceProjection, CapabilityImplementationIdentity, GetAppAiConfigRequest,
    ListAppAiConfigOptionsRequest, OverwriteAppAiConfigRequest, ReasonCode,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAIConfigLocalOptionsRequest, LocalAppAIConfigOverwriteRequest, LocalAppOperationError,
    LocalAppReasonCode,
};

const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;

pub async fn get(channel: Channel) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAiServiceClient::new(channel)
        .get_app_ai_config(GetAppAiConfigRequest { owner: None })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.revision.trim().is_empty() {
        return Err(untrusted());
    }
    let config = response.config.map(project_config).transpose()?;
    let effective = response
        .effective_selections
        .into_iter()
        .map(project_effective_selection)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "config": config,
        "revision": response.revision,
        "effectiveSelections": effective,
    }))
}

pub async fn overwrite(
    channel: Channel,
    request: LocalAppAIConfigOverwriteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let expected_revision = required_text_value(&request.expected_revision)?;
    let capabilities = parse_capabilities(request.capabilities)?;
    let response = RuntimeAiServiceClient::new(channel)
        .overwrite_app_ai_config(OverwriteAppAiConfigRequest {
            config: Some(AiConfig {
                owner: None,
                capabilities,
            }),
            expected_revision,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.revision.trim().is_empty() {
        return Err(untrusted());
    }
    let config = response.config.map(project_config).transpose()?;
    let reason = ReasonCode::try_from(response.reason_code).map_err(|_| untrusted())?;
    if response.committed && reason != ReasonCode::Unspecified {
        return Err(untrusted());
    }
    if !response.committed && reason != ReasonCode::AiConfigRevisionConflict {
        return Err(untrusted());
    }
    Ok(json!({
        "outcome": if response.committed { "committed" } else { "conflict" },
        "config": config,
        "revision": response.revision,
        "reasonCode": reason.as_str_name(),
    }))
}

pub async fn list_local_options(
    channel: Channel,
    request: LocalAppAIConfigLocalOptionsRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let query = match request.kind.as_str() {
        "local-loadouts" => list_app_ai_config_options_request::Query::LocalLoadouts(
            AiConfigLocalLoadoutOptionsQuery {
                capability_contract: required_text_value(&request.capability_contract)?,
                search: request.search,
            },
        ),
        "cloud-connectors" => list_app_ai_config_options_request::Query::CloudConnectors(
            AiConfigCloudConnectorOptionsQuery {
                capability_contract: required_text_value(&request.capability_contract)?,
                search: request.search,
            },
        ),
        "cloud-targets" => list_app_ai_config_options_request::Query::CloudTargets(
            AiConfigCloudTargetOptionsQuery {
                capability_contract: required_text_value(&request.capability_contract)?,
                connector_ref: required_text_value(&request.connector_ref)?,
                search: request.search,
            },
        ),
        _ => return Err(invalid_payload()),
    };
    let response = RuntimeAiServiceClient::new(channel)
        .list_app_ai_config_options(ListAppAiConfigOptionsRequest {
            query: Some(query),
            owner: None,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (kind, options) = match response.result.ok_or_else(untrusted)? {
        list_app_ai_config_options_response::Result::LocalLoadouts(value)
            if request.kind == "local-loadouts" =>
        {
            (
                "local-loadouts",
                value
                    .options
                    .into_iter()
                    .map(project_local_resource)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        list_app_ai_config_options_response::Result::CloudConnectors(value)
            if request.kind == "cloud-connectors" =>
        {
            (
                "cloud-connectors",
                value
                    .options
                    .into_iter()
                    .map(project_cloud_connector)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        list_app_ai_config_options_response::Result::CloudTargets(value)
            if request.kind == "cloud-targets" =>
        {
            (
                "cloud-targets",
                value
                    .options
                    .into_iter()
                    .map(project_cloud_target)
                    .collect::<Result<Vec<_>, _>>()?,
            )
        }
        _ => return Err(untrusted()),
    };
    Ok(json!({ "kind": kind, "options": options, "truncated": response.truncated }))
}

pub(super) fn project_effective_selection(
    selection: AiConfigEffectiveSelection,
) -> Result<JsonValue, LocalAppOperationError> {
    let capability_contract = required_text_value(&selection.capability_contract)?;
    let state = project_effective_state(selection.state)?;
    let resource = match selection.resource {
        Some(ai_config_effective_selection::Resource::Local(local)) => json!({
            "oneofKind": "local",
            "local": project_local_resource(local)?,
        }),
        Some(ai_config_effective_selection::Resource::Cloud(cloud)) => json!({
            "oneofKind": "cloud",
            "cloud": {
                "connector": project_cloud_connector(cloud.connector.ok_or_else(untrusted)?)?,
                "target": project_cloud_target(cloud.target.ok_or_else(untrusted)?)?,
            },
        }),
        None => JsonValue::Null,
    };
    Ok(json!({
        "capabilityContract": capability_contract,
        "state": state,
        "resource": resource,
        "reasons": selection.reasons,
    }))
}

pub(super) fn project_cloud_connector(
    resource: AiConfigCloudConnectorProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "connectorRef": required_text_value(&resource.connector_ref)?,
        "label": required_text_value(&resource.label)?,
        "provider": required_text_value(&resource.provider)?,
        "state": project_effective_state(resource.state)?,
        "reasons": resource.reasons,
    }))
}

pub(super) fn project_cloud_target(
    resource: AiConfigCloudTargetProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "connectorRef": required_text_value(&resource.connector_ref)?,
        "label": required_text_value(&resource.label)?,
        "capabilityContract": required_text_value(&resource.capability_contract)?,
        "implementation": project_implementation(resource.implementation.ok_or_else(untrusted)?)?,
        "providerModelTarget": project_proto_struct(resource.provider_model_target.ok_or_else(untrusted)?)?,
        "supportedFeatures": resource.supported_features,
        "state": project_effective_state(resource.state)?,
        "reasons": resource.reasons,
    }))
}

pub(super) fn project_local_resource(
    resource: AiConfigLocalResourceProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    let implementation = resource
        .implementation
        .map(project_implementation)
        .transpose()?
        .unwrap_or(JsonValue::Null);
    Ok(json!({
        "loadoutRef": required_text_value(&resource.loadout_ref)?,
        "label": required_text_value(&resource.label)?,
        "capabilityContract": required_text_value(&resource.capability_contract)?,
        "implementation": implementation,
        "supportedFeatures": resource.supported_features,
        "state": project_effective_state(resource.state)?,
        "reasons": resource.reasons,
    }))
}

fn project_implementation(
    implementation: CapabilityImplementationIdentity,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "implementationId": required_text_value(&implementation.implementation_id)?,
        "driverId": required_text_value(&implementation.driver_id)?,
        "driverDialect": required_text_value(&implementation.driver_dialect)?,
    }))
}

fn project_effective_state(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match AiConfigEffectiveState::try_from(value).map_err(|_| untrusted())? {
        AiConfigEffectiveState::Ready => Ok("ready"),
        AiConfigEffectiveState::Missing => Ok("missing"),
        AiConfigEffectiveState::Blocked => Ok("blocked"),
        AiConfigEffectiveState::Unavailable => Ok("unavailable"),
        AiConfigEffectiveState::Unspecified => Err(untrusted()),
    }
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
            let local = exact_object(
                object.get("local").ok_or_else(invalid_payload)?,
                &["loadoutRef"],
                &["loadoutRef"],
            )?;
            Ok(ai_config_capability_intent::Route::Local(
                AiConfigLocalIntent {
                    loadout_ref: required_text(local.get("loadoutRef"))?,
                },
            ))
        }
        Some("cloud") => {
            exact_keys(object, &["oneofKind", "cloud"], &["oneofKind", "cloud"])?;
            let cloud = exact_object(
                object.get("cloud").ok_or_else(invalid_payload)?,
                &["connectorRef", "implementation", "providerModelTarget"],
                &["connectorRef", "implementation"],
            )?;
            let implementation =
                parse_implementation(cloud.get("implementation").ok_or_else(invalid_payload)?)?;
            let provider_model_target = cloud
                .get("providerModelTarget")
                .map(|value| parse_proto_struct(value, budget, 1))
                .transpose()?;
            Ok(ai_config_capability_intent::Route::Cloud(
                AiConfigCloudIntent {
                    implementation: Some(implementation),
                    provider_model_target,
                    connector_ref: required_text(cloud.get("connectorRef"))?,
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
        ai_config_capability_intent::Route::Local(local) => {
            json!({
                "oneofKind": "local",
                "local": { "loadoutRef": required_text_value(&local.loadout_ref)? },
            })
        }
        ai_config_capability_intent::Route::Cloud(cloud) => {
            let implementation = cloud.implementation.ok_or_else(untrusted)?;
            if implementation.implementation_id.trim().is_empty()
                || implementation.driver_id.trim().is_empty()
                || implementation.driver_dialect.trim().is_empty()
            {
                return Err(untrusted());
            }
            let mut projected = Map::from_iter([(
                "implementation".to_string(),
                json!({
                    "implementationId": implementation.implementation_id,
                    "driverId": implementation.driver_id,
                    "driverDialect": implementation.driver_dialect,
                }),
            )]);
            projected.insert(
                "connectorRef".to_string(),
                JsonValue::String(required_text_value(&cloud.connector_ref)?),
            );
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

pub(super) fn required_text_value(value: &str) -> Result<String, LocalAppOperationError> {
    if value.is_empty() || value.trim() != value {
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
                "route": {
                    "oneofKind": "local",
                    "local": { "loadoutRef": "loadout-text" }
                }
            },
            {
                "capabilityContract": "image.generate",
                "requiredFeatures": [],
                "route": {
                    "oneofKind": "cloud",
                    "cloud": {
                        "connectorRef": "connector-dashscope",
                        "implementation": {
                            "implementationId": "dashscope.image",
                            "driverId": "dashscope",
                            "driverDialect": "v1"
                        },
                        "providerModelTarget": {
                            "fields": {
                                "provider": { "kind": { "oneofKind": "stringValue", "stringValue": "dashscope" } },
                                "providerModelId": { "kind": { "oneofKind": "stringValue", "stringValue": "wanx-v1" } },
                                "remoteModelCatalogId": { "kind": { "oneofKind": "stringValue", "stringValue": "catalog-wanx-v1" } }
                            }
                        },
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
    fn local_loadout_option_projects_the_exact_safe_reference() {
        let projected = project_local_resource(AiConfigLocalResourceProjection {
            loadout_ref: "loadout-text".to_string(),
            label: "Gemma 4".to_string(),
            capability_contract: "text.generate".to_string(),
            implementation: Some(CapabilityImplementationIdentity {
                implementation_id: "gemma4".to_string(),
                driver_id: "nimi.local".to_string(),
                driver_dialect: "mlx".to_string(),
            }),
            supported_features: vec!["input.image".to_string()],
            state: AiConfigEffectiveState::Ready as i32,
            reasons: vec![],
        })
        .unwrap();
        assert_eq!(projected["loadoutRef"], "loadout-text");
        assert_eq!(projected["label"], "Gemma 4");
        assert_eq!(projected["state"], "ready");
        assert_eq!(projected["supportedFeatures"], json!(["input.image"]));
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
