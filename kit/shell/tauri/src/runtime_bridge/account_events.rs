use nimi_shell_protected_local::{
    DesktopAccountProjection, DesktopAccountSessionEvent, DesktopAccountSessionEventsRequest,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::service_control;

const ACCOUNT_EVENT_NAME: &str = "runtime_account_session_events";
const MAX_ACCOUNT_EVENT_STREAMS: usize = 4;
static STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);
type AccountEventStreamTask = Option<tauri::async_runtime::JoinHandle<()>>;
static STREAMS: OnceLock<Mutex<HashMap<String, AccountEventStreamTask>>> = OnceLock::new();

fn streams() -> &'static Mutex<HashMap<String, AccountEventStreamTask>> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeBridgeAccountEventsOpenPayload {
    pub after_sequence: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RuntimeBridgeAccountEventsClosePayload {
    pub stream_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeAccountEventsOpenResult {
    pub stream_id: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RuntimeBridgeAccountEventsCloseResult {}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountEventEnvelope {
    stream_id: String,
    event_type: &'static str,
    event: Option<AccountEventProjection>,
    error: Option<AccountEventError>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountEventProjection {
    sequence: String,
    delivery_kind: &'static str,
    state: &'static str,
    reason_code: i32,
    account_reason_code: i32,
    account_projection: Option<AccountProjection>,
    replay_truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountProjection {
    account_id: String,
    display_name: String,
    realm_environment_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountEventError {
    reason_code: &'static str,
    retryable: bool,
}

pub async fn open(
    app: AppHandle,
    payload: RuntimeBridgeAccountEventsOpenPayload,
) -> Result<RuntimeBridgeAccountEventsOpenResult, String> {
    let after_sequence = parse_sequence(payload.after_sequence.as_str())?;
    let stream_id = format!(
        "account-session-{}",
        STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    {
        let mut guard = streams()
            .lock()
            .map_err(|_| "runtime account event registry unavailable".to_string())?;
        if guard.len() >= MAX_ACCOUNT_EVENT_STREAMS {
            return Err("runtime account event stream limit exceeded".to_string());
        }
        guard.insert(stream_id.clone(), None);
    }
    let mut receiver =
        match service_control::open_account_session_events(DesktopAccountSessionEventsRequest {
            after_sequence,
        })
        .await
        {
            Ok(receiver) => receiver,
            Err(error) => {
                if let Ok(mut guard) = streams().lock() {
                    guard.remove(stream_id.as_str());
                }
                return Err(error.reason_code().as_str().to_string());
            }
        };
    let task_stream_id = stream_id.clone();
    let (start_tx, start_rx) = oneshot::channel::<()>();
    let task = tauri::async_runtime::spawn(async move {
        if start_rx.await.is_err() {
            return;
        }
        while let Some(item) = receiver.recv().await {
            match item {
                Ok(event) => {
                    if !emit(
                        &app,
                        AccountEventEnvelope {
                            stream_id: task_stream_id.clone(),
                            event_type: "next",
                            event: Some(project_event(event)),
                            error: None,
                        },
                    ) {
                        break;
                    }
                }
                Err(error) => {
                    let _ = emit(
                        &app,
                        AccountEventEnvelope {
                            stream_id: task_stream_id.clone(),
                            event_type: "error",
                            event: None,
                            error: Some(AccountEventError {
                                reason_code: error.reason_code().as_str(),
                                retryable: error.retryable(),
                            }),
                        },
                    );
                    break;
                }
            }
        }
        let _ = emit(
            &app,
            AccountEventEnvelope {
                stream_id: task_stream_id.clone(),
                event_type: "completed",
                event: None,
                error: None,
            },
        );
        if let Ok(mut guard) = streams().lock() {
            guard.remove(task_stream_id.as_str());
        }
    });
    {
        let mut guard = streams()
            .lock()
            .map_err(|_| "runtime account event registry unavailable".to_string())?;
        let Some(slot) = guard.get_mut(stream_id.as_str()) else {
            task.abort();
            return Err("runtime account event stream opening was cancelled".to_string());
        };
        *slot = Some(task);
    }
    if start_tx.send(()).is_err() {
        if let Ok(mut guard) = streams().lock() {
            if let Some(Some(task)) = guard.remove(stream_id.as_str()) {
                task.abort();
            }
        }
        return Err("runtime account event stream task failed to start".to_string());
    }
    Ok(RuntimeBridgeAccountEventsOpenResult { stream_id })
}

pub fn close(
    payload: RuntimeBridgeAccountEventsClosePayload,
) -> Result<RuntimeBridgeAccountEventsCloseResult, String> {
    let stream_id = valid_stream_id(payload.stream_id.as_str())?;
    if let Some(task) = streams()
        .lock()
        .map_err(|_| "runtime account event registry unavailable".to_string())?
        .remove(stream_id)
        .flatten()
    {
        task.abort();
    }
    Ok(RuntimeBridgeAccountEventsCloseResult {})
}

fn emit(app: &AppHandle, envelope: AccountEventEnvelope) -> bool {
    app.emit(ACCOUNT_EVENT_NAME, envelope).is_ok()
}

fn project_event(event: DesktopAccountSessionEvent) -> AccountEventProjection {
    AccountEventProjection {
        sequence: event.sequence.to_string(),
        delivery_kind: event.delivery_kind.as_str(),
        state: event.state.as_str(),
        reason_code: event.reason_code,
        account_reason_code: event.account_reason_code,
        account_projection: event.account_projection.map(project_account),
        replay_truncated: event.replay_truncated,
    }
}

fn project_account(projection: DesktopAccountProjection) -> AccountProjection {
    AccountProjection {
        account_id: projection.account_id,
        display_name: projection.display_name,
        realm_environment_id: projection.realm_environment_id,
    }
}

fn parse_sequence(value: &str) -> Result<u64, String> {
    if value != value.trim()
        || value.is_empty()
        || value.len() > 20
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("afterSequence must be a canonical unsigned decimal string".to_string());
    }
    value
        .parse::<u64>()
        .map_err(|_| "afterSequence exceeds uint64".to_string())
}

fn valid_stream_id(value: &str) -> Result<&str, String> {
    if value != value.trim()
        || value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("streamId is invalid".to_string());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{parse_sequence, valid_stream_id};

    #[test]
    fn sequence_is_canonical_uint64() {
        assert_eq!(parse_sequence("0").expect("zero"), 0);
        assert_eq!(
            parse_sequence("18446744073709551615").expect("max"),
            u64::MAX
        );
        for invalid in ["", " 1", "1 ", "01", "-1", "+1", "18446744073709551616"] {
            assert!(parse_sequence(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn stream_id_is_bounded_and_host_shaped() {
        assert_eq!(
            valid_stream_id("account-session-1").expect("id"),
            "account-session-1"
        );
        assert!(valid_stream_id("../forged").is_err());
    }
}
