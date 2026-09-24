use serde_json::{json, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::open_app_activity_response::Event as OpenEvent;
use crate::generated::{
    AppActivityAgentAssociation, AppActivityChangeKind, AppActivityFilter, AppActivityKind,
    AppActivityOpenCompletion, AppActivityOpenOutcome, AppActivityOpenReason,
    AppActivityOpenResult, AppActivityRecord, AppActivitySource, AppActivitySourceKind,
    AppActivityTodoState, AppActivityUserView, CompleteAppActivityOpenRequestRequest,
    ListAppActivitiesRequest, MarkAppActivityReadRequest, OpenAppActivityRequest,
    OpenAppActivityResponse, PutAppActivityRequest, SubscribeAppActivityChangesRequest,
    SubscribeAppActivityChangesResponse, SubscribeAppActivityOpenRequestsRequest,
    SubscribeAppActivityOpenRequestsResponse,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppActivityListRequest, LocalAppActivityMarkReadRequest, LocalAppActivityOpenRequest,
    LocalAppActivityOpenRequestCompleteRequest, LocalAppActivityPutRequest,
    LocalAppActivitySubscribeRequest, LocalAppActivityTimestamp, LocalAppOperationError,
    LocalAppRealtimeSubscriptionReceiver,
};

use super::{invalid_payload, untrusted};

/// Largest revision every JSON consumer represents exactly.
const MAX_SAFE_REVISION: u64 = (1 << 53) - 1;
const MAX_PAGE_RECORDS: usize = 100;
const MAX_OPEN_REQUEST_ID_BYTES: usize = 64;
const OPEN_REQUEST_ID_PREFIX: &str = "aor_";
const STREAM_BUFFER: usize = 32;

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-044
pub(super) async fn put(
    channel: Channel,
    request: LocalAppActivityPutRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let kind = kind_from_text(&request.kind)?;
    let todo_state = match request.todo_state.as_deref() {
        Some(value) => todo_state_from_text(value)?,
        None => AppActivityTodoState::Unspecified,
    };
    let response = crate::grpc_limits::runtime_app_activity_client(channel)
        .put_app_activity(PutAppActivityRequest {
            key: request.key,
            revision: request.revision,
            kind: kind as i32,
            todo_state: todo_state as i32,
            attention: request.attention,
            title: request.title,
            summary: request.summary.unwrap_or_default(),
            object_ref: request.object_ref.unwrap_or_default(),
            activity_type: request.activity_type,
            data_json: request.data_json.unwrap_or_default(),
            occurred_at: Some(prost_types::Timestamp {
                seconds: request.occurred_at_seconds,
                nanos: request.occurred_at_nanos,
            }),
            agent_handle: request.agent_handle.unwrap_or_default(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({
        "record": project_record(response.record.ok_or_else(untrusted)?)?,
        "changed": response.changed,
    }))
}

pub(super) async fn list(
    channel: Channel,
    request: LocalAppActivityListRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let kind = match request.kind.as_deref() {
        Some(value) => kind_from_text(value)?,
        None => AppActivityKind::Unspecified,
    };
    let todo_states = request
        .todo_states
        .iter()
        .map(|value| todo_state_from_text(value).map(|state| state as i32))
        .collect::<Result<Vec<_>, _>>()?;
    let response = crate::grpc_limits::runtime_app_activity_client(channel)
        .list_app_activities(ListAppActivitiesRequest {
            filter: Some(AppActivityFilter {
                source_ref: request.source_ref.unwrap_or_default(),
                kind: kind as i32,
                todo_states,
                agent_ref: request.agent_ref.unwrap_or_default(),
                occurred_after: request.occurred_after.map(proto_timestamp),
                occurred_before: request.occurred_before.map(proto_timestamp),
            }),
            page_size: request.page_size,
            page_token: request.page_token.unwrap_or_default(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.records.len() > MAX_PAGE_RECORDS {
        return Err(untrusted());
    }
    let records = response
        .records
        .into_iter()
        .map(project_record)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "records": records,
        "nextPageToken": optional_text(response.next_page_token),
        "baselineChangeSeq": response.baseline_change_seq.to_string(),
    }))
}

pub(super) async fn subscribe_changes(
    channel: Channel,
    request: LocalAppActivitySubscribeRequest,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    let stream = crate::grpc_limits::runtime_app_activity_client(channel)
        .subscribe_app_activity_changes(SubscribeAppActivityChangesRequest {
            after_change_seq: request.after_change_seq,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(forward(stream, project_change))
}

pub(super) async fn mark_read(
    channel: Channel,
    request: LocalAppActivityMarkReadRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let response = crate::grpc_limits::runtime_app_activity_client(channel)
        .mark_app_activity_read(MarkAppActivityReadRequest {
            activity_id: request.activity_id,
            displayed_revision: request.displayed_revision,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_record(response.record.ok_or_else(untrusted)?)
}

/// Carries the Runtime source-open stream: at most one Host-private open
/// request id followed by exactly one typed result. The receiving Host
/// consumes the id for the Desktop launch; dropping the receiver cancels the
/// Runtime stream and therefore the pending open request.
pub(super) async fn open(
    channel: Channel,
    request: LocalAppActivityOpenRequest,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    let mut stream = crate::grpc_limits::runtime_app_activity_client(channel)
        .open_app_activity(OpenAppActivityRequest {
            activity_id: request.activity_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(2);
    tokio::spawn(async move {
        let mut open_request_seen = false;
        loop {
            let next = tokio::select! {
                _ = sender.closed() => break,
                next = stream.message() => next,
            };
            match next {
                Ok(Some(event)) => {
                    let projected = project_open_event(event, &mut open_request_seen);
                    let pending = matches!(
                        &projected,
                        Ok(value) if value.get("openRequestId").is_some()
                    );
                    if sender.send(projected).await.is_err() || !pending {
                        break;
                    }
                }
                Ok(None) => {
                    // Runtime ends a live source-open stream only after its
                    // typed result; a bare end is a contract violation.
                    let _ = sender.send(Err(untrusted())).await;
                    break;
                }
                Err(status) => {
                    let _ = sender.send(Err(local_app_error_from_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

pub(super) async fn subscribe_open_requests(
    channel: Channel,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    let stream = crate::grpc_limits::runtime_app_activity_client(channel)
        .subscribe_app_activity_open_requests(SubscribeAppActivityOpenRequestsRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(forward(stream, project_open_request))
}

pub(super) async fn complete_open_request(
    channel: Channel,
    request: LocalAppActivityOpenRequestCompleteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let completion = completion_from_text(&request.completion)?;
    let response = crate::grpc_limits::runtime_app_activity_client(channel)
        .complete_app_activity_open_request(CompleteAppActivityOpenRequestRequest {
            delivery_id: request.delivery_id,
            completion: completion as i32,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({ "accepted": response.accepted }))
}

/// Forwards one Runtime server stream item by item. A projection failure is
/// delivered once and ends the stream; a dropped receiver cancels the Runtime
/// stream promptly instead of waiting for its next item.
fn forward<T, F>(
    mut stream: tonic::Streaming<T>,
    project: F,
) -> LocalAppRealtimeSubscriptionReceiver
where
    T: Send + 'static,
    F: Fn(T) -> Result<JsonValue, LocalAppOperationError> + Send + 'static,
{
    let (sender, receiver) = mpsc::channel(STREAM_BUFFER);
    tokio::spawn(async move {
        loop {
            let next = tokio::select! {
                _ = sender.closed() => break,
                next = stream.message() => next,
            };
            match next {
                Ok(Some(item)) => {
                    let projected = project(item);
                    let failed = projected.is_err();
                    if sender.send(projected).await.is_err() || failed {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(local_app_error_from_status(status))).await;
                    break;
                }
            }
        }
    });
    receiver
}

fn project_record(value: AppActivityRecord) -> Result<JsonValue, LocalAppOperationError> {
    if value.activity_id.is_empty()
        || value.key.is_empty()
        || value.title.is_empty()
        || value.activity_type.is_empty()
        || value.change_seq == 0
        || value.revision == 0
        || value.revision > MAX_SAFE_REVISION
    {
        return Err(untrusted());
    }
    let (kind, todo_state) = match AppActivityKind::try_from(value.kind) {
        Ok(AppActivityKind::Activity) => {
            if value.todo_state != AppActivityTodoState::Unspecified as i32 {
                return Err(untrusted());
            }
            ("activity", JsonValue::Null)
        }
        Ok(AppActivityKind::Todo) => ("todo", JsonValue::from(todo_state_text(value.todo_state)?)),
        _ => return Err(untrusted()),
    };
    let user_view = project_user_view(value.user_view.ok_or_else(untrusted)?, value.revision)?;
    Ok(json!({
        "activityId": value.activity_id,
        "source": project_source(value.source.ok_or_else(untrusted)?)?,
        "key": value.key,
        "revision": value.revision,
        "kind": kind,
        "todoState": todo_state,
        "attention": value.attention,
        "title": value.title,
        "summary": optional_text(value.summary),
        "objectRef": optional_text(value.object_ref),
        "type": value.activity_type,
        // Publisher-owned JSON text; the carrier never interprets its keys.
        "dataJson": optional_text(value.data_json),
        "agent": value.agent.map(project_agent).transpose()?,
        "occurredAt": project_timestamp(value.occurred_at)?,
        "publishedAt": project_timestamp(value.published_at)?,
        "updatedAt": project_timestamp(value.updated_at)?,
        "changeSeq": value.change_seq.to_string(),
        "userView": user_view,
    }))
}

fn project_source(value: AppActivitySource) -> Result<JsonValue, LocalAppOperationError> {
    if value.source_ref.is_empty() {
        return Err(untrusted());
    }
    let kind = match AppActivitySourceKind::try_from(value.kind) {
        Ok(AppActivitySourceKind::App) => "app",
        Ok(AppActivitySourceKind::RuntimeAgent) => {
            if !value.app_id.is_empty() || !value.display_name.is_empty() {
                return Err(untrusted());
            }
            "runtime-agent"
        }
        _ => return Err(untrusted()),
    };
    Ok(json!({
        "kind": kind,
        "sourceRef": value.source_ref,
        "appId": optional_text(value.app_id),
        "displayName": optional_text(value.display_name),
        "available": value.available,
    }))
}

fn project_agent(value: AppActivityAgentAssociation) -> Result<JsonValue, LocalAppOperationError> {
    if value.agent_ref.is_empty() {
        return Err(untrusted());
    }
    Ok(json!({ "agentRef": value.agent_ref, "displayName": value.display_name }))
}

fn project_user_view(
    value: AppActivityUserView,
    revision: u64,
) -> Result<JsonValue, LocalAppOperationError> {
    if value.read_through_revision > revision {
        return Err(untrusted());
    }
    Ok(json!({
        "readThroughRevision": value.read_through_revision,
        "unread": value.unread,
        "needsAttention": value.needs_attention,
    }))
}

fn project_change(
    value: SubscribeAppActivityChangesResponse,
) -> Result<JsonValue, LocalAppOperationError> {
    if value.change_seq == 0 || value.activity_id.is_empty() {
        return Err(untrusted());
    }
    match AppActivityChangeKind::try_from(value.kind) {
        Ok(AppActivityChangeKind::Upsert) => {
            let record = value.record.ok_or_else(untrusted)?;
            if record.activity_id != value.activity_id || record.change_seq != value.change_seq {
                return Err(untrusted());
            }
            Ok(json!({
                "changeSeq": value.change_seq.to_string(),
                "kind": "upsert",
                "activityId": value.activity_id,
                "record": project_record(record)?,
            }))
        }
        Ok(AppActivityChangeKind::Remove) if value.record.is_none() => Ok(json!({
            "changeSeq": value.change_seq.to_string(),
            "kind": "remove",
            "activityId": value.activity_id,
        })),
        _ => Err(untrusted()),
    }
}

fn project_open_event(
    value: OpenAppActivityResponse,
    open_request_seen: &mut bool,
) -> Result<JsonValue, LocalAppOperationError> {
    match value.event.ok_or_else(untrusted)? {
        OpenEvent::OpenRequestId(open_request_id) => {
            if *open_request_seen || !valid_open_request_id(&open_request_id) {
                return Err(untrusted());
            }
            *open_request_seen = true;
            Ok(json!({ "openRequestId": open_request_id }))
        }
        OpenEvent::Result(result) => Ok(json!({ "result": project_open_result(result)? })),
    }
}

fn project_open_result(value: AppActivityOpenResult) -> Result<JsonValue, LocalAppOperationError> {
    let outcome = match AppActivityOpenOutcome::try_from(value.outcome) {
        Ok(AppActivityOpenOutcome::Opened) => "opened",
        Ok(AppActivityOpenOutcome::Unavailable) => "unavailable",
        Ok(AppActivityOpenOutcome::Failed) => "failed",
        _ => return Err(untrusted()),
    };
    let reason = match AppActivityOpenReason::try_from(value.reason) {
        Ok(AppActivityOpenReason::Opened) => "opened",
        Ok(AppActivityOpenReason::NotOpenable) => "not-openable",
        Ok(AppActivityOpenReason::SourceUnavailable) => "source-unavailable",
        Ok(AppActivityOpenReason::ObjectUnavailable) => "object-unavailable",
        Ok(AppActivityOpenReason::SourceNotReady) => "source-not-ready",
        Ok(AppActivityOpenReason::Canceled) => "canceled",
        Ok(AppActivityOpenReason::ActivityUnavailable) => "activity-unavailable",
        _ => return Err(untrusted()),
    };
    // Only the source App's confirmation pairs opened with opened.
    let paired = match outcome {
        "opened" => reason == "opened",
        "unavailable" => matches!(
            reason,
            "not-openable" | "source-unavailable" | "object-unavailable" | "activity-unavailable"
        ),
        _ => matches!(reason, "source-not-ready" | "canceled"),
    };
    if !paired {
        return Err(untrusted());
    }
    Ok(json!({ "outcome": outcome, "reason": reason }))
}

fn project_open_request(
    value: SubscribeAppActivityOpenRequestsResponse,
) -> Result<JsonValue, LocalAppOperationError> {
    if value.delivery_id.is_empty()
        || value.activity_id.is_empty()
        || value.object_ref.is_empty()
        || value.activity_type.is_empty()
    {
        return Err(untrusted());
    }
    Ok(json!({
        "deliveryId": value.delivery_id,
        "activityId": value.activity_id,
        "objectRef": value.object_ref,
        "type": value.activity_type,
    }))
}

fn project_timestamp(
    value: Option<prost_types::Timestamp>,
) -> Result<JsonValue, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    if !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    Ok(json!({ "seconds": value.seconds.to_string(), "nanos": value.nanos }))
}

fn proto_timestamp(value: LocalAppActivityTimestamp) -> prost_types::Timestamp {
    prost_types::Timestamp {
        seconds: value.seconds,
        nanos: value.nanos,
    }
}

fn optional_text(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn valid_open_request_id(value: &str) -> bool {
    value.len() > OPEN_REQUEST_ID_PREFIX.len()
        && value.len() <= MAX_OPEN_REQUEST_ID_BYTES
        && value.starts_with(OPEN_REQUEST_ID_PREFIX)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn kind_from_text(value: &str) -> Result<AppActivityKind, LocalAppOperationError> {
    match value {
        "activity" => Ok(AppActivityKind::Activity),
        "todo" => Ok(AppActivityKind::Todo),
        _ => Err(invalid_payload()),
    }
}

fn todo_state_from_text(value: &str) -> Result<AppActivityTodoState, LocalAppOperationError> {
    match value {
        "open" => Ok(AppActivityTodoState::Open),
        "completed" => Ok(AppActivityTodoState::Completed),
        "cancelled" => Ok(AppActivityTodoState::Cancelled),
        _ => Err(invalid_payload()),
    }
}

fn todo_state_text(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match AppActivityTodoState::try_from(value) {
        Ok(AppActivityTodoState::Open) => Ok("open"),
        Ok(AppActivityTodoState::Completed) => Ok("completed"),
        Ok(AppActivityTodoState::Cancelled) => Ok("cancelled"),
        _ => Err(untrusted()),
    }
}

fn completion_from_text(value: &str) -> Result<AppActivityOpenCompletion, LocalAppOperationError> {
    match value {
        "opened" => Ok(AppActivityOpenCompletion::Opened),
        "object-unavailable" => Ok(AppActivityOpenCompletion::ObjectUnavailable),
        _ => Err(invalid_payload()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalAppReasonCode;

    fn timestamp(seconds: i64, nanos: i32) -> Option<prost_types::Timestamp> {
        Some(prost_types::Timestamp { seconds, nanos })
    }

    fn todo_record() -> AppActivityRecord {
        AppActivityRecord {
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            source: Some(AppActivitySource {
                kind: AppActivitySourceKind::App as i32,
                source_ref: "src_editor".into(),
                app_id: "com.example.editor".into(),
                display_name: "Editor".into(),
                available: true,
            }),
            key: "review:42".into(),
            revision: 3,
            kind: AppActivityKind::Todo as i32,
            todo_state: AppActivityTodoState::Open as i32,
            attention: true,
            title: "Review chapter 4".into(),
            summary: String::new(),
            object_ref: "doc:42".into(),
            activity_type: "com.example.editor.review-requested.v1".into(),
            data_json: r#"{"b":1,"a":{"authority":"publisher-content"}}"#.into(),
            agent: Some(AppActivityAgentAssociation {
                agent_ref: "agr_writer".into(),
                display_name: "Writer".into(),
            }),
            occurred_at: timestamp(1_790_000_000, 0),
            published_at: timestamp(1_790_000_001, 5_000_000),
            updated_at: timestamp(1_790_000_002, 999_999_999),
            change_seq: 17,
            user_view: Some(AppActivityUserView {
                read_through_revision: 2,
                unread: true,
                needs_attention: true,
            }),
        }
    }

    fn keys(value: &JsonValue) -> Vec<&str> {
        let mut keys = value
            .as_object()
            .expect("projection object")
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        keys.sort_unstable();
        keys
    }

    fn assert_untrusted(result: Result<JsonValue, LocalAppOperationError>) {
        assert_eq!(
            result
                .expect_err("malformed Runtime projection must fail closed")
                .reason_code(),
            LocalAppReasonCode::RuntimeServiceUntrusted
        );
    }

    #[test]
    fn record_projection_matches_the_shared_json_shape() {
        let projected = project_record(todo_record()).expect("valid record");
        let mut expected_keys = vec![
            "activityId",
            "source",
            "key",
            "revision",
            "kind",
            "todoState",
            "attention",
            "title",
            "summary",
            "objectRef",
            "type",
            "dataJson",
            "agent",
            "occurredAt",
            "publishedAt",
            "updatedAt",
            "changeSeq",
            "userView",
        ];
        expected_keys.sort_unstable();
        assert_eq!(keys(&projected), expected_keys);
        assert_eq!(
            projected["source"],
            json!({
                "kind": "app",
                "sourceRef": "src_editor",
                "appId": "com.example.editor",
                "displayName": "Editor",
                "available": true,
            })
        );
        assert_eq!(projected["revision"], json!(3));
        assert_eq!(projected["kind"], "todo");
        assert_eq!(projected["todoState"], "open");
        assert_eq!(projected["summary"], JsonValue::Null);
        assert_eq!(projected["objectRef"], "doc:42");
        assert_eq!(projected["type"], "com.example.editor.review-requested.v1");
        // Publisher data stays opaque text byte for byte.
        assert_eq!(
            projected["dataJson"],
            r#"{"b":1,"a":{"authority":"publisher-content"}}"#
        );
        assert_eq!(
            projected["agent"],
            json!({ "agentRef": "agr_writer", "displayName": "Writer" })
        );
        assert_eq!(
            projected["occurredAt"],
            json!({ "seconds": "1790000000", "nanos": 0 })
        );
        assert_eq!(
            projected["updatedAt"],
            json!({ "seconds": "1790000002", "nanos": 999_999_999 })
        );
        assert_eq!(projected["changeSeq"], "17");
        assert_eq!(
            projected["userView"],
            json!({ "readThroughRevision": 2, "unread": true, "needsAttention": true })
        );
    }

    #[test]
    fn activity_and_runtime_agent_projection_use_null_for_absent_fields() {
        let mut record = todo_record();
        record.kind = AppActivityKind::Activity as i32;
        record.todo_state = AppActivityTodoState::Unspecified as i32;
        record.object_ref = String::new();
        record.data_json = String::new();
        record.agent = None;
        record.source = Some(AppActivitySource {
            kind: AppActivitySourceKind::RuntimeAgent as i32,
            source_ref: "src_runtime".into(),
            app_id: String::new(),
            display_name: String::new(),
            available: true,
        });
        let projected = project_record(record).expect("valid Runtime Agent activity");
        assert_eq!(projected["kind"], "activity");
        assert_eq!(projected["todoState"], JsonValue::Null);
        assert_eq!(projected["objectRef"], JsonValue::Null);
        assert_eq!(projected["dataJson"], JsonValue::Null);
        assert_eq!(projected["agent"], JsonValue::Null);
        assert_eq!(
            projected["source"],
            json!({
                "kind": "runtime-agent",
                "sourceRef": "src_runtime",
                "appId": null,
                "displayName": null,
                "available": true,
            })
        );
    }

    #[test]
    fn change_projection_carries_upsert_and_content_free_remove() {
        let upsert = project_change(SubscribeAppActivityChangesResponse {
            change_seq: 17,
            kind: AppActivityChangeKind::Upsert as i32,
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            record: Some(todo_record()),
        })
        .expect("valid upsert");
        assert_eq!(
            keys(&upsert),
            vec!["activityId", "changeSeq", "kind", "record"]
        );
        assert_eq!(upsert["changeSeq"], "17");
        assert_eq!(upsert["kind"], "upsert");
        assert_eq!(upsert["record"]["changeSeq"], "17");

        let remove = project_change(SubscribeAppActivityChangesResponse {
            change_seq: 18,
            kind: AppActivityChangeKind::Remove as i32,
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            record: None,
        })
        .expect("valid remove");
        assert_eq!(
            remove,
            json!({
                "changeSeq": "18",
                "kind": "remove",
                "activityId": "act_01AAAAAAAAAAAAAAAAAAAAAAAA",
            })
        );

        // An upsert bound to another commit or record never crosses the carrier.
        assert_untrusted(project_change(SubscribeAppActivityChangesResponse {
            change_seq: 19,
            kind: AppActivityChangeKind::Upsert as i32,
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            record: Some(todo_record()),
        }));
        assert_untrusted(project_change(SubscribeAppActivityChangesResponse {
            change_seq: 17,
            kind: AppActivityChangeKind::Upsert as i32,
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            record: None,
        }));
    }

    #[test]
    fn open_projection_keeps_one_pending_id_then_a_paired_result() {
        let mut seen = false;
        let pending = project_open_event(
            OpenAppActivityResponse {
                event: Some(OpenEvent::OpenRequestId(
                    "aor_test_pending".into(),
                )),
            },
            &mut seen,
        )
        .expect("pending open request");
        assert_eq!(
            pending,
            json!({ "openRequestId": "aor_test_pending" })
        );
        assert!(seen);
        // A second Host-private request on one stream is a contract violation.
        assert_untrusted(project_open_event(
            OpenAppActivityResponse {
                event: Some(OpenEvent::OpenRequestId("aor_second".into())),
            },
            &mut seen,
        ));

        let result = project_open_event(
            OpenAppActivityResponse {
                event: Some(OpenEvent::Result(AppActivityOpenResult {
                    outcome: AppActivityOpenOutcome::Opened as i32,
                    reason: AppActivityOpenReason::Opened as i32,
                })),
            },
            &mut seen,
        )
        .expect("typed open result");
        assert_eq!(
            result,
            json!({ "result": { "outcome": "opened", "reason": "opened" } })
        );
        let unavailable = project_open_result(AppActivityOpenResult {
            outcome: AppActivityOpenOutcome::Unavailable as i32,
            reason: AppActivityOpenReason::NotOpenable as i32,
        })
        .expect("not openable");
        assert_eq!(
            unavailable,
            json!({ "outcome": "unavailable", "reason": "not-openable" })
        );
        let failed = project_open_result(AppActivityOpenResult {
            outcome: AppActivityOpenOutcome::Failed as i32,
            reason: AppActivityOpenReason::SourceNotReady as i32,
        })
        .expect("deadline failure");
        assert_eq!(
            failed,
            json!({ "outcome": "failed", "reason": "source-not-ready" })
        );
        // Opened is never paired with a non-confirmation reason.
        assert_untrusted(project_open_result(AppActivityOpenResult {
            outcome: AppActivityOpenOutcome::Opened as i32,
            reason: AppActivityOpenReason::SourceUnavailable as i32,
        }));
    }

    #[test]
    fn open_request_projection_is_exact() {
        let projected = project_open_request(SubscribeAppActivityOpenRequestsResponse {
            delivery_id: "aod_delivery".into(),
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            object_ref: "doc:42".into(),
            activity_type: "com.example.editor.review-requested.v1".into(),
        })
        .expect("open request");
        assert_eq!(
            projected,
            json!({
                "deliveryId": "aod_delivery",
                "activityId": "act_01AAAAAAAAAAAAAAAAAAAAAAAA",
                "objectRef": "doc:42",
                "type": "com.example.editor.review-requested.v1",
            })
        );
    }

    #[test]
    fn unspecified_or_unknown_runtime_enums_fail_closed() {
        let mut record = todo_record();
        record.kind = AppActivityKind::Unspecified as i32;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.todo_state = AppActivityTodoState::Unspecified as i32;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.kind = AppActivityKind::Activity as i32;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.source.as_mut().expect("source").kind = AppActivitySourceKind::Unspecified as i32;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.source.as_mut().expect("source").kind = 99;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.source.as_mut().expect("source").kind = AppActivitySourceKind::RuntimeAgent as i32;
        assert_untrusted(project_record(record));

        assert_untrusted(project_change(SubscribeAppActivityChangesResponse {
            change_seq: 18,
            kind: AppActivityChangeKind::Unspecified as i32,
            activity_id: "act_01AAAAAAAAAAAAAAAAAAAAAAAA".into(),
            record: None,
        }));
        assert_untrusted(project_open_result(AppActivityOpenResult {
            outcome: AppActivityOpenOutcome::Unspecified as i32,
            reason: AppActivityOpenReason::Opened as i32,
        }));
        assert_untrusted(project_open_result(AppActivityOpenResult {
            outcome: AppActivityOpenOutcome::Failed as i32,
            reason: AppActivityOpenReason::Unspecified as i32,
        }));
        assert_untrusted(project_open_event(
            OpenAppActivityResponse { event: None },
            &mut false,
        ));
    }

    #[test]
    fn missing_messages_and_unsafe_numbers_fail_closed() {
        let mut record = todo_record();
        record.user_view = None;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.source = None;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.occurred_at = None;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.updated_at = timestamp(1_790_000_002, 1_000_000_000);
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.revision = MAX_SAFE_REVISION + 1;
        record
            .user_view
            .as_mut()
            .expect("user view")
            .read_through_revision = 0;
        assert_untrusted(project_record(record));

        let mut record = todo_record();
        record.revision = MAX_SAFE_REVISION;
        let projected = project_record(record).expect("largest exact JSON revision");
        assert_eq!(projected["revision"].as_u64(), Some(MAX_SAFE_REVISION));

        let mut record = todo_record();
        record
            .user_view
            .as_mut()
            .expect("user view")
            .read_through_revision = 4;
        assert_untrusted(project_record(record));
    }

    #[test]
    fn request_vocabulary_rejects_unknown_values_before_transport() {
        for result in [
            kind_from_text("task").map(|_| ()),
            kind_from_text("").map(|_| ()),
            todo_state_from_text("done").map(|_| ()),
            todo_state_from_text("canceled").map(|_| ()),
            completion_from_text("launched").map(|_| ()),
            completion_from_text("host-unavailable").map(|_| ()),
        ] {
            assert_eq!(
                result.expect_err("unknown vocabulary").reason_code(),
                LocalAppReasonCode::InvalidPayload
            );
        }
        assert_eq!(kind_from_text("todo").expect("todo"), AppActivityKind::Todo);
        assert_eq!(
            todo_state_from_text("cancelled").expect("cancelled"),
            AppActivityTodoState::Cancelled
        );
        assert_eq!(
            completion_from_text("object-unavailable").expect("object unavailable"),
            AppActivityOpenCompletion::ObjectUnavailable
        );
    }
}
