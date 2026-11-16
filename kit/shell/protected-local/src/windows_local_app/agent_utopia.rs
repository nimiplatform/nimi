// @nimi-authority: rule.nimi.platform.app-ecosystem.utopia-operations
use std::collections::BTreeMap;

use crate::generated::{
    local_app_utopia_event_mutation::Action as ProtoEventAction,
    update_local_app_agent_utopia_settings_request::Change as ProtoChange,
    GetLocalAppAgentUtopiaSnapshotRequest, GetLocalAppAgentUtopiaSnapshotResponse,
    LocalAppUtopiaActivateHabitatChange, LocalAppUtopiaActiveEvent, LocalAppUtopiaActivitySpec,
    LocalAppUtopiaApplyTuningChange, LocalAppUtopiaCustomEventTrigger,
    LocalAppUtopiaEventMutation, LocalAppUtopiaEventPresetSpec, LocalAppUtopiaFrame,
    LocalAppUtopiaHabitatSpec, LocalAppUtopiaParameterCondition, LocalAppUtopiaParameterEntry,
    LocalAppUtopiaParameterOption, LocalAppUtopiaParameterSpec, LocalAppUtopiaPersonalQuarterSpec,
    LocalAppUtopiaPlaceSpec, LocalAppUtopiaPresetEventTrigger, LocalAppUtopiaRelocationSummary,
    LocalAppUtopiaRestoreDefaultChange, LocalAppUtopiaSolitudeChange,
    UpdateLocalAppAgentUtopiaSettingsRequest, UpdateLocalAppAgentUtopiaSettingsResponse,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{LocalAppOperationError, LocalAppReasonCode};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use tonic::transport::Channel;

fn invalid_payload() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false)
}

fn untrusted() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateInput {
    expected_revision: String,
    intent: ChangeInput,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParameterConditionInput {
    parameter_key: String,
    allowed_values: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParameterOptionInput {
    value: String,
    label: String,
    summary: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParameterSpecInput {
    key: String,
    label: String,
    default_value: String,
    options: Vec<ParameterOptionInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersonalQuarterSpecInput {
    id: String,
    name: String,
    sensory_traits: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlaceSpecInput {
    id: String,
    name: String,
    archetype: String,
    indoor: bool,
    sensory_traits: String,
    open_when: Vec<ParameterConditionInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivitySpecInput {
    id: String,
    name: String,
    place_ids: Vec<String>,
    social_mode: String,
    allowed_dayparts: Vec<String>,
    when: Vec<ParameterConditionInput>,
    min_duration_minutes: i32,
    max_duration_minutes: i32,
    scene_hint: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EventPresetSpecInput {
    id: String,
    scenery_kind: String,
    label: String,
    description: String,
    #[serde(default)]
    place_id: Option<String>,
    default_duration_minutes: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HabitatSpecInput {
    schema_version: String,
    habitat_id: String,
    title: String,
    theme_tag: String,
    backdrop_summary: String,
    personal_quarter: PersonalQuarterSpecInput,
    places: Vec<PlaceSpecInput>,
    activities: Vec<ActivitySpecInput>,
    parameters: Vec<ParameterSpecInput>,
    event_presets: Vec<EventPresetSpecInput>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum EventMutationInput {
    #[serde(rename_all = "camelCase")]
    TriggerPreset {
        preset_id: String,
        #[serde(default)]
        duration_minutes: Option<i32>,
    },
    #[serde(rename_all = "camelCase")]
    PutCustom {
        scenery_kind: String,
        label: String,
        description: String,
        #[serde(default)]
        place_id: Option<String>,
        duration_minutes: i32,
    },
    #[serde(rename_all = "camelCase")]
    ClearEvent {
        event_id: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum ChangeInput {
    #[serde(rename_all = "camelCase")]
    ActivateHabitat {
        habitat: HabitatSpecInput,
        #[serde(default)]
        initial_parameters: Option<BTreeMap<String, String>>,
        #[serde(default)]
        timezone: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    RestoreDefault {
        #[serde(default)]
        timezone: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    ApplyTuning {
        #[serde(default)]
        parameters: Option<BTreeMap<String, String>>,
        #[serde(default)]
        event: Option<EventMutationInput>,
    },
    #[serde(rename_all = "camelCase")]
    SetPublicParticipation {
        enabled: bool,
    },
    #[serde(rename_all = "camelCase")]
    SetSolitude {
        agent_handle: String,
        solitary: bool,
    },
    #[serde(rename_all = "camelCase")]
    SetTimezone {
        timezone: String,
    },
}

fn parse_expected_revision(raw: &str) -> Result<u64, LocalAppOperationError> {
    if raw.is_empty() || raw.starts_with('0') || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid_payload());
    }
    let rev = raw.parse::<u64>().map_err(|_| invalid_payload())?;
    if rev == 0 {
        return Err(invalid_payload());
    }
    Ok(rev)
}

fn to_proto_conditions(items: Vec<ParameterConditionInput>) -> Vec<LocalAppUtopiaParameterCondition> {
    items
        .into_iter()
        .map(|c| LocalAppUtopiaParameterCondition {
            parameter_key: c.parameter_key,
            allowed_values: c.allowed_values,
        })
        .collect()
}

fn to_proto_habitat(h: HabitatSpecInput) -> LocalAppUtopiaHabitatSpec {
    LocalAppUtopiaHabitatSpec {
        schema_version: h.schema_version,
        habitat_id: h.habitat_id,
        title: h.title,
        theme_tag: h.theme_tag,
        backdrop_summary: h.backdrop_summary,
        personal_quarter: Some(LocalAppUtopiaPersonalQuarterSpec {
            id: h.personal_quarter.id,
            name: h.personal_quarter.name,
            sensory_traits: h.personal_quarter.sensory_traits,
        }),
        places: h
            .places
            .into_iter()
            .map(|p| LocalAppUtopiaPlaceSpec {
                id: p.id,
                name: p.name,
                archetype: p.archetype,
                indoor: p.indoor,
                sensory_traits: p.sensory_traits,
                open_when: to_proto_conditions(p.open_when),
            })
            .collect(),
        activities: h
            .activities
            .into_iter()
            .map(|a| LocalAppUtopiaActivitySpec {
                id: a.id,
                name: a.name,
                place_ids: a.place_ids,
                social_mode: a.social_mode,
                allowed_dayparts: a.allowed_dayparts,
                when: to_proto_conditions(a.when),
                min_duration_minutes: a.min_duration_minutes,
                max_duration_minutes: a.max_duration_minutes,
                scene_hint: a.scene_hint,
            })
            .collect(),
        parameters: h
            .parameters
            .into_iter()
            .map(|p| LocalAppUtopiaParameterSpec {
                key: p.key,
                label: p.label,
                default_value: p.default_value,
                options: p
                    .options
                    .into_iter()
                    .map(|o| LocalAppUtopiaParameterOption {
                        value: o.value,
                        label: o.label,
                        summary: o.summary,
                    })
                    .collect(),
            })
            .collect(),
        event_presets: h
            .event_presets
            .into_iter()
            .map(|ep| LocalAppUtopiaEventPresetSpec {
                id: ep.id,
                scenery_kind: ep.scenery_kind,
                label: ep.label,
                description: ep.description,
                place_id: ep.place_id,
                default_duration_minutes: ep.default_duration_minutes,
            })
            .collect(),
    }
}

fn to_proto_parameter_entries(map: Option<BTreeMap<String, String>>) -> Vec<LocalAppUtopiaParameterEntry> {
    map.unwrap_or_default()
        .into_iter()
        .map(|(key, value)| LocalAppUtopiaParameterEntry { key, value })
        .collect()
}

pub(crate) fn parse_update_request(
    value: Value,
) -> Result<UpdateLocalAppAgentUtopiaSettingsRequest, LocalAppOperationError> {
    let encoded = serde_json::to_vec(&value).map_err(|_| invalid_payload())?;
    if encoded.len() > 32 * 1024 {
        return Err(invalid_payload());
    }
    let update: UpdateInput = serde_json::from_value(value).map_err(|_| invalid_payload())?;
    let expected_revision = parse_expected_revision(&update.expected_revision)?;
    let change = match update.intent {
        ChangeInput::ActivateHabitat {
            habitat,
            initial_parameters,
            timezone,
        } => ProtoChange::ActivateHabitat(LocalAppUtopiaActivateHabitatChange {
            habitat: Some(to_proto_habitat(habitat)),
            initial_parameters: to_proto_parameter_entries(initial_parameters),
            timezone,
        }),
        ChangeInput::RestoreDefault { timezone } => {
            ProtoChange::RestoreDefault(LocalAppUtopiaRestoreDefaultChange { timezone })
        }
        ChangeInput::ApplyTuning { parameters, event } => {
            let params_vec = to_proto_parameter_entries(parameters);
            if params_vec.is_empty() && event.is_none() {
                return Err(invalid_payload());
            }
            let event_mutation = event.map(|ev| {
                let action = match ev {
                    EventMutationInput::TriggerPreset {
                        preset_id,
                        duration_minutes,
                    } => ProtoEventAction::TriggerPreset(LocalAppUtopiaPresetEventTrigger {
                        preset_id,
                        duration_minutes,
                    }),
                    EventMutationInput::PutCustom {
                        scenery_kind,
                        label,
                        description,
                        place_id,
                        duration_minutes,
                    } => ProtoEventAction::PutCustom(LocalAppUtopiaCustomEventTrigger {
                        scenery_kind,
                        label,
                        description,
                        place_id,
                        duration_minutes,
                    }),
                    EventMutationInput::ClearEvent { event_id } => {
                        ProtoEventAction::ClearEventId(event_id)
                    }
                };
                LocalAppUtopiaEventMutation {
                    action: Some(action),
                }
            });
            ProtoChange::ApplyTuning(LocalAppUtopiaApplyTuningChange {
                parameters: params_vec,
                event_mutation,
            })
        }
        ChangeInput::SetPublicParticipation { enabled } => {
            ProtoChange::PublicParticipation(enabled)
        }
        ChangeInput::SetSolitude {
            agent_handle,
            solitary,
        } => ProtoChange::Solitude(LocalAppUtopiaSolitudeChange {
            agent_handle,
            solitary,
        }),
        ChangeInput::SetTimezone { timezone } => ProtoChange::Timezone(timezone),
    };
    Ok(UpdateLocalAppAgentUtopiaSettingsRequest {
        expected_revision,
        change: Some(change),
    })
}

#[derive(Debug, Clone)]
pub struct ParsedAgentUtopiaUpdateInput(pub(crate) UpdateLocalAppAgentUtopiaSettingsRequest);

pub fn parse_agent_utopia_update_input(
    value: Value,
) -> Result<ParsedAgentUtopiaUpdateInput, LocalAppOperationError> {
    parse_update_request(value).map(ParsedAgentUtopiaUpdateInput)
}

pub fn validate_agent_utopia_update_input(value: &Value) -> Result<(), LocalAppOperationError> {
    parse_update_request(value.clone()).map(|_| ())
}

fn time_required(value: Option<prost_types::Timestamp>) -> Result<Value, LocalAppOperationError> {
    let ts = value.ok_or_else(untrusted)?;
    Ok(json!({ "seconds": ts.seconds.to_string(), "nanos": ts.nanos }))
}

fn time_optional(value: Option<prost_types::Timestamp>) -> Value {
    value.map_or(
        Value::Null,
        |ts| json!({ "seconds": ts.seconds.to_string(), "nanos": ts.nanos }),
    )
}

fn project_parameter_map(
    entries: Vec<LocalAppUtopiaParameterEntry>,
) -> Result<Value, LocalAppOperationError> {
    let mut out = Map::with_capacity(entries.len());
    for entry in entries {
        if out.contains_key(&entry.key) {
            return Err(untrusted());
        }
        out.insert(entry.key, Value::String(entry.value));
    }
    Ok(Value::Object(out))
}

fn project_active_events(
    events: Vec<LocalAppUtopiaActiveEvent>,
) -> Result<Vec<Value>, LocalAppOperationError> {
    events
        .into_iter()
        .map(|ev| {
            Ok(json!({
                "eventId": ev.event_id,
                "slot": ev.slot,
                "sceneryKind": ev.scenery_kind,
                "label": ev.label,
                "description": ev.description,
                "placeId": ev.place_id,
                "startsAt": time_required(ev.starts_at)?,
                "expiresAt": time_required(ev.expires_at)?,
            }))
        })
        .collect()
}

fn project_conditions(items: Vec<LocalAppUtopiaParameterCondition>) -> Vec<Value> {
    items
        .into_iter()
        .map(|c| {
            json!({
                "parameterKey": c.parameter_key,
                "allowedValues": c.allowed_values,
            })
        })
        .collect()
}

fn project_habitat_spec(
    spec: LocalAppUtopiaHabitatSpec,
) -> Result<Value, LocalAppOperationError> {
    let pq = spec.personal_quarter.ok_or_else(untrusted)?;
    Ok(json!({
        "schemaVersion": spec.schema_version,
        "habitatId": spec.habitat_id,
        "title": spec.title,
        "themeTag": spec.theme_tag,
        "backdropSummary": spec.backdrop_summary,
        "personalQuarter": {
            "id": pq.id,
            "name": pq.name,
            "sensoryTraits": pq.sensory_traits,
        },
        "places": spec.places.into_iter().map(|p| json!({
            "id": p.id,
            "name": p.name,
            "archetype": p.archetype,
            "indoor": p.indoor,
            "sensoryTraits": p.sensory_traits,
            "openWhen": project_conditions(p.open_when),
        })).collect::<Vec<_>>(),
        "activities": spec.activities.into_iter().map(|a| json!({
            "id": a.id,
            "name": a.name,
            "placeIds": a.place_ids,
            "socialMode": a.social_mode,
            "allowedDayparts": a.allowed_dayparts,
            "when": project_conditions(a.when),
            "minDurationMinutes": a.min_duration_minutes,
            "maxDurationMinutes": a.max_duration_minutes,
            "sceneHint": a.scene_hint,
        })).collect::<Vec<_>>(),
        "parameters": spec.parameters.into_iter().map(|p| json!({
            "key": p.key,
            "label": p.label,
            "defaultValue": p.default_value,
            "options": p.options.into_iter().map(|o| json!({
                "value": o.value,
                "label": o.label,
                "summary": o.summary,
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "eventPresets": spec.event_presets.into_iter().map(|ep| json!({
            "id": ep.id,
            "sceneryKind": ep.scenery_kind,
            "label": ep.label,
            "description": ep.description,
            "placeId": ep.place_id,
            "defaultDurationMinutes": ep.default_duration_minutes,
        })).collect::<Vec<_>>(),
    }))
}

fn project_frame(value: Option<LocalAppUtopiaFrame>) -> Result<Value, LocalAppOperationError> {
    let Some(f) = value else {
        return Ok(Value::Null);
    };
    Ok(json!({
        "activityId": f.activity_id,
        "title": f.title,
        "habitatActivationId": f.habitat_activation_id,
        "habitatId": f.habitat_id,
        "habitatTitle": f.habitat_title,
        "placeId": f.place_id,
        "placeLabel": f.place_label,
        "startsAt": time_required(f.starts_at)?,
        "endsAt": time_optional(f.ends_at),
        "interaction": f.interaction,
    }))
}

fn project_relocation(
    value: Option<LocalAppUtopiaRelocationSummary>,
) -> Result<Value, LocalAppOperationError> {
    let Some(r) = value else {
        return Ok(Value::Null);
    };
    Ok(json!({
        "fromHabitatId": r.from_habitat_id,
        "fromHabitatTitle": r.from_habitat_title,
        "toHabitatId": r.to_habitat_id,
        "toHabitatTitle": r.to_habitat_title,
        "relocatedAt": time_required(r.relocated_at)?,
    }))
}

fn project_snapshot_response(
    result: GetLocalAppAgentUtopiaSnapshotResponse,
) -> Result<Value, LocalAppOperationError> {
    let residents = result
        .residents
        .into_iter()
        .map(|r| {
            Ok(json!({
                "agentHandle": r.agent_handle,
                "displayName": r.display_name,
                "solitary": r.solitary,
                "current": project_frame(r.current)?,
                "recent": project_frame(r.recent)?,
                "next": project_frame(r.next)?,
            }))
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;

    Ok(json!({
        "revision": result.revision.to_string(),
        "observedAt": time_required(result.observed_at)?,
        "habitatActivationId": result.habitat_activation_id,
        "contentDigest": result.content_digest,
        "timezone": result.timezone,
        "publicParticipation": result.public_participation,
        "habitat": project_habitat_spec(result.habitat.ok_or_else(untrusted)?)?,
        "parameterValues": project_parameter_map(result.parameter_values)?,
        "openPlaceIds": result.open_place_ids,
        "activeEvents": project_active_events(result.active_events)?,
        "lastRelocation": project_relocation(result.last_relocation)?,
        "residents": residents,
        "occupancy": result.occupancy.into_iter().map(|p| json!({
            "placeId": p.place_id,
            "agentHandles": p.agent_handles,
        })).collect::<Vec<_>>(),
        "sharedActivities": result.shared_activities.into_iter().map(|a| json!({
            "activityRef": a.activity_ref,
            "habitatActivationId": a.habitat_activation_id,
            "habitatId": a.habitat_id,
            "habitatTitle": a.habitat_title,
            "initiatorHandle": a.initiator_handle,
            "recipientHandle": a.recipient_handle,
            "placeId": a.place_id,
            "placeLabel": a.place_label,
            "activityId": a.activity_id,
            "activityLabel": a.activity_label,
            "state": a.state,
            "startsAt": time_optional(a.starts_at),
            "endsAt": time_optional(a.ends_at),
            "acceptedAt": time_optional(a.accepted_at),
        })).collect::<Vec<_>>(),
    }))
}

fn project_mutation_ack(
    ack: UpdateLocalAppAgentUtopiaSettingsResponse,
) -> Result<Value, LocalAppOperationError> {
    Ok(json!({
        "revision": ack.revision.to_string(),
        "habitatActivationId": ack.habitat_activation_id,
        "habitatId": ack.habitat_id,
        "habitatTitle": ack.habitat_title,
        "contentDigest": ack.content_digest,
        "timezone": ack.timezone,
        "publicParticipation": ack.public_participation,
        "parameterValues": project_parameter_map(ack.parameter_values)?,
        "openPlaceIds": ack.open_place_ids,
        "activeEvents": project_active_events(ack.active_events)?,
    }))
}

#[allow(dead_code)]
pub(crate) async fn snapshot(channel: Channel) -> Result<Value, LocalAppOperationError> {
    let result = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_utopia_snapshot(GetLocalAppAgentUtopiaSnapshotRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_snapshot_response(result)
}

#[allow(dead_code)]
pub(crate) async fn update(
    channel: Channel,
    parsed: ParsedAgentUtopiaUpdateInput,
) -> Result<Value, LocalAppOperationError> {
    let result = crate::grpc_limits::runtime_agent_client(channel)
        .update_local_app_agent_utopia_settings(parsed.0)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_mutation_ack(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_habitat() -> Value {
        json!({
            "schemaVersion": "1.0",
            "habitatId": "nimi.builtin.seaside-island",
            "title": "海风渔岛",
            "themeTag": "seaside",
            "backdropSummary": "潮声轻拍木栈。",
            "personalQuarter": {
                "id": "personal-quarter",
                "name": "海边木屋",
                "sensoryTraits": "温暖木窗"
            },
            "places": [{
                "id": "bird-hide",
                "name": "遮蔽观鸟棚",
                "archetype": "lookout",
                "indoor": false,
                "sensoryTraits": "木窗观海",
                "openWhen": []
            }],
            "activities": [
                {
                    "id": "rest",
                    "name": "木屋小憩",
                    "placeIds": ["personal-quarter"],
                    "socialMode": "solo",
                    "allowedDayparts": ["morning", "day", "dusk", "night"],
                    "when": [],
                    "minDurationMinutes": 20,
                    "maxDurationMinutes": 60,
                    "sceneHint": "休息"
                },
                {
                    "id": "watch",
                    "name": "静坐观鸟",
                    "placeIds": ["bird-hide"],
                    "socialMode": "shared_invite",
                    "allowedDayparts": ["morning", "day"],
                    "when": [],
                    "minDurationMinutes": 20,
                    "maxDurationMinutes": 60,
                    "sceneHint": "观鸟"
                }
            ],
            "parameters": [{
                "key": "weather",
                "label": "天气",
                "defaultValue": "clear",
                "options": [
                    { "value": "clear", "label": "晴朗", "summary": "晴" },
                    { "value": "storm", "label": "阵雨", "summary": "雨" }
                ]
            }],
            "eventPresets": [{
                "id": "sea-glass",
                "sceneryKind": "tide-pooling",
                "label": "海玻璃",
                "description": "礁石海玻璃",
                "placeId": "bird-hide",
                "defaultDurationMinutes": 120
            }]
        })
    }

    #[test]
    fn parses_all_six_v2_utopia_intents() {
        let valid_payloads = [
            json!({
                "expectedRevision": "1",
                "intent": {
                    "kind": "activate-habitat",
                    "habitat": sample_habitat(),
                    "initialParameters": { "weather": "clear" },
                    "timezone": "Asia/Shanghai"
                }
            }),
            json!({
                "expectedRevision": "2",
                "intent": { "kind": "restore-default", "timezone": "UTC" }
            }),
            json!({
                "expectedRevision": "3",
                "intent": {
                    "kind": "apply-tuning",
                    "parameters": { "weather": "storm" },
                    "event": { "kind": "trigger-preset", "presetId": "sea-glass", "durationMinutes": 90 }
                }
            }),
            json!({
                "expectedRevision": "4",
                "intent": { "kind": "set-public-participation", "enabled": false }
            }),
            json!({
                "expectedRevision": "5",
                "intent": { "kind": "set-solitude", "agentHandle": "agent_ref_test", "solitary": true }
            }),
            json!({
                "expectedRevision": "6",
                "intent": { "kind": "set-timezone", "timezone": "Asia/Shanghai" }
            }),
        ];
        for payload in valid_payloads {
            parse_update_request(payload).expect("valid v2 payload must parse");
        }
    }

    #[test]
    fn rejects_retired_v1_intents_and_unknown_fields() {
        let invalid_payloads = [
            json!({ "expectedRevision": "1", "intent": { "kind": "select-preset", "preset": "island" } }),
            json!({ "expectedRevision": "1", "intent": { "kind": "outdoor", "open": false } }),
            json!({ "expectedRevision": "1", "intent": { "kind": "public", "enabled": true } }),
            json!({ "expectedRevision": "1", "intent": { "kind": "solitude", "agentHandle": "a", "solitary": true } }),
            json!({ "expectedRevision": "01", "intent": { "kind": "restore-default" } }),
            json!({ "expectedRevision": "0", "intent": { "kind": "restore-default" } }),
            json!({ "expectedRevision": "1", "intent": { "kind": "apply-tuning" } }),
            json!({ "expectedRevision": "1", "intent": { "kind": "restore-default", "extra": true } }),
        ];
        for payload in invalid_payloads {
            let err = parse_update_request(payload).expect_err("retired/malformed payload must fail");
            assert_eq!(err.reason_code(), LocalAppReasonCode::InvalidPayload);
        }
    }
}
