use super::{invalid_payload, untrusted};
use crate::generated::{
    update_local_app_agent_utopia_settings_request::Intent, GetLocalAppAgentUtopiaSnapshotRequest,
    LocalAppAgentUtopiaFrame, LocalAppAgentUtopiaSettings, LocalAppAgentUtopiaSolitude,
    UpdateLocalAppAgentUtopiaSettingsRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::LocalAppOperationError;
use serde::Deserialize;
use serde_json::{json, Value};
use tonic::transport::Channel;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Update {
    expected_revision: String,
    intent: Change,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum Change {
    SelectPreset {
        preset: String,
    },
    RestoreDefault,
    Outdoor {
        open: bool,
    },
    Public {
        enabled: bool,
    },
    Solitude {
        #[serde(rename = "agentHandle")]
        agent_handle: String,
        solitary: bool,
    },
}

fn project_settings(settings: LocalAppAgentUtopiaSettings) -> Value {
    json!({
        "revision":settings.revision.to_string(),"preset":settings.preset,
        "presetVersion":settings.preset_version.to_string(),"outdoorOpen":settings.outdoor_open,
        "publicParticipation":settings.public_participation
    })
}

fn time(value: Option<prost_types::Timestamp>) -> Value {
    value.map_or(
        Value::Null,
        |value| json!({"seconds": value.seconds.to_string(), "nanos":value.nanos}),
    )
}

fn frame(value: Option<LocalAppAgentUtopiaFrame>) -> Value {
    value.map_or(Value::Null, |f| json!({"title":f.title,"place":f.place,"startsAt":time(f.starts_at),"endsAt":time(f.ends_at),"interaction":f.interaction}))
}

pub(super) async fn snapshot(channel: Channel) -> Result<Value, LocalAppOperationError> {
    let result = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_utopia_snapshot(GetLocalAppAgentUtopiaSnapshotRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({
        "settings": project_settings(result.settings.ok_or_else(untrusted)?),
        "observedAt": time(result.observed_at),
        "places": result.places.into_iter().map(|p| json!({"id":p.id,"activities":p.activities})).collect::<Vec<_>>(),
        "residents": result.residents.into_iter().map(|r| json!({"agentHandle":r.agent_handle,"displayName":r.display_name,"solitary":r.solitary,"current":frame(r.current),"recent":frame(r.recent),"next":frame(r.next)})).collect::<Vec<_>>(),
        "occupancy": result.occupancy.into_iter().map(|p| json!({"place":p.place,"agentHandles":p.agent_handles})).collect::<Vec<_>>(),
        "sharedActivities": result.shared_activities.into_iter().map(|a| json!({"activityRef":a.activity_ref,"initiatorHandle":a.initiator_handle,"recipientHandle":a.recipient_handle,"place":a.place,"activity":a.activity,"state":a.state,"startsAt":time(a.starts_at),"endsAt":time(a.ends_at),"acceptedAt":time(a.accepted_at)})).collect::<Vec<_>>()
    }))
}

pub(super) async fn update(
    channel: Channel,
    value: Value,
) -> Result<Value, LocalAppOperationError> {
    let update: Update = serde_json::from_value(value).map_err(|_| invalid_payload())?;
    let expected_revision = update
        .expected_revision
        .parse()
        .map_err(|_| invalid_payload())?;
    let intent = match update.intent {
        Change::SelectPreset { preset } => Intent::SelectPreset(preset),
        Change::RestoreDefault => Intent::RestoreDefault(true),
        Change::Outdoor { open } => Intent::OutdoorOpen(open),
        Change::Public { enabled } => Intent::PublicParticipation(enabled),
        Change::Solitude {
            agent_handle,
            solitary,
        } => Intent::Solitude(LocalAppAgentUtopiaSolitude {
            agent_handle,
            solitary,
        }),
    };
    let request = UpdateLocalAppAgentUtopiaSettingsRequest {
        expected_revision,
        intent: Some(intent),
    };
    let result = crate::grpc_limits::runtime_agent_client(channel)
        .update_local_app_agent_utopia_settings(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(project_settings(result.settings.ok_or_else(untrusted)?))
}
