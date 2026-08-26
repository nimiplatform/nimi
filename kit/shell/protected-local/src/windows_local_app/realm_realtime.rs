use serde_json::{json, Value as JsonValue};
use tokio::sync::mpsc;
use tonic::transport::Channel;

use crate::generated::realm_chat_durable_event::Event as ChatEvent;
use crate::generated::realm_chat_message_payload::Payload as MessagePayload;
use crate::generated::subscribe_realm_realtime_events_request::Target;
use crate::generated::subscribe_realm_realtime_events_response::Event;
use crate::generated::{
    Ack, AckRealmRealtimeEventsRequest, CloseRealmRealtimeChannelRequest,
    CloseRealmRealtimeSubscriptionRequest, ListRealmChatsRequest, OpenRealmRealtimeChannelRequest,
    RealmChatAttachmentPayload, RealmChatDurableEvent, RealmChatInboxSubscriptionTarget,
    RealmChatMessage, RealmChatMessagePayload, RealmChatMessageReply, RealmChatSubscriptionTarget,
    RealmPresenceSubscriptionTarget, SubscribeRealmRealtimeEventsRequest,
    SubscribeRealmRealtimeEventsResponse,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppRealmChatListRequest, LocalAppRealmRealtimeAckRequest,
    LocalAppRealmRealtimeChannelRequest, LocalAppRealmRealtimeOpenRequest,
    LocalAppRealmRealtimeSubscribeRequest, LocalAppRealmRealtimeSubscriptionRequest,
    LocalAppRealtimeSubscriptionReceiver,
};

use super::realtime::project_control;
use super::{invalid_payload, untrusted};

pub(super) async fn list_chats(
    channel: Channel,
    request: LocalAppRealmChatListRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    if let Some(cursor) = request.cursor.as_deref() {
        require_selector(cursor)?;
    }
    if request.limit.is_some_and(|limit| limit == 0 || limit > 50) {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_realm_realtime_client(channel)
        .list_realm_chats(ListRealmChatsRequest {
            cursor: request.cursor.unwrap_or_default(),
            limit: request.limit.unwrap_or_default(),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let items = response
        .items
        .into_iter()
        .map(|item| {
            let other_user = item.other_user.ok_or_else(untrusted)?;
            Ok(json!({
                "chatId": item.chat_id,
                "otherUser": {
                    "id": other_user.id,
                    "handle": other_user.handle,
                    "displayName": other_user.display_name,
                    "avatarUrl": nullable_text(other_user.avatar_url),
                    "status": nullable_text(other_user.status),
                    "presenceStatus": nullable_text(other_user.presence_status),
                    "presenceText": nullable_text(other_user.presence_text),
                    "presenceEmoji": nullable_text(other_user.presence_emoji),
                    "createdAt": project_timestamp(other_user.created_at),
                },
                "lastMessage": item.last_message.map(project_message).transpose()?,
                "unreadCount": item.unread_count,
                "createdAt": project_timestamp(item.created_at),
                "updatedAt": project_timestamp(item.updated_at),
                "lastMessageAt": project_optional_timestamp(item.last_message_at),
            }))
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
    Ok(json!({
        "items": items,
        "nextCursor": nullable_text(response.next_cursor),
    }))
}

pub(super) async fn open(
    channel: Channel,
    _request: LocalAppRealmRealtimeOpenRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let response = crate::grpc_limits::runtime_realm_realtime_client(channel)
        .open_realm_realtime_channel(OpenRealmRealtimeChannelRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_selector(&response.realtime_session_id)?;
    require_selector(&response.channel_id)?;
    if response.generation == 0 {
        return Err(untrusted());
    }
    Ok(json!({
        "realtimeSessionId": response.realtime_session_id,
        "channelId": response.channel_id,
        "generation": response.generation.to_string(),
        "control": project_control(response.status)?,
    }))
}

pub(super) async fn subscribe(
    channel: Channel,
    request: LocalAppRealmRealtimeSubscribeRequest,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    require_selector(&request.channel_id)?;
    let target = parse_target(request.target)?;
    let mut stream = crate::grpc_limits::runtime_realm_realtime_client(channel)
        .subscribe_realm_realtime_events(SubscribeRealmRealtimeEventsRequest {
            channel_id: request.channel_id,
            target: Some(target),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(event)) => {
                    if sender.send(project_event(event)).await.is_err() {
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
    Ok(receiver)
}

pub(super) async fn ack(
    channel: Channel,
    request: LocalAppRealmRealtimeAckRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_selector(&request.channel_id)?;
    require_selector(&request.subscription_id)?;
    if request.cursor == 0 {
        return Err(invalid_payload());
    }
    let response = crate::grpc_limits::runtime_realm_realtime_client(channel)
        .ack_realm_realtime_events(AckRealmRealtimeEventsRequest {
            channel_id: request.channel_id,
            subscription_id: request.subscription_id,
            cursor: request.cursor,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_ack(response.ack)
}

pub(super) async fn close_subscription(
    channel: Channel,
    request: LocalAppRealmRealtimeSubscriptionRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_selector(&request.channel_id)?;
    require_selector(&request.subscription_id)?;
    let response = crate::grpc_limits::runtime_realm_realtime_client(channel)
        .close_realm_realtime_subscription(CloseRealmRealtimeSubscriptionRequest {
            channel_id: request.channel_id,
            subscription_id: request.subscription_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_ack(response.ack)
}

pub(super) async fn close_channel(
    channel: Channel,
    request: LocalAppRealmRealtimeChannelRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_selector(&request.channel_id)?;
    let response = crate::grpc_limits::runtime_realm_realtime_client(channel)
        .close_realm_realtime_channel(CloseRealmRealtimeChannelRequest {
            channel_id: request.channel_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_ack(response.ack)
}

fn parse_target(value: JsonValue) -> Result<Target, LocalAppOperationError> {
    let record = value.as_object().ok_or_else(invalid_payload)?;
    match record.get("type").and_then(JsonValue::as_str) {
        Some("chat") if record.len() == 2 => {
            let chat_id = record
                .get("chatId")
                .and_then(JsonValue::as_str)
                .unwrap_or("");
            require_selector(chat_id)?;
            Ok(Target::Chat(RealmChatSubscriptionTarget {
                chat_id: chat_id.into(),
            }))
        }
        Some("presence") if record.len() == 1 => {
            Ok(Target::Presence(RealmPresenceSubscriptionTarget {}))
        }
        Some("inbox") if record.len() == 1 => {
            Ok(Target::Inbox(RealmChatInboxSubscriptionTarget {}))
        }
        _ => Err(invalid_payload()),
    }
}

fn project_event(
    value: SubscribeRealmRealtimeEventsResponse,
) -> Result<JsonValue, LocalAppOperationError> {
    require_selector(&value.realtime_session_id)?;
    require_selector(&value.channel_id)?;
    require_selector(&value.subscription_id)?;
    if value.generation == 0 || value.sequence == 0 {
        return Err(untrusted());
    }
    let event = match value.event.ok_or_else(untrusted)? {
        Event::Control(control) => {
            json!({"type":"control","control":project_control(Some(control))?})
        }
        Event::Chat(chat) => project_chat_event(chat)?,
        Event::Typing(typing) => json!({
            "type":"typing","chatId":typing.chat_id,"userId":typing.user_id,
            "isTyping":typing.is_typing,"expiresAt":project_timestamp(typing.expires_at),
        }),
        Event::Presence(presence) => json!({
            "type":"presence","userId":presence.user_id,"isOnline":presence.is_online,
            "presenceRevision":presence.presence_revision.to_string(),"occurredAt":project_timestamp(presence.occurred_at),
        }),
        Event::Snapshot(snapshot) => json!({
            "type":"snapshot","chatId":snapshot.chat_id,"otherUser":snapshot.other_user.map(|user|json!({
                "id":user.id,"handle":user.handle,"displayName":user.display_name,"avatarUrl":user.avatar_url,
                "status":user.status,"presenceStatus":user.presence_status,"presenceText":user.presence_text,"presenceEmoji":user.presence_emoji,
                "createdAt":project_timestamp(user.created_at),
            })),"messages":snapshot.messages.into_iter().map(project_message).collect::<Result<Vec<_>,_>>()?,
            "throughCursor":snapshot.through_cursor.to_string(),"unreadCount":snapshot.unread_count,
            "appliedAt":project_timestamp(snapshot.applied_at),
        }),
        Event::Inbox(inbox) => json!({
            "type":"inbox","chatId":inbox.chat_id,"highWatermarkSeq":inbox.high_watermark_seq.to_string(),
            "occurredAt":project_timestamp(inbox.occurred_at),
        }),
    };
    Ok(json!({
        "realtimeSessionId":value.realtime_session_id,"channelId":value.channel_id,
        "subscriptionId":value.subscription_id,"generation":value.generation.to_string(),
        "sequence":value.sequence.to_string(),"correlationId":value.correlation_id,
        "occurredAt":project_timestamp(value.occurred_at),"event":event,
    }))
}

fn project_chat_event(value: RealmChatDurableEvent) -> Result<JsonValue, LocalAppOperationError> {
    let (kind, payload) = match value.event.ok_or_else(untrusted)? {
        ChatEvent::MessageCreated(mutation) => (
            "message-created",
            json!({"message":project_message(mutation.message.ok_or_else(untrusted)?)?}),
        ),
        ChatEvent::MessageEdited(mutation) => (
            "message-edited",
            json!({"message":project_message(mutation.message.ok_or_else(untrusted)?)?}),
        ),
        ChatEvent::MessageRecalled(recalled) => (
            "message-recalled",
            json!({"chatId":recalled.chat_id,"messageId":recalled.message_id,"recalledAt":project_timestamp(recalled.recalled_at)}),
        ),
        ChatEvent::ChatRead(read) => (
            "chat-read",
            json!({"chatId":read.chat_id,"readerId":read.reader_id,"readThroughMessageId":nullable_text(read.read_through_message_id),"readAt":project_timestamp(read.read_at)}),
        ),
    };
    Ok(json!({
        "type":"chat","streamId":value.stream_id,"cursor":value.cursor.to_string(),
        "eventId":value.event_id,"chatId":value.chat_id,"actorId":value.actor_id,
        "occurredAt":project_timestamp(value.occurred_at),"kind":kind,"payload":payload,
    }))
}

fn project_message(value: RealmChatMessage) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "id":value.id,"chatId":value.chat_id,"senderId":value.sender_id,
        "clientMessageId":nullable_text(value.client_message_id),"messageType":message_type(value.r#type)?,
        "text":value.text,"payload":project_message_payload(value.payload)?,"isRead":value.is_read,
        "replyTo":value.reply_to.map(project_reply).transpose()?,"createdAt":project_timestamp(value.created_at),
        "editedAt":project_optional_timestamp(value.edited_at),
    }))
}

fn project_reply(value: RealmChatMessageReply) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "id":value.id,"senderId":value.sender_id,"messageType":message_type(value.r#type)?,
        "text":value.text,"payload":project_message_payload(value.payload)?,
    }))
}

fn project_message_payload(
    value: Option<RealmChatMessagePayload>,
) -> Result<JsonValue, LocalAppOperationError> {
    let Some(payload) = value.and_then(|value| value.payload) else {
        return Ok(JsonValue::Null);
    };
    Ok(match payload {
        MessagePayload::Text(value) => json!({"type":"text","content":value.content}),
        MessagePayload::Attachment(value) => {
            json!({"type":"attachment","attachment":project_attachment(value)?})
        }
        MessagePayload::PostRef(value) => json!({"type":"post-ref","postId":value.post_id}),
        MessagePayload::UserRef(value) => {
            json!({"type":"user-ref","userId":value.user_id,"snapshot":value.snapshot.map(|snapshot|json!({"id":snapshot.id,"handle":snapshot.handle,"displayName":snapshot.display_name,"avatarUrl":snapshot.avatar_url}))})
        }
        MessagePayload::LinkRef(value) => {
            json!({"type":"link-ref","url":value.url,"title":nullable_text(value.title)})
        }
        MessagePayload::FriendRequest(value) => {
            json!({"type":"friend-request","requestId":value.request_id,"status":value.status,"requestMessage":nullable_text(value.request_message)})
        }
        MessagePayload::System(value) => {
            json!({"type":"system","code":nullable_text(value.code),"message":nullable_text(value.message)})
        }
    })
}

fn project_attachment(
    value: RealmChatAttachmentPayload,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "targetType":attachment_target(value.target_type)?,"targetId":value.target_id,
        "displayKind":attachment_display(value.display_kind)?,"title":nullable_text(value.title),
        "subtitle":nullable_text(value.subtitle),"url":nullable_text(value.url),"thumbnail":nullable_text(value.thumbnail),
        "width":value.width,"height":value.height,"duration":value.duration,
        "preview":value.preview.map(|preview|project_attachment(*preview)).transpose()?,
    }))
}

fn project_ack(value: Option<Ack>) -> Result<JsonValue, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    Ok(
        json!({"ack":{"ok":value.ok,"reasonCode":reason_name(value.reason_code)?,"actionHint":value.action_hint}}),
    )
}

fn project_timestamp(value: Option<prost_types::Timestamp>) -> JsonValue {
    value.map_or(
        JsonValue::Null,
        |value| json!({"seconds":value.seconds.to_string(),"nanos":value.nanos}),
    )
}

fn project_optional_timestamp(value: Option<prost_types::Timestamp>) -> JsonValue {
    project_timestamp(value)
}
fn nullable_text(value: String) -> JsonValue {
    if value.is_empty() {
        JsonValue::Null
    } else {
        JsonValue::String(value)
    }
}

fn require_selector(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value != value.trim()
        || value.len() > 512
        || value.contains(['\0', '\r', '\n'])
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn reason_name(value: i32) -> Result<String, LocalAppOperationError> {
    crate::generated::ReasonCode::try_from(value)
        .map(|reason| reason.as_str_name().to_string())
        .map_err(|_| untrusted())
}

fn message_type(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match value {
        1 => Ok("text"),
        2 => Ok("attachment"),
        3 => Ok("post-ref"),
        4 => Ok("user-ref"),
        5 => Ok("link-ref"),
        6 => Ok("friend-request"),
        7 => Ok("system"),
        8 => Ok("recall"),
        _ => Err(untrusted()),
    }
}
fn attachment_target(value: i32) -> Result<&'static str, LocalAppOperationError> {
    match value {
        1 => Ok("resource"),
        2 => Ok("asset"),
        3 => Ok("bundle"),
        _ => Err(untrusted()),
    }
}
fn attachment_display(value: i32) -> Result<JsonValue, LocalAppOperationError> {
    Ok(match value {
        0 => JsonValue::Null,
        1 => json!("image"),
        2 => json!("video"),
        3 => json!("audio"),
        4 => json!("text"),
        5 => json!("card"),
        _ => return Err(untrusted()),
    })
}
