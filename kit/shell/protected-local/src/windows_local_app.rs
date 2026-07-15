use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use prost_types::{value::Kind as ProtoValueKind, Struct as ProtoStruct, Value as ProtoValue};
use serde_json::{json, Map as JsonMap, Number as JsonNumber, Value as JsonValue};
use tokio::sync::Mutex;
use tonic::transport::Channel;
use tonic::Streaming;

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::runtime_artifact_service_client::RuntimeArtifactServiceClient;
use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::{
    AppMessageEvent, GetLocalAppGrantStatusRequest, GetPublicChatSessionSnapshotRequest,
    LocalAppGrantProjection, OpenConversationAnchorRequest, OpenLocalAppSessionRequest,
    ReadArtifactBytesRequest, ReadArtifactBytesResponse, ReasonCode, RequestLocalAppGrantRequest,
    SendAppMessageRequest, SubscribeAppMessagesRequest,
};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::windows_peer_trust::VerifiedRuntimePeer;
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    LocalAppAgentConversationSnapshotRequest, LocalAppAgentOpenConversationRequest,
    LocalAppAgentProjection, LocalAppAgentSendTurnRequest, LocalAppAgentSubscribeTurnRequest,
    LocalAppArtifactBytes, LocalAppArtifactReadRequest, LocalAppOperationError,
    LocalAppPermissionPosture, LocalAppPermissionPostureRequest, LocalAppPermissionRequest,
    LocalAppPermissionState, LocalAppReasonCode, LocalAppSessionState, LocalAppSessionStatus,
    NimiLocalAppCarrier, NimiLocalAppSession,
};

#[cfg(not(feature = "windows-e2e-fixture"))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-local-app-v1";
#[cfg(feature = "windows-e2e-fixture")]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-e2e-local-app-v1";

const ACTION_EXECUTED: i32 = 1;
const LOCAL_APP_SESSION_READY: i32 = 1;
const LOCAL_APP_TRUST_LOCAL_DEVELOPMENT: i32 = 3;
const MAX_INLINE_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;
const RUNTIME_AGENT_TARGET: &str = "runtime.agent";
const RUNTIME_AGENT_TURN_REQUEST: &str = "runtime.agent.turn.request";

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsLocalAppCarrier;

struct TurnStreamState {
    stream: Streaming<AppMessageEvent>,
    last_sequence: u64,
}

struct WindowsLocalAppSession {
    channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    _runtime_boot_epoch: [u8; 32],
    turn_streams: Mutex<HashMap<String, std::sync::Arc<Mutex<TurnStreamState>>>>,
}

impl NimiLocalAppSession for WindowsLocalAppSession {
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async {
            Ok(LocalAppSessionStatus {
                state: LocalAppSessionState::ZeroGrant,
                reason_code: LocalAppReasonCode::NoGrant,
                retryable: false,
            })
        })
    }

    fn permission_posture(
        &self,
        request: LocalAppPermissionPostureRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionPosture, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(local_app_permission_posture(self.channel.clone(), request))
    }

    fn permission_request(
        &self,
        request: LocalAppPermissionRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppPermissionPosture, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(request_local_app_permission(self.channel.clone(), request))
    }

    fn artifacts_read_runtime_bytes(
        &self,
        request: LocalAppArtifactReadRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppArtifactBytes, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(read_local_app_artifact(self.channel.clone(), request))
    }

    fn agent_open_conversation(
        &self,
        request: LocalAppAgentOpenConversationRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(open_local_app_conversation(self.channel.clone(), request))
    }

    fn agent_send_turn(
        &self,
        request: LocalAppAgentSendTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(send_local_app_turn(self.channel.clone(), request))
    }

    fn agent_subscribe_turn(
        &self,
        request: LocalAppAgentSubscribeTurnRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(self.subscribe_local_app_turn(request))
    }

    fn agent_get_conversation_snapshot(
        &self,
        request: LocalAppAgentConversationSnapshotRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppAgentProjection, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(get_local_app_conversation_snapshot(
            self.channel.clone(),
            request,
        ))
    }
}

impl WindowsLocalAppSession {
    async fn subscribe_local_app_turn(
        &self,
        request: LocalAppAgentSubscribeTurnRequest,
    ) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
        require_text(&request.agent_id)?;
        require_text(&request.conversation_anchor_id)?;
        let expected_cursor = if request.cursor.is_empty() {
            None
        } else {
            Some(
                request
                    .cursor
                    .parse::<u64>()
                    .map_err(|_| invalid_payload())?,
            )
        };
        let key = format!(
            "{}\u{0}{}",
            request.agent_id, request.conversation_anchor_id
        );
        let state = {
            let mut streams = self.turn_streams.lock().await;
            if let Some(state) = streams.get(&key) {
                state.clone()
            } else {
                if expected_cursor.is_some() {
                    return Err(invalid_payload());
                }
                let stream = RuntimeAppServiceClient::new(self.channel.clone())
                    .subscribe_app_messages(SubscribeAppMessagesRequest {
                        app_id: String::new(),
                        subject_user_id: String::new(),
                        cursor: String::new(),
                        from_app_ids: vec![RUNTIME_AGENT_TARGET.to_string()],
                        scoped_binding: None,
                        local_agent_ref: request.agent_id.clone(),
                        conversation_anchor_id: request.conversation_anchor_id.clone(),
                    })
                    .await
                    .map_err(local_app_error_from_status)?
                    .into_inner();
                let state = std::sync::Arc::new(Mutex::new(TurnStreamState {
                    stream,
                    last_sequence: 0,
                }));
                streams.insert(key, state.clone());
                state
            }
        };
        let mut state = state.lock().await;
        if expected_cursor.is_some_and(|cursor| cursor != state.last_sequence) {
            return Err(invalid_payload());
        }
        let event = state
            .stream
            .message()
            .await
            .map_err(local_app_error_from_status)?
            .ok_or_else(|| {
                LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
            })?;
        if event.sequence == 0 || event.sequence <= state.last_sequence {
            return Err(untrusted());
        }
        validate_turn_event_correlation(&event, &request)?;
        state.last_sequence = event.sequence;
        let projected = project_app_message_event(event)?;
        Ok(LocalAppAgentProjection {
            value: json!({
                "cursor": state.last_sequence.to_string(),
                "events": [projected],
            }),
        })
    }
}

impl NimiLocalAppCarrier for WindowsLocalAppCarrier {
    fn open_local_app_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(open_local_app_session())
    }
}

async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let (channel, runtime_peer) = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let response = RuntimeAuthServiceClient::new(channel.clone())
        .open_local_app_session(OpenLocalAppSessionRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.state != LOCAL_APP_SESSION_READY
        || response.trust_class != LOCAL_APP_TRUST_LOCAL_DEVELOPMENT
        || response.account_generation == 0
        || response.reason_code != ACTION_EXECUTED
    {
        return Err(untrusted());
    }
    let runtime_boot_epoch: [u8; 32] = response
        .runtime_boot_epoch
        .try_into()
        .map_err(|_| untrusted())?;
    if runtime_boot_epoch == [0u8; 32] {
        return Err(untrusted());
    }
    Ok(Box::new(WindowsLocalAppSession {
        channel,
        _runtime_peer: runtime_peer,
        _runtime_boot_epoch: runtime_boot_epoch,
        turn_streams: Mutex::new(HashMap::new()),
    }))
}

async fn open_local_app_runtime_channel(
) -> Result<(Channel, VerifiedRuntimePeer), crate::ProtectedCarrierError> {
    with_one_unavailable_retry(
        || open_verified_runtime_channel(RUNTIME_LOCAL_APP_PIPE_NAME),
        Duration::from_millis(100),
    )
    .await
}

async fn with_one_unavailable_retry<T, F, Fut>(
    mut open: F,
    retry_delay: Duration,
) -> Result<T, crate::ProtectedCarrierError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, crate::ProtectedCarrierError>>,
{
    match open().await {
        Ok(value) => Ok(value),
        Err(error)
            if error.reason_code()
                == crate::ProtectedCarrierReasonCode::RuntimeServiceUnavailable
                && error.retryable() =>
        {
            tokio::time::sleep(retry_delay).await;
            open().await
        }
        Err(error) => Err(error),
    }
}

async fn local_app_permission_posture(
    channel: Channel,
    request: LocalAppPermissionPostureRequest,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    require_text(&request.operation_id)?;
    if !request.resource_ref.is_empty() {
        require_text(&request.resource_ref)?;
    }
    let response = RuntimeAccountServiceClient::new(channel)
        .get_local_app_grant_status(GetLocalAppGrantStatusRequest {
            operation_id: request.operation_id.clone(),
            resource_ref: request.resource_ref.clone(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_permission_posture(
        response.projection.ok_or_else(untrusted)?,
        request.operation_id,
        request.resource_ref,
    )
}

async fn request_local_app_permission(
    channel: Channel,
    request: LocalAppPermissionRequest,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    require_text(&request.operation_id)?;
    require_text(&request.resource_ref)?;
    require_text(&request.purpose)?;
    let response = RuntimeAccountServiceClient::new(channel)
        .request_local_app_grant(RequestLocalAppGrantRequest {
            operation_id: request.operation_id.clone(),
            resource_ref: request.resource_ref.clone(),
            purpose: request.purpose,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let projection = project_permission_posture(
        response.projection.ok_or_else(untrusted)?,
        request.operation_id,
        request.resource_ref,
    )?;
    require_pending_permission(projection)
}

fn require_pending_permission(
    projection: LocalAppPermissionPosture,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    if projection.state != LocalAppPermissionState::Pending {
        return Err(LocalAppOperationError::new(
            projection.reason_code,
            projection.retryable,
        ));
    }
    Ok(projection)
}

fn project_permission_posture(
    projection: LocalAppGrantProjection,
    operation_id: String,
    resource_ref: String,
) -> Result<LocalAppPermissionPosture, LocalAppOperationError> {
    if projection.operation_id != operation_id || projection.resource_ref != resource_ref {
        return Err(untrusted());
    }
    let runtime_reason = ReasonCode::try_from(projection.reason_code).map_err(|_| untrusted())?;
    let (state, reason_code, action_hint, retryable) = match (projection.state, runtime_reason) {
        (1, ReasonCode::LocalAppGrantRequired) => (
            LocalAppPermissionState::ZeroGrant,
            LocalAppReasonCode::NoGrant,
            "request_local_app_operation_grant",
            false,
        ),
        (2, ReasonCode::LocalAppPresenceRequired) => (
            LocalAppPermissionState::Pending,
            LocalAppReasonCode::NoGrant,
            "await_local_app_grant_decision",
            true,
        ),
        (3, ReasonCode::ActionExecuted) => (
            LocalAppPermissionState::Granted,
            LocalAppReasonCode::ActionExecuted,
            "continue_local_app_operation",
            false,
        ),
        (4, _) => {
            let reason =
                local_app_reason_from_proto(projection.reason_code).ok_or_else(untrusted)?;
            if !matches!(
                reason,
                LocalAppReasonCode::RuntimePermissionDenied
                    | LocalAppReasonCode::RuntimeUnauthenticated
                    | LocalAppReasonCode::ProcessReplaced
                    | LocalAppReasonCode::AccountChanged
                    | LocalAppReasonCode::Revoked
                    | LocalAppReasonCode::NoGrant
            ) {
                return Err(untrusted());
            }
            (
                LocalAppPermissionState::Denied,
                reason,
                "request_local_app_operation_grant",
                false,
            )
        }
        (5, ReasonCode::LocalAppPresenceExpired) => (
            LocalAppPermissionState::Revoked,
            LocalAppReasonCode::PresenceExpired,
            "request_local_app_operation_grant",
            false,
        ),
        (6, ReasonCode::LocalAppGrantRevoked) => (
            LocalAppPermissionState::Revoked,
            LocalAppReasonCode::GrantRevoked,
            "request_local_app_operation_grant",
            false,
        ),
        (7, ReasonCode::LocalAppGrantSuperseded) => (
            LocalAppPermissionState::Superseded,
            LocalAppReasonCode::GrantSuperseded,
            "refresh_local_app_permission_posture",
            false,
        ),
        _ => return Err(untrusted()),
    };
    Ok(LocalAppPermissionPosture {
        state,
        operation_id,
        resource_ref,
        reason_code,
        action_hint: action_hint.to_string(),
        retryable,
    })
}

async fn read_local_app_artifact(
    channel: Channel,
    request: LocalAppArtifactReadRequest,
) -> Result<LocalAppArtifactBytes, LocalAppOperationError> {
    require_text(&request.artifact_id)?;
    let response = RuntimeArtifactServiceClient::new(channel)
        .read_artifact_bytes(ReadArtifactBytesRequest {
            artifact_id: request.artifact_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    validate_artifact_response(response)
}

fn validate_artifact_response(
    response: ReadArtifactBytesResponse,
) -> Result<LocalAppArtifactBytes, LocalAppOperationError> {
    let observed_size = i64::try_from(response.bytes.len()).map_err(|_| untrusted())?;
    if response.bytes.len() > MAX_INLINE_ARTIFACT_BYTES
        || response.size_bytes < 0
        || response.size_bytes != observed_size
        || response.mime_type.is_empty()
        || response.mime_type.trim() != response.mime_type
        || !response.mime_type.contains('/')
    {
        return Err(untrusted());
    }
    Ok(LocalAppArtifactBytes {
        bytes: response.bytes,
        mime_type: response.mime_type,
        size_bytes: response.size_bytes,
        mime_inferred: response.mime_inferred,
    })
}

async fn open_local_app_conversation(
    channel: Channel,
    request: LocalAppAgentOpenConversationRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    require_text(&request.agent_id)?;
    if request.requested_anchor_disposition != "create-or-resume"
        && request.requested_anchor_disposition != "create-new"
    {
        return Err(invalid_payload());
    }
    let response = RuntimeAgentServiceClient::new(channel)
        .open_conversation_anchor(OpenConversationAnchorRequest {
            context: None,
            agent_id: request.agent_id.clone(),
            subject_user_id: String::new(),
            metadata: Some(proto_struct(json!({
                "local_app_anchor_disposition": request.requested_anchor_disposition,
            }))?),
            local_agent_ref: String::new(),
            owner_user_id: String::new(),
            runtime_source_ref: String::new(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let value = project_conversation_anchor_snapshot(
        response.snapshot.ok_or_else(untrusted)?,
        &request.agent_id,
        None,
    )?;
    Ok(LocalAppAgentProjection { value })
}

async fn send_local_app_turn(
    channel: Channel,
    request: LocalAppAgentSendTurnRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    for value in [
        request.agent_id.as_str(),
        request.conversation_anchor_id.as_str(),
        request.client_turn_id.as_str(),
        request.user_text.as_str(),
    ] {
        require_text(value)?;
    }
    let payload = proto_struct(json!({
        "local_agent_ref": request.agent_id,
        "conversation_anchor_id": request.conversation_anchor_id,
        "request_id": request.client_turn_id,
        "messages": [{"role": "user", "content": request.user_text}],
    }))?;
    let response = RuntimeAppServiceClient::new(channel)
        .send_app_message(SendAppMessageRequest {
            from_app_id: String::new(),
            to_app_id: RUNTIME_AGENT_TARGET.to_string(),
            subject_user_id: String::new(),
            message_type: RUNTIME_AGENT_TURN_REQUEST.to_string(),
            payload: Some(payload),
            require_ack: true,
            scoped_binding: None,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if !response.accepted || response.message_id.trim().is_empty() {
        return Err(local_app_reason_from_proto(response.reason_code)
            .map(|reason| LocalAppOperationError::new(reason, false))
            .unwrap_or_else(untrusted));
    }
    Ok(LocalAppAgentProjection {
        value: json!({
            "messageId": response.message_id,
            "accepted": true,
            "reasonCode": response.reason_code,
        }),
    })
}

async fn get_local_app_conversation_snapshot(
    channel: Channel,
    request: LocalAppAgentConversationSnapshotRequest,
) -> Result<LocalAppAgentProjection, LocalAppOperationError> {
    require_text(&request.agent_id)?;
    require_text(&request.conversation_anchor_id)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_public_chat_session_snapshot(GetPublicChatSessionSnapshotRequest {
            context: None,
            agent_id: request.agent_id.clone(),
            conversation_anchor_id: request.conversation_anchor_id.clone(),
            request_id: String::new(),
            world_id: String::new(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let value = proto_struct_to_json(response.snapshot.ok_or_else(untrusted)?)?;
    validate_safe_projection(&value)?;
    Ok(LocalAppAgentProjection { value })
}

fn project_conversation_anchor_snapshot(
    snapshot: crate::generated::ConversationAnchorSnapshot,
    expected_agent_id: &str,
    expected_anchor_id: Option<&str>,
) -> Result<JsonValue, LocalAppOperationError> {
    let anchor = snapshot.anchor.ok_or_else(untrusted)?;
    require_text(&anchor.conversation_anchor_id)?;
    if anchor.agent_id != expected_agent_id
        || expected_anchor_id.is_some_and(|expected| expected != anchor.conversation_anchor_id)
    {
        return Err(untrusted());
    }
    let metadata = anchor
        .metadata
        .map(proto_struct_to_json)
        .transpose()?
        .unwrap_or_else(|| json!({}));
    validate_safe_projection(&metadata)?;
    let value = json!({
        "anchor": {
            "conversationAnchorId": anchor.conversation_anchor_id,
            "agentId": anchor.agent_id,
            "status": anchor.status,
            "lastTurnId": anchor.last_turn_id,
            "lastMessageId": anchor.last_message_id,
            "createdAt": timestamp_projection(anchor.created_at),
            "updatedAt": timestamp_projection(anchor.updated_at),
            "metadata": metadata,
            "localAgentRef": anchor.local_agent_ref,
        },
        "activeTurnId": snapshot.active_turn_id,
        "activeStreamId": snapshot.active_stream_id,
    });
    validate_safe_projection(&value)?;
    Ok(value)
}

fn validate_turn_event_correlation(
    event: &AppMessageEvent,
    request: &LocalAppAgentSubscribeTurnRequest,
) -> Result<(), LocalAppOperationError> {
    if !event.message_type.starts_with("runtime.agent.turn.") {
        return Err(untrusted());
    }
    let payload = event.payload.as_ref().ok_or_else(untrusted)?;
    let anchor = proto_struct_text(payload, "conversation_anchor_id")
        .or_else(|| proto_struct_text(payload, "conversationAnchorId"))
        .ok_or_else(untrusted)?;
    let agent = proto_struct_text(payload, "local_agent_ref")
        .or_else(|| proto_struct_text(payload, "localAgentRef"))
        .ok_or_else(untrusted)?;
    if anchor != request.conversation_anchor_id || agent != request.agent_id {
        return Err(untrusted());
    }
    Ok(())
}

fn project_app_message_event(event: AppMessageEvent) -> Result<JsonValue, LocalAppOperationError> {
    let payload = event
        .payload
        .map(proto_struct_to_json)
        .transpose()?
        .unwrap_or_else(|| json!({}));
    validate_safe_projection(&payload)?;
    let value = json!({
        "eventType": event.event_type,
        "sequence": event.sequence.to_string(),
        "messageId": event.message_id,
        "messageType": event.message_type,
        "payload": payload,
        "reasonCode": event.reason_code,
        "traceId": event.trace_id,
        "timestamp": timestamp_projection(event.timestamp),
    });
    validate_safe_projection(&value)?;
    Ok(value)
}

fn proto_struct(value: JsonValue) -> Result<ProtoStruct, LocalAppOperationError> {
    let JsonValue::Object(fields) = value else {
        return Err(invalid_payload());
    };
    Ok(ProtoStruct {
        fields: fields
            .into_iter()
            .map(|(key, value)| json_to_proto_value(value).map(|value| (key, value)))
            .collect::<Result<_, _>>()?,
    })
}

fn json_to_proto_value(value: JsonValue) -> Result<ProtoValue, LocalAppOperationError> {
    let kind = match value {
        JsonValue::Null => ProtoValueKind::NullValue(0),
        JsonValue::Bool(value) => ProtoValueKind::BoolValue(value),
        JsonValue::Number(value) => {
            ProtoValueKind::NumberValue(value.as_f64().ok_or_else(invalid_payload)?)
        }
        JsonValue::String(value) => ProtoValueKind::StringValue(value),
        JsonValue::Array(values) => ProtoValueKind::ListValue(prost_types::ListValue {
            values: values
                .into_iter()
                .map(json_to_proto_value)
                .collect::<Result<_, _>>()?,
        }),
        JsonValue::Object(fields) => ProtoValueKind::StructValue(ProtoStruct {
            fields: fields
                .into_iter()
                .map(|(key, value)| json_to_proto_value(value).map(|value| (key, value)))
                .collect::<Result<_, _>>()?,
        }),
    };
    Ok(ProtoValue { kind: Some(kind) })
}

fn proto_struct_to_json(value: ProtoStruct) -> Result<JsonValue, LocalAppOperationError> {
    let mut nodes = 0usize;
    proto_struct_to_json_bounded(value, 0, &mut nodes)
}

fn proto_struct_to_json_bounded(
    value: ProtoStruct,
    depth: usize,
    nodes: &mut usize,
) -> Result<JsonValue, LocalAppOperationError> {
    if depth > MAX_JSON_DEPTH {
        return Err(untrusted());
    }
    let fields = value
        .fields
        .into_iter()
        .map(|(key, value)| {
            proto_value_to_json_bounded(value, depth + 1, nodes).map(|value| (key, value))
        })
        .collect::<Result<JsonMap<_, _>, _>>()?;
    Ok(JsonValue::Object(fields))
}

fn proto_value_to_json_bounded(
    value: ProtoValue,
    depth: usize,
    nodes: &mut usize,
) -> Result<JsonValue, LocalAppOperationError> {
    *nodes = nodes.checked_add(1).ok_or_else(untrusted)?;
    if *nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH {
        return Err(untrusted());
    }
    match value.kind.ok_or_else(untrusted)? {
        ProtoValueKind::NullValue(_) => Ok(JsonValue::Null),
        ProtoValueKind::NumberValue(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(untrusted),
        ProtoValueKind::StringValue(value) => Ok(JsonValue::String(value)),
        ProtoValueKind::BoolValue(value) => Ok(JsonValue::Bool(value)),
        ProtoValueKind::StructValue(value) => proto_struct_to_json_bounded(value, depth, nodes),
        ProtoValueKind::ListValue(value) => Ok(JsonValue::Array(
            value
                .values
                .into_iter()
                .map(|value| proto_value_to_json_bounded(value, depth + 1, nodes))
                .collect::<Result<_, _>>()?,
        )),
    }
}

fn proto_struct_text<'a>(value: &'a ProtoStruct, key: &str) -> Option<&'a str> {
    match value.fields.get(key)?.kind.as_ref()? {
        ProtoValueKind::StringValue(value) if !value.is_empty() => Some(value),
        _ => None,
    }
}

fn timestamp_projection(value: Option<prost_types::Timestamp>) -> JsonValue {
    value.map_or(
        JsonValue::Null,
        |value| json!({"seconds": value.seconds.to_string(), "nanos": value.nanos}),
    )
}

fn validate_safe_projection(value: &JsonValue) -> Result<(), LocalAppOperationError> {
    match value {
        JsonValue::Array(values) => {
            for value in values {
                validate_safe_projection(value)?;
            }
        }
        JsonValue::Object(fields) => {
            for (key, value) in fields {
                let normalized = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect::<String>();
                if matches!(
                    normalized.as_str(),
                    "endpoint"
                        | "authorization"
                        | "token"
                        | "localappprincipalid"
                        | "localapprecordid"
                        | "trustclass"
                        | "provenancerevision"
                        | "launchlease"
                        | "bootstrap"
                        | "processid"
                        | "sessionid"
                        | "sessionproof"
                        | "accountid"
                        | "grantid"
                        | "runtimebootepoch"
                ) {
                    return Err(untrusted());
                }
                validate_safe_projection(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn require_text(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() || value.trim() != value {
        return Err(invalid_payload());
    }
    Ok(())
}

fn local_app_error_from_protected(error: crate::ProtectedCarrierError) -> LocalAppOperationError {
    let reason = match error.reason_code() {
        crate::ProtectedCarrierReasonCode::ProtectedCarrierRequired => {
            LocalAppReasonCode::ProtectedCarrierRequired
        }
        crate::ProtectedCarrierReasonCode::RuntimeServiceUnavailable => {
            LocalAppReasonCode::RuntimeServiceUnavailable
        }
        crate::ProtectedCarrierReasonCode::RuntimeServiceUntrusted => {
            LocalAppReasonCode::RuntimeServiceUntrusted
        }
        crate::ProtectedCarrierReasonCode::RuntimeServiceRepairRequired => {
            LocalAppReasonCode::RuntimeServiceRepairRequired
        }
    };
    LocalAppOperationError::new(reason, error.retryable())
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
    use std::collections::VecDeque;

    #[tokio::test]
    async fn local_app_channel_retries_one_exact_unavailable_handshake() {
        let mut outcomes = VecDeque::from([
            Err(crate::ProtectedCarrierError::new(
                crate::ProtectedCarrierReasonCode::RuntimeServiceUnavailable,
                true,
            )),
            Ok(7u8),
        ]);
        let result = with_one_unavailable_retry(
            || std::future::ready(outcomes.pop_front().expect("bounded outcome")),
            Duration::ZERO,
        )
        .await
        .expect("one unavailable retry");
        assert_eq!(result, 7);
        assert!(outcomes.is_empty());
    }

    #[tokio::test]
    async fn local_app_channel_never_retries_untrusted_failures() {
        let mut calls = 0;
        let error = with_one_unavailable_retry(
            || {
                calls += 1;
                std::future::ready(Err::<u8, _>(crate::ProtectedCarrierError::new(
                    crate::ProtectedCarrierReasonCode::RuntimeServiceUntrusted,
                    false,
                )))
            },
            Duration::ZERO,
        )
        .await
        .expect_err("untrusted failure");
        assert_eq!(calls, 1);
        assert_eq!(
            error.reason_code(),
            crate::ProtectedCarrierReasonCode::RuntimeServiceUntrusted
        );
    }

    #[test]
    fn artifact_response_requires_exact_size_and_mime() {
        let value = validate_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        })
        .expect("valid artifact");
        assert_eq!(value.bytes, b"artifact");

        let error = validate_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 7,
            mime_inferred: false,
        })
        .expect_err("mismatched size");
        assert_eq!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeServiceUntrusted
        );
    }

    #[test]
    fn projection_rejects_authority_keys_at_any_depth() {
        for value in [
            json!({"sessionId": "forbidden"}),
            json!({"nested": [{"grant_id": "forbidden"}]}),
            json!({"nested": {"runtime_boot_epoch": "forbidden"}}),
        ] {
            assert_eq!(
                validate_safe_projection(&value).unwrap_err().reason_code(),
                LocalAppReasonCode::RuntimeServiceUntrusted,
            );
        }
        assert!(validate_safe_projection(&json!({"conversationAnchorId": "anchor-a"})).is_ok());
    }

    #[test]
    fn denied_permission_request_preserves_the_runtime_projection_reason() {
        let denied = project_permission_posture(
            LocalAppGrantProjection {
                state: 4,
                operation_id: "runtime_agent.conversation.open".to_string(),
                resource_ref: "agent-a".to_string(),
                request_id: Vec::new(),
                grant_id: Vec::new(),
                presence_challenge_id: Vec::new(),
                grant_generation: 0,
                grant_revision: 0,
                expires_at: None,
                reason_code: 655,
            },
            "runtime_agent.conversation.open".to_string(),
            "agent-a".to_string(),
        )
        .expect("denied projection");
        let error = require_pending_permission(denied).expect_err("request must stay denied");
        assert_eq!(
            error.reason_code(),
            LocalAppReasonCode::RuntimePermissionDenied
        );
    }

    #[test]
    fn permission_projection_preserves_terminal_reason_matrix() {
        for (state, runtime_reason, expected) in [
            (4, 651, LocalAppReasonCode::NoGrant),
            (5, 657, LocalAppReasonCode::PresenceExpired),
            (6, 652, LocalAppReasonCode::GrantRevoked),
            (7, 653, LocalAppReasonCode::GrantSuperseded),
        ] {
            let projection = project_permission_posture(
                LocalAppGrantProjection {
                    state,
                    operation_id: "runtime_agent.conversation.open".to_string(),
                    resource_ref: "agent-a".to_string(),
                    request_id: Vec::new(),
                    grant_id: Vec::new(),
                    presence_challenge_id: Vec::new(),
                    grant_generation: 1,
                    grant_revision: 1,
                    expires_at: None,
                    reason_code: runtime_reason,
                },
                "runtime_agent.conversation.open".to_string(),
                "agent-a".to_string(),
            )
            .expect("terminal projection");
            assert_eq!(projection.reason_code, expected);
        }
        assert!(project_permission_posture(
            LocalAppGrantProjection {
                state: 4,
                operation_id: "runtime_agent.conversation.open".to_string(),
                resource_ref: "agent-a".to_string(),
                request_id: Vec::new(),
                grant_id: Vec::new(),
                presence_challenge_id: Vec::new(),
                grant_generation: 1,
                grant_revision: 1,
                expires_at: None,
                reason_code: 652,
            },
            "runtime_agent.conversation.open".to_string(),
            "agent-a".to_string(),
        )
        .is_err());
        assert!(project_permission_posture(
            LocalAppGrantProjection {
                state: 6,
                operation_id: "runtime_agent.conversation.open".to_string(),
                resource_ref: "agent-a".to_string(),
                request_id: Vec::new(),
                grant_id: Vec::new(),
                presence_challenge_id: Vec::new(),
                grant_generation: 1,
                grant_revision: 1,
                expires_at: None,
                reason_code: 651,
            },
            "runtime_agent.conversation.open".to_string(),
            "agent-a".to_string(),
        )
        .is_err());
    }

    #[test]
    fn permission_projection_preserves_exact_operation_binding() {
        let projection = project_permission_posture(
            LocalAppGrantProjection {
                state: 1,
                operation_id: "runtime_agent.conversation.open".to_string(),
                resource_ref: "agent-a".to_string(),
                request_id: Vec::new(),
                grant_id: Vec::new(),
                presence_challenge_id: Vec::new(),
                grant_generation: 0,
                grant_revision: 0,
                expires_at: None,
                reason_code: 651,
            },
            "runtime_agent.conversation.open".to_string(),
            "agent-a".to_string(),
        )
        .expect("zero-grant projection");
        assert_eq!(projection.state, LocalAppPermissionState::ZeroGrant);
        assert_eq!(projection.reason_code, LocalAppReasonCode::NoGrant);
    }
}
