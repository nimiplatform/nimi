use std::collections::{BTreeMap, BTreeSet};

use prost_types::{
    value::Kind as ProtoValueKind, ListValue as ProtoListValue, Struct as ProtoStruct,
    Value as ProtoValue,
};
use serde_json::{json, Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::{
    AgentPresentationAssetMaterial, AgentPresentationAssetRole, AgentPresentationBackendKind,
    AgentPresentationProfile, ApplyLocalAppAgentAiProfileRequest,
    CommitLocalAppAgentPresentationRequest, GetLocalAppAgentAutonomySnapshotRequest,
    GetLocalAppAgentConfigurationSnapshotRequest, GetLocalAppAgentPresentationSnapshotRequest,
    GetLocalAppAgentReadinessSnapshotRequest, LocalAppAgentAiConfigComponentSelection,
    LocalAppAgentAiConfigIntent, LocalAppAgentAiConfigProjection,
    LocalAppAgentAiProfileApplyOutcome, LocalAppAgentAiProfileOrigin, LocalAppAgentAutonomyConfig,
    LocalAppAgentAutonomyIntent, LocalAppAgentAutonomyMode, LocalAppAgentAutonomyProjection,
    LocalAppAgentCapabilityReadiness, LocalAppAgentPresentationIntent,
    LocalAppAgentPresentationProjection, LocalAppAgentReadinessProjection,
    LocalAppAgentReadinessState, LocalAppAgentRouteOption, LocalAppAgentRouteOptionAvailability,
    PreviewLocalAppAgentAiProfileRequest, RoutePolicy, UpdateLocalAppAgentAutonomyRequest,
    UpdateLocalAppAgentConfigurationRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentAIProfileApplyRequest, LocalAppAgentAIProfilePreviewRequest,
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentUpdateAutonomyRequest, LocalAppAgentUpdateConfigurationRequest,
    LocalAppOperationError,
};

use super::{invalid_payload, require_text, untrusted};

pub(super) async fn configuration_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_configuration_snapshot(GetLocalAppAgentConfigurationSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_configuration(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn update_configuration(
    channel: Channel,
    request: LocalAppAgentUpdateConfigurationRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    if request.expected_configuration_revision == 0 {
        return Err(invalid_payload());
    }
    let intents = parse_ai_config_intents(request.intents)?;
    let profile_origin = parse_profile_origin(request.profile_origin)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .update_local_app_agent_configuration(UpdateLocalAppAgentConfigurationRequest {
            agent_handle: request.agent_handle,
            expected_configuration_revision: request.expected_configuration_revision,
            intents,
            profile_origin,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_configuration(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn readiness_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_readiness_snapshot(GetLocalAppAgentReadinessSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_readiness(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn ai_profile_preview(
    channel: Channel,
    request: LocalAppAgentAIProfilePreviewRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let profile_json = serde_json::to_vec(&request.profile).map_err(|_| invalid_payload())?;
    let runtime_descriptor_json =
        serde_json::to_vec(&request.runtime_descriptor).map_err(|_| invalid_payload())?;
    let response = RuntimeAgentServiceClient::new(channel)
        .preview_local_app_agent_ai_profile(PreviewLocalAppAgentAiProfileRequest {
            agent_handle: request.agent_handle,
            profile_json,
            runtime_descriptor_json,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({
        "before": response.before.map(project_configuration).transpose()?,
        "after": response.after.map(project_configuration).transpose()?,
        "outcome": project_ai_profile_outcome(response.outcome)?,
        "baseRevision": response.base_revision.to_string(),
        "blockingCapabilities": response.blocking_capabilities,
        "reasonCodes": response.reason_codes,
        "actionRefs": response.action_refs,
        "probeWarnings": response.probe_warnings,
    }))
}

pub(super) async fn ai_profile_apply(
    channel: Channel,
    request: LocalAppAgentAIProfileApplyRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    if request.expected_configuration_revision == 0 {
        return Err(invalid_payload());
    }
    let profile_json = serde_json::to_vec(&request.profile).map_err(|_| invalid_payload())?;
    let runtime_descriptor_json =
        serde_json::to_vec(&request.runtime_descriptor).map_err(|_| invalid_payload())?;
    let response = RuntimeAgentServiceClient::new(channel)
        .apply_local_app_agent_ai_profile(ApplyLocalAppAgentAiProfileRequest {
            agent_handle: request.agent_handle,
            expected_configuration_revision: request.expected_configuration_revision,
            profile_json,
            runtime_descriptor_json,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({
        "projection": response.projection.map(project_configuration).transpose()?,
        "outcome": project_ai_profile_outcome(response.outcome)?,
        "blockingCapabilities": response.blocking_capabilities,
        "reasonCodes": response.reason_codes,
        "actionRefs": response.action_refs,
        "probeWarnings": response.probe_warnings,
    }))
}

pub(super) async fn autonomy_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_autonomy_snapshot(GetLocalAppAgentAutonomySnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_autonomy(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn update_autonomy(
    channel: Channel,
    request: LocalAppAgentUpdateAutonomyRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    if request.expected_autonomy_revision == 0 {
        return Err(invalid_payload());
    }
    let intent = parse_autonomy_intent(request.intent)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .update_local_app_agent_autonomy(UpdateLocalAppAgentAutonomyRequest {
            agent_handle: request.agent_handle,
            expected_autonomy_revision: request.expected_autonomy_revision,
            intent: Some(intent),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_autonomy(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn presentation_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_presentation_snapshot(GetLocalAppAgentPresentationSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_presentation(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn commit_presentation(
    channel: Channel,
    request: LocalAppAgentCommitPresentationRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let intent = parse_presentation_intent(request.intent)?;
    let imported_assets = parse_presentation_assets(request.imported_assets)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .commit_local_app_agent_presentation(CommitLocalAppAgentPresentationRequest {
            agent_handle: request.agent_handle,
            expected_presentation_revision: request.expected_presentation_revision,
            intent: Some(intent),
            imported_assets,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_presentation(response.projection.ok_or_else(untrusted)?)
}

fn project_configuration(
    projection: LocalAppAgentAiConfigProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "capabilities": projection.capabilities,
        "intents": projection.intents.into_iter().map(project_ai_config_intent).collect::<Result<Vec<_>, _>>()?,
        "readiness": projection.readiness.into_iter().map(project_capability_readiness).collect::<Result<Vec<_>, _>>()?,
        "configurationRevision": projection.configuration_revision.to_string(),
        "routeOptions": projection.route_options.into_iter().map(project_route_option).collect::<Result<Vec<_>, _>>()?,
        "scopeOwnerId": projection.scope_owner_id,
        "profileOrigin": projection.profile_origin.map(project_profile_origin),
    }))
}

fn project_ai_profile_outcome(outcome: i32) -> Result<&'static str, LocalAppOperationError> {
    match LocalAppAgentAiProfileApplyOutcome::try_from(outcome).map_err(|_| untrusted())? {
        LocalAppAgentAiProfileApplyOutcome::ReadyToApply => Ok("ready_to_apply"),
        LocalAppAgentAiProfileApplyOutcome::SetupRequiredNoLiveConfig => {
            Ok("setup_required_no_live_config")
        }
        LocalAppAgentAiProfileApplyOutcome::UnsupportedNoLiveConfig => {
            Ok("unsupported_no_live_config")
        }
        LocalAppAgentAiProfileApplyOutcome::InvalidProfile => Ok("invalid_profile"),
        LocalAppAgentAiProfileApplyOutcome::StaleBase => Ok("stale_base"),
        LocalAppAgentAiProfileApplyOutcome::Failed => Ok("failed"),
        LocalAppAgentAiProfileApplyOutcome::Unspecified => Err(untrusted()),
    }
}

fn project_readiness(
    projection: LocalAppAgentReadinessProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "capabilities": projection.capabilities.into_iter().map(project_capability_readiness).collect::<Result<Vec<_>, _>>()?,
        "configurationRevision": projection.configuration_revision.to_string(),
    }))
}

fn project_ai_config_intent(
    intent: LocalAppAgentAiConfigIntent,
) -> Result<JsonValue, LocalAppOperationError> {
    let route_policy = match RoutePolicy::try_from(intent.route_policy).map_err(|_| untrusted())? {
        RoutePolicy::Local => "local",
        RoutePolicy::Cloud => "cloud",
        RoutePolicy::Unspecified => return Err(untrusted()),
    };
    let selected_components = intent
        .selected_components
        .into_iter()
        .map(project_ai_config_component)
        .collect::<Result<Vec<_>, _>>()?;
    let mut projected = json!({
        "capability": intent.capability,
        "provider": intent.provider,
        "logicalModelId": intent.logical_model_id,
        "routePolicy": route_policy,
        "selectedParams": intent.selected_params.map(proto_struct_to_json).transpose()?,
    });
    if !selected_components.is_empty() {
        projected.as_object_mut().ok_or_else(untrusted)?.insert(
            "selectedComponents".to_string(),
            JsonValue::Array(selected_components),
        );
    }
    Ok(projected)
}

fn project_ai_config_component(
    component: LocalAppAgentAiConfigComponentSelection,
) -> Result<JsonValue, LocalAppOperationError> {
    let mut projected = json!({
        "occurrenceId": component.occurrence_id,
        "order": component.order,
        "role": component.role,
        "componentKind": component.component_kind,
        "logicalModelId": component.logical_model_id,
        "required": component.required,
    });
    let object = projected.as_object_mut().ok_or_else(untrusted)?;
    if !component.weight.is_empty() {
        object.insert("weight".to_string(), JsonValue::String(component.weight));
    }
    if let Some(options) = component.options {
        object.insert("options".to_string(), proto_struct_to_json(options)?);
    }
    Ok(projected)
}

fn project_profile_origin(origin: LocalAppAgentAiProfileOrigin) -> JsonValue {
    json!({
        "profileId": origin.profile_id,
        "title": origin.title,
        "appliedAt": origin.applied_at.map(project_timestamp),
    })
}

fn project_route_option(
    option: LocalAppAgentRouteOption,
) -> Result<JsonValue, LocalAppOperationError> {
    let route_policy = match RoutePolicy::try_from(option.route_policy).map_err(|_| untrusted())? {
        RoutePolicy::Local => "local",
        RoutePolicy::Cloud => "cloud",
        RoutePolicy::Unspecified => return Err(untrusted()),
    };
    let availability = match LocalAppAgentRouteOptionAvailability::try_from(option.availability)
        .map_err(|_| untrusted())?
    {
        LocalAppAgentRouteOptionAvailability::Ready => "ready",
        LocalAppAgentRouteOptionAvailability::Installed => "installed",
        LocalAppAgentRouteOptionAvailability::Unspecified => return Err(untrusted()),
    };
    Ok(json!({
        "capability": option.capability,
        "provider": option.provider,
        "logicalModelId": option.logical_model_id,
        "routePolicy": route_policy,
        "label": option.label,
        "availability": availability,
    }))
}

fn project_capability_readiness(
    readiness: LocalAppAgentCapabilityReadiness,
) -> Result<JsonValue, LocalAppOperationError> {
    let state =
        match LocalAppAgentReadinessState::try_from(readiness.state).map_err(|_| untrusted())? {
            LocalAppAgentReadinessState::Ready => "ready",
            LocalAppAgentReadinessState::Blocked => "blocked",
            LocalAppAgentReadinessState::Unavailable => "unavailable",
            LocalAppAgentReadinessState::Failed => "failed",
            LocalAppAgentReadinessState::ConfiguredUnverified => "configured_unverified",
            LocalAppAgentReadinessState::Unspecified => return Err(untrusted()),
        };
    Ok(json!({
        "capability": readiness.capability,
        "state": state,
        "reason": readiness.reason,
        "observedAt": readiness.observed_at.map(project_timestamp),
    }))
}

fn project_autonomy(
    projection: LocalAppAgentAutonomyProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "enabled": projection.enabled,
        "config": projection.config.map(project_autonomy_config).transpose()?,
        "usedTokensInWindow": projection.used_tokens_in_window,
        "windowStartedAt": projection.window_started_at.map(project_timestamp),
        "budgetExhausted": projection.budget_exhausted,
        "suspendedUntil": projection.suspended_until.map(project_timestamp),
        "autonomyRevision": projection.autonomy_revision.to_string(),
    }))
}

fn project_autonomy_config(
    config: LocalAppAgentAutonomyConfig,
) -> Result<JsonValue, LocalAppOperationError> {
    let mode = match LocalAppAgentAutonomyMode::try_from(config.mode).map_err(|_| untrusted())? {
        LocalAppAgentAutonomyMode::Off => "off",
        LocalAppAgentAutonomyMode::Low => "low",
        LocalAppAgentAutonomyMode::Medium => "medium",
        LocalAppAgentAutonomyMode::High => "high",
        LocalAppAgentAutonomyMode::Unspecified => return Err(untrusted()),
    };
    Ok(json!({
        "dailyTokenBudget": config.daily_token_budget,
        "maxTokensPerHook": config.max_tokens_per_hook,
        "minHookInterval": config.min_hook_interval.map(project_duration),
        "suspendUntil": config.suspend_until.map(project_timestamp),
        "mode": mode,
    }))
}

fn project_presentation(
    projection: LocalAppAgentPresentationProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "profile": projection.profile.map(project_presentation_profile).transpose()?,
        "previousProfile": projection.previous_profile.map(project_presentation_profile).transpose()?,
        "defaultVoiceReference": projection.default_voice_reference,
        "presentationRevision": projection.presentation_revision.to_string(),
    }))
}

fn project_presentation_profile(
    profile: AgentPresentationProfile,
) -> Result<JsonValue, LocalAppOperationError> {
    let backend_kind = project_backend_kind(profile.backend_kind)?;
    Ok(json!({
        "backendKind": backend_kind,
        "avatarAssetRef": profile.avatar_asset_ref,
        "expressionProfileRef": profile.expression_profile_ref,
        "idlePreset": profile.idle_preset,
        "interactionPolicyRef": profile.interaction_policy_ref,
        "defaultVoiceReference": profile.default_voice_reference,
        "avatarAutoplay": profile.avatar_autoplay,
        "backgroundAssetRef": profile.background_asset_ref,
        "revision": profile.revision.to_string(),
    }))
}

fn project_backend_kind(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentPresentationBackendKind::try_from(value).map_err(|_| untrusted())? {
            AgentPresentationBackendKind::Vrm => "vrm",
            AgentPresentationBackendKind::Live2d => "live2d",
            AgentPresentationBackendKind::Sprite2d => "sprite2d",
            AgentPresentationBackendKind::Canvas2d => "canvas2d",
            AgentPresentationBackendKind::Video => "video",
            AgentPresentationBackendKind::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_timestamp(value: prost_types::Timestamp) -> JsonValue {
    json!({"seconds": value.seconds.to_string(), "nanos": value.nanos})
}

fn project_duration(value: prost_types::Duration) -> JsonValue {
    json!({"seconds": value.seconds.to_string(), "nanos": value.nanos})
}

fn proto_struct_to_json(value: ProtoStruct) -> Result<JsonValue, LocalAppOperationError> {
    let mut fields = JsonMap::new();
    for (key, value) in value.fields {
        fields.insert(key, proto_value_to_json(value)?);
    }
    Ok(JsonValue::Object(fields))
}

fn proto_value_to_json(value: ProtoValue) -> Result<JsonValue, LocalAppOperationError> {
    Ok(match value.kind.ok_or_else(untrusted)? {
        ProtoValueKind::NullValue(_) => JsonValue::Null,
        ProtoValueKind::NumberValue(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(untrusted)?,
        ProtoValueKind::StringValue(value) => JsonValue::String(value),
        ProtoValueKind::BoolValue(value) => JsonValue::Bool(value),
        ProtoValueKind::StructValue(value) => proto_struct_to_json(value)?,
        ProtoValueKind::ListValue(value) => JsonValue::Array(
            value
                .values
                .into_iter()
                .map(proto_value_to_json)
                .collect::<Result<_, _>>()?,
        ),
    })
}

fn json_to_proto_struct(value: &JsonValue) -> Result<ProtoStruct, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    let fields = object
        .iter()
        .map(|(key, value)| Ok((key.clone(), json_to_proto_value(value)?)))
        .collect::<Result<BTreeMap<_, _>, LocalAppOperationError>>()?;
    Ok(ProtoStruct { fields })
}

fn json_to_proto_value(value: &JsonValue) -> Result<ProtoValue, LocalAppOperationError> {
    let kind = match value {
        JsonValue::Null => ProtoValueKind::NullValue(0),
        JsonValue::Bool(value) => ProtoValueKind::BoolValue(*value),
        JsonValue::Number(value) => ProtoValueKind::NumberValue(
            value
                .as_f64()
                .filter(|value| value.is_finite())
                .ok_or_else(invalid_payload)?,
        ),
        JsonValue::String(value) => ProtoValueKind::StringValue(value.clone()),
        JsonValue::Array(values) => ProtoValueKind::ListValue(ProtoListValue {
            values: values
                .iter()
                .map(json_to_proto_value)
                .collect::<Result<_, _>>()?,
        }),
        JsonValue::Object(_) => ProtoValueKind::StructValue(json_to_proto_struct(value)?),
    };
    Ok(ProtoValue { kind: Some(kind) })
}

fn parse_ai_config_intents(
    value: JsonValue,
) -> Result<Vec<LocalAppAgentAiConfigIntent>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.is_empty() {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            let object = allowed_object(
                value,
                &[
                    "capability",
                    "provider",
                    "logicalModelId",
                    "routePolicy",
                    "selectedComponents",
                    "selectedParams",
                ],
            )?;
            let route_policy = match text(object, "routePolicy")? {
                "local" => RoutePolicy::Local,
                "cloud" => RoutePolicy::Cloud,
                _ => return Err(invalid_payload()),
            };
            let selected_params = match object.get("selectedParams") {
                Some(JsonValue::Object(_)) => Some(json_to_proto_struct(
                    object.get("selectedParams").expect("present"),
                )?),
                Some(JsonValue::Null) | None => None,
                _ => return Err(invalid_payload()),
            };
            let selected_components = match object.get("selectedComponents") {
                None => Vec::new(),
                Some(JsonValue::Array(values)) => parse_ai_config_components(values)?,
                _ => return Err(invalid_payload()),
            };
            Ok(LocalAppAgentAiConfigIntent {
                capability: text(object, "capability")?.to_string(),
                provider: optional_text(object, "provider")?.to_string(),
                logical_model_id: text(object, "logicalModelId")?.to_string(),
                route_policy: route_policy as i32,
                selected_params,
                selected_components,
            })
        })
        .collect()
}

fn parse_ai_config_components(
    values: &[JsonValue],
) -> Result<Vec<LocalAppAgentAiConfigComponentSelection>, LocalAppOperationError> {
    let mut occurrence_ids = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut prior_order = None;
    values
        .iter()
        .map(|value| {
            let object = allowed_object(
                value,
                &[
                    "occurrenceId",
                    "order",
                    "role",
                    "componentKind",
                    "logicalModelId",
                    "required",
                    "weight",
                    "options",
                ],
            )?;
            let occurrence_id = text(object, "occurrenceId")?.to_string();
            let order = u32::try_from(integer(object, "order")?).map_err(|_| invalid_payload())?;
            if !occurrence_ids.insert(occurrence_id.clone())
                || !orders.insert(order)
                || prior_order.is_some_and(|prior| order <= prior)
            {
                return Err(invalid_payload());
            }
            prior_order = Some(order);
            let required = object
                .get("required")
                .and_then(JsonValue::as_bool)
                .ok_or_else(invalid_payload)?;
            let weight = match object.get("weight") {
                None => String::new(),
                Some(JsonValue::String(value)) if value.trim() == value && value.len() <= 512 => {
                    value.clone()
                }
                _ => return Err(invalid_payload()),
            };
            let options = match object.get("options") {
                None => None,
                Some(JsonValue::Object(_)) => Some(json_to_proto_struct(
                    object.get("options").expect("present"),
                )?),
                _ => return Err(invalid_payload()),
            };
            Ok(LocalAppAgentAiConfigComponentSelection {
                occurrence_id,
                order,
                role: text(object, "role")?.to_string(),
                component_kind: text(object, "componentKind")?.to_string(),
                logical_model_id: text(object, "logicalModelId")?.to_string(),
                required,
                weight,
                options,
            })
        })
        .collect()
}

fn parse_profile_origin(
    value: JsonValue,
) -> Result<Option<LocalAppAgentAiProfileOrigin>, LocalAppOperationError> {
    if value.is_null() {
        return Ok(None);
    }
    let object = exact_object(&value, &["profileId", "title", "appliedAt"])?;
    Ok(Some(LocalAppAgentAiProfileOrigin {
        profile_id: text(object, "profileId")?.to_string(),
        title: text(object, "title")?.to_string(),
        applied_at: optional_timestamp(object.get("appliedAt"))?,
    }))
}

fn parse_autonomy_intent(
    value: JsonValue,
) -> Result<LocalAppAgentAutonomyIntent, LocalAppOperationError> {
    let object = allowed_object(&value, &["enabled", "config"])?;
    let enabled = match object.get("enabled") {
        Some(JsonValue::Bool(value)) => Some(*value),
        Some(JsonValue::Null) | None => None,
        _ => return Err(invalid_payload()),
    };
    let config = match object.get("config") {
        Some(JsonValue::Object(_)) => Some(parse_autonomy_config(
            object.get("config").expect("present"),
        )?),
        Some(JsonValue::Null) | None => None,
        _ => return Err(invalid_payload()),
    };
    if enabled.is_none() && config.is_none() {
        return Err(invalid_payload());
    }
    Ok(LocalAppAgentAutonomyIntent { enabled, config })
}

fn parse_autonomy_config(
    value: &JsonValue,
) -> Result<LocalAppAgentAutonomyConfig, LocalAppOperationError> {
    let object = allowed_object(
        value,
        &[
            "dailyTokenBudget",
            "maxTokensPerHook",
            "minHookInterval",
            "suspendUntil",
            "mode",
        ],
    )?;
    let mode = match text(object, "mode")? {
        "off" => LocalAppAgentAutonomyMode::Off,
        "low" => LocalAppAgentAutonomyMode::Low,
        "medium" => LocalAppAgentAutonomyMode::Medium,
        "high" => LocalAppAgentAutonomyMode::High,
        _ => return Err(invalid_payload()),
    };
    Ok(LocalAppAgentAutonomyConfig {
        daily_token_budget: integer(object, "dailyTokenBudget")?,
        max_tokens_per_hook: integer(object, "maxTokensPerHook")?,
        min_hook_interval: optional_duration(object.get("minHookInterval"))?,
        suspend_until: optional_timestamp(object.get("suspendUntil"))?,
        mode: mode as i32,
    })
}

fn parse_presentation_intent(
    value: JsonValue,
) -> Result<LocalAppAgentPresentationIntent, LocalAppOperationError> {
    let object = exact_object(
        &value,
        &[
            "backendKind",
            "avatarAssetRef",
            "expressionProfileRef",
            "idlePreset",
            "interactionPolicyRef",
            "defaultVoiceReference",
            "avatarAutoplay",
            "backgroundAssetRef",
        ],
    )?;
    let backend_kind = match text(object, "backendKind")? {
        "vrm" => AgentPresentationBackendKind::Vrm,
        "live2d" => AgentPresentationBackendKind::Live2d,
        "sprite2d" => AgentPresentationBackendKind::Sprite2d,
        "canvas2d" => AgentPresentationBackendKind::Canvas2d,
        "video" => AgentPresentationBackendKind::Video,
        _ => return Err(invalid_payload()),
    };
    let avatar_autoplay = object
        .get("avatarAutoplay")
        .and_then(JsonValue::as_bool)
        .ok_or_else(invalid_payload)?;
    Ok(LocalAppAgentPresentationIntent {
        backend_kind: backend_kind as i32,
        avatar_asset_ref: optional_text(object, "avatarAssetRef")?.to_string(),
        expression_profile_ref: optional_text(object, "expressionProfileRef")?.to_string(),
        idle_preset: optional_text(object, "idlePreset")?.to_string(),
        interaction_policy_ref: optional_text(object, "interactionPolicyRef")?.to_string(),
        default_voice_reference: optional_text(object, "defaultVoiceReference")?.to_string(),
        avatar_autoplay,
        background_asset_ref: optional_text(object, "backgroundAssetRef")?.to_string(),
    })
}

fn parse_presentation_assets(
    value: JsonValue,
) -> Result<Vec<AgentPresentationAssetMaterial>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.len() > 2 {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            let object = exact_object(
                value,
                &["role", "fileName", "mediaType", "content", "sha256"],
            )?;
            let role = match text(object, "role")? {
                "avatar" => AgentPresentationAssetRole::Avatar,
                "background" => AgentPresentationAssetRole::Background,
                _ => return Err(invalid_payload()),
            };
            let content_values = object
                .get("content")
                .and_then(JsonValue::as_array)
                .ok_or_else(invalid_payload)?;
            if content_values.is_empty() || content_values.len() > 64 * 1024 * 1024 {
                return Err(invalid_payload());
            }
            let content = content_values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .filter(|byte| *byte <= 255)
                        .map(|byte| byte as u8)
                        .ok_or_else(invalid_payload)
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AgentPresentationAssetMaterial {
                role: role as i32,
                file_name: text(object, "fileName")?.to_string(),
                media_type: text(object, "mediaType")?.to_string(),
                content,
                sha256: text(object, "sha256")?.to_string(),
            })
        })
        .collect()
}

fn allowed_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a JsonMap<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(invalid_payload());
    }
    Ok(object)
}

fn exact_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a JsonMap<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid_payload());
    }
    Ok(object)
}

fn text<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    let value = optional_text(object, key)?;
    if value.is_empty() {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn optional_text<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    let value = object
        .get(key)
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    if value.trim() != value || value.len() > 512 {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn integer(object: &JsonMap<String, JsonValue>, key: &str) -> Result<i64, LocalAppOperationError> {
    object
        .get(key)
        .and_then(JsonValue::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(invalid_payload)
}

fn optional_timestamp(
    value: Option<&JsonValue>,
) -> Result<Option<prost_types::Timestamp>, LocalAppOperationError> {
    match value {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => parse_seconds_nanos(value)
            .map(|(seconds, nanos)| Some(prost_types::Timestamp { seconds, nanos })),
    }
}

fn optional_duration(
    value: Option<&JsonValue>,
) -> Result<Option<prost_types::Duration>, LocalAppOperationError> {
    match value {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => parse_seconds_nanos(value)
            .map(|(seconds, nanos)| Some(prost_types::Duration { seconds, nanos })),
    }
}

fn parse_seconds_nanos(value: &JsonValue) -> Result<(i64, i32), LocalAppOperationError> {
    let object = exact_object(value, &["seconds", "nanos"])?;
    let seconds = object
        .get("seconds")
        .and_then(JsonValue::as_str)
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(invalid_payload)?;
    let nanos = object
        .get("nanos")
        .and_then(JsonValue::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| (0..1_000_000_000).contains(value))
        .ok_or_else(invalid_payload)?;
    Ok((seconds, nanos))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_presentation_revision_crosses_the_native_boundary_as_decimal_zero() {
        let projected = project_presentation(LocalAppAgentPresentationProjection {
            profile: None,
            previous_profile: None,
            default_voice_reference: String::new(),
            presentation_revision: 0,
        })
        .expect("fresh presentation projection");
        assert_eq!(projected["presentationRevision"], "0");
        assert!(projected["profile"].is_null());
        assert!(projected["previousProfile"].is_null());
        assert_eq!(
            projected.as_object().map(|record| record.len()),
            Some(4),
            "fresh projection keeps the exact public SDK shape",
        );
    }

    #[test]
    fn configuration_projects_only_the_bounded_route_option_shape() {
        let projected = project_configuration(LocalAppAgentAiConfigProjection {
            capabilities: vec!["text.generate".to_string()],
            intents: vec![LocalAppAgentAiConfigIntent {
                capability: "text.generate".to_string(),
                provider: String::new(),
                logical_model_id: "local/default".to_string(),
                route_policy: RoutePolicy::Local as i32,
                selected_params: None,
                selected_components: vec![LocalAppAgentAiConfigComponentSelection {
                    occurrence_id: "text-encoder".to_string(),
                    order: 0,
                    role: "encoder".to_string(),
                    component_kind: "text_encoder".to_string(),
                    logical_model_id: "local/text-encoder".to_string(),
                    required: true,
                    weight: String::new(),
                    options: None,
                }],
            }],
            readiness: Vec::new(),
            configuration_revision: 1,
            route_options: vec![LocalAppAgentRouteOption {
                capability: "text.generate".to_string(),
                provider: String::new(),
                logical_model_id: "local.chat.gemma-test".to_string(),
                route_policy: RoutePolicy::Local as i32,
                label: "Gemma Test".to_string(),
                availability: LocalAppAgentRouteOptionAvailability::Ready as i32,
            }],
            scope_owner_id: "local-agent:test".to_string(),
            profile_origin: None,
        })
        .expect("configuration projection");
        assert_eq!(
            projected.as_object().map(|record| record.len()),
            Some(7),
            "configuration keeps the exact public SDK shape",
        );
        let component = &projected["intents"][0]["selectedComponents"][0];
        assert_eq!(component["occurrenceId"], "text-encoder");
        assert_eq!(component["logicalModelId"], "local/text-encoder");
        assert!(component.get("targetRef").is_none());
        let option = &projected["routeOptions"][0];
        assert_eq!(option["logicalModelId"], "local.chat.gemma-test");
        assert_eq!(option["availability"], "ready");
        assert_eq!(
            option.as_object().map(|record| record.len()),
            Some(6),
            "route option omits private inventory material",
        );
    }

    #[test]
    fn configuration_component_input_accepts_only_the_public_shape() {
        let public = serde_json::json!([{
            "capability": "text.generate",
            "provider": "",
            "logicalModelId": "local/default",
            "routePolicy": "local",
            "selectedComponents": [{
                "occurrenceId": "text-encoder",
                "order": 0,
                "role": "encoder",
                "componentKind": "text_encoder",
                "logicalModelId": "local/text-encoder",
                "required": true
            }],
            "selectedParams": null
        }]);
        let parsed = parse_ai_config_intents(public).expect("public component input");
        assert_eq!(parsed[0].selected_components.len(), 1);
        assert_eq!(
            parsed[0].selected_components[0].occurrence_id,
            "text-encoder"
        );

        let private = serde_json::json!([{
            "capability": "text.generate",
            "provider": "",
            "logicalModelId": "local/default",
            "routePolicy": "local",
            "selectedComponents": [{
                "occurrenceId": "text-encoder",
                "order": 0,
                "role": "encoder",
                "componentKind": "text_encoder",
                "logicalModelId": "local/text-encoder",
                "required": true,
                "localAssetId": "private"
            }],
            "selectedParams": null
        }]);
        assert!(parse_ai_config_intents(private).is_err());
    }

    #[test]
    fn imported_presentation_assets_cross_the_native_boundary_as_owned_bytes() {
        let assets = parse_presentation_assets(serde_json::json!([{
            "role": "avatar",
            "fileName": "avatar.vrm",
            "mediaType": "model/gltf-binary",
            "content": [1, 2, 255],
            "sha256": "abc123"
        }]))
        .expect("imported presentation asset");
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].role, AgentPresentationAssetRole::Avatar as i32);
        assert_eq!(assets[0].content, vec![1, 2, 255]);
    }

    #[test]
    fn configure_mutation_revisions_remain_u64_without_number_projection() {
        let projected = project_readiness(LocalAppAgentReadinessProjection {
            capabilities: Vec::new(),
            configuration_revision: u64::MAX,
        })
        .expect("readiness projection");
        assert_eq!(projected["configurationRevision"], u64::MAX.to_string());
    }
}
