use napi_derive::napi;
use nimi_shell_protected_local::{
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
};
use serde_json::json;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock, Weak,
    },
};
use tokio::sync::{watch, Mutex};

use super::{
    clear_desktop_control_on_host_failure, current_or_open_desktop_control,
    project_account_session_event, NativeDesktopAccountSessionEventsOpenInput,
    NativeDesktopAccountSessionEventsStreamInput, NativeJsonOutcome,
};

struct AccountEventStream {
    receiver: Mutex<Option<DesktopAccountSessionEventReceiver>>,
    close_tx: watch::Sender<bool>,
    control: Option<Weak<dyn nimi_shell_protected_local::NimiDesktopControl>>,
}

type SharedAccountEventStream = Arc<AccountEventStream>;
type AccountEventStreamRegistry = HashMap<String, Option<SharedAccountEventStream>>;
const MAX_ACCOUNT_EVENT_STREAMS: usize = 4;
static ACCOUNT_EVENT_STREAMS: OnceLock<Mutex<AccountEventStreamRegistry>> = OnceLock::new();
static ACCOUNT_EVENT_STREAM_COUNTER: AtomicU64 = AtomicU64::new(1);

fn account_event_streams() -> &'static Mutex<AccountEventStreamRegistry> {
    ACCOUNT_EVENT_STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn reserve_stream_slot(registry: &mut AccountEventStreamRegistry, stream_id: String) -> bool {
    if registry.len() >= MAX_ACCOUNT_EVENT_STREAMS || registry.contains_key(stream_id.as_str()) {
        return false;
    }
    registry.insert(stream_id, None);
    true
}

async fn close_account_event_stream(stream: SharedAccountEventStream) {
    stream.close_tx.send_replace(true);
    // A pending `next` owns the receiver mutex while it awaits the mpsc item.
    // The close signal releases that guard; taking the receiver then closes the
    // sender and makes the tonic stream task drop its verified channel now.
    stream.receiver.lock().await.take();
}

pub(super) async fn close_all_account_event_streams() -> usize {
    let (registered, streams) = {
        let mut registry = account_event_streams().lock().await;
        let registered = registry.len();
        let streams = registry
            .drain()
            .filter_map(|(_, stream)| stream)
            .collect::<Vec<_>>();
        (registered, streams)
    };
    for stream in streams {
        close_account_event_stream(stream).await;
    }
    registered
}

#[napi(js_name = "desktopAccountSessionEventsOpen")]
pub async fn desktop_account_session_events_open(
    input: NativeDesktopAccountSessionEventsOpenInput,
) -> NativeJsonOutcome {
    let after_sequence = match parse_decimal_sequence(input.after_sequence.as_str()) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let stream_id = format!(
        "account-session-{}",
        ACCOUNT_EVENT_STREAM_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut registry = account_event_streams().lock().await;
    if !reserve_stream_slot(&mut registry, stream_id.clone()) {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    }
    drop(registry);
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => {
            account_event_streams()
                .lock()
                .await
                .remove(stream_id.as_str());
            return NativeJsonOutcome::host_error(error);
        }
    };
    let receiver = match control
        .open_account_session_events(DesktopAccountSessionEventsRequest { after_sequence })
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            account_event_streams()
                .lock()
                .await
                .remove(stream_id.as_str());
            clear_desktop_control_on_host_failure(&control, &error).await;
            return NativeJsonOutcome::host_error(error);
        }
    };
    let (close_tx, _) = watch::channel(false);
    let stream = Arc::new(AccountEventStream {
        receiver: Mutex::new(Some(receiver)),
        close_tx,
        control: Some(Arc::downgrade(&control)),
    });
    let mut registry = account_event_streams().lock().await;
    let Some(slot) = registry.get_mut(stream_id.as_str()) else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    *slot = Some(stream);
    drop(registry);
    NativeJsonOutcome::success(json!({ "streamId": stream_id }))
}

#[napi(js_name = "desktopAccountSessionEventsNext")]
pub async fn desktop_account_session_events_next(
    input: NativeDesktopAccountSessionEventsStreamInput,
) -> NativeJsonOutcome {
    let stream_id = input.stream_id.as_str();
    if !valid_stream_id(stream_id) {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    }
    let stream = account_event_streams()
        .lock()
        .await
        .get(stream_id)
        .and_then(Clone::clone);
    let Some(stream) = stream else {
        return NativeJsonOutcome::host_reason("not-found", false);
    };
    let mut close_rx = stream.close_tx.subscribe();
    if *close_rx.borrow() {
        return NativeJsonOutcome::success(json!({ "completed": true }));
    }
    let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    let Some(receiver) = receiver_slot.as_mut() else {
        return NativeJsonOutcome::success(json!({ "completed": true }));
    };
    let next = tokio::select! {
        biased;
        changed = close_rx.changed() => {
            let _ = changed;
            None
        }
        next = receiver.recv() => next,
    };
    match next {
        Some(Ok(event)) => NativeJsonOutcome::success(json!({
            "completed": false,
            "event": project_account_session_event(event),
        })),
        Some(Err(error)) => {
            account_event_streams().lock().await.remove(stream_id);
            if let Some(control) = stream.control.as_ref().and_then(Weak::upgrade) {
                clear_desktop_control_on_host_failure(&control, &error).await;
            }
            NativeJsonOutcome::host_error(error)
        }
        None => {
            account_event_streams().lock().await.remove(stream_id);
            NativeJsonOutcome::success(json!({ "completed": true }))
        }
    }
}

#[napi(js_name = "desktopAccountSessionEventsClose")]
pub async fn desktop_account_session_events_close(
    input: NativeDesktopAccountSessionEventsStreamInput,
) -> NativeJsonOutcome {
    let stream_id = input.stream_id.as_str();
    if !valid_stream_id(stream_id) {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    }
    let stream = account_event_streams()
        .lock()
        .await
        .remove(stream_id)
        .flatten();
    let closed = stream.is_some();
    if let Some(stream) = stream {
        close_account_event_stream(stream).await;
    }
    NativeJsonOutcome::success(json!({ "closed": closed }))
}

fn parse_decimal_sequence(value: &str) -> Option<u64> {
    if value != value.trim()
        || value.is_empty()
        || value.len() > 20
        || (value.len() > 1 && value.starts_with('0'))
    {
        return None;
    }
    value.parse::<u64>().ok()
}

fn valid_stream_id(value: &str) -> bool {
    value == value.trim()
        && !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    static ACCOUNT_EVENT_STREAM_TEST_LOCK: Mutex<()> = Mutex::const_new(());

    #[tokio::test]
    async fn close_unblocks_a_pending_next_call() {
        let _test_guard = ACCOUNT_EVENT_STREAM_TEST_LOCK.lock().await;
        let stream_id = "account-session-close-test".to_string();
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        let (close_tx, _) = watch::channel(false);
        account_event_streams().lock().await.insert(
            stream_id.clone(),
            Some(Arc::new(AccountEventStream {
                receiver: Mutex::new(Some(receiver)),
                close_tx,
                control: None,
            })),
        );

        let next_stream_id = stream_id.clone();
        let pending = tokio::spawn(async move {
            desktop_account_session_events_next(NativeDesktopAccountSessionEventsStreamInput {
                stream_id: next_stream_id,
            })
            .await
        });
        tokio::task::yield_now().await;

        let close =
            desktop_account_session_events_close(NativeDesktopAccountSessionEventsStreamInput {
                stream_id: stream_id.clone(),
            })
            .await;
        assert_eq!(close.status, "ok");
        assert_eq!(close.value, Some(json!({ "closed": true })));

        let next = tokio::time::timeout(std::time::Duration::from_secs(1), pending)
            .await
            .expect("pending next must be cancelled")
            .expect("pending next task");
        assert_eq!(next.status, "ok");
        assert_eq!(next.value, Some(json!({ "completed": true })));
        assert!(!account_event_streams()
            .lock()
            .await
            .contains_key(&stream_id));
    }

    #[tokio::test]
    async fn close_all_drops_receivers_and_reserved_slots() {
        let _test_guard = ACCOUNT_EVENT_STREAM_TEST_LOCK.lock().await;
        let stream_id = "account-session-close-all-test".to_string();
        let (sender, receiver) = tokio::sync::mpsc::channel(1);
        let (close_tx, _) = watch::channel(false);
        let mut registry = account_event_streams().lock().await;
        registry.clear();
        registry.insert(
            stream_id,
            Some(Arc::new(AccountEventStream {
                receiver: Mutex::new(Some(receiver)),
                close_tx,
                control: None,
            })),
        );
        registry.insert("account-session-reserved".to_string(), None);
        drop(registry);

        assert_eq!(close_all_account_event_streams().await, 2);
        assert!(account_event_streams().lock().await.is_empty());
        assert!(sender.is_closed());
    }

    #[test]
    fn stream_registry_reserves_exact_bounded_capacity() {
        let mut registry = AccountEventStreamRegistry::new();
        for index in 0..MAX_ACCOUNT_EVENT_STREAMS {
            assert!(reserve_stream_slot(
                &mut registry,
                format!("account-session-{index}")
            ));
        }
        assert!(!reserve_stream_slot(
            &mut registry,
            "account-session-overflow".to_string()
        ));
    }

    #[test]
    fn stream_ids_are_exact_and_never_trimmed() {
        assert!(valid_stream_id("account-session-1"));
        assert!(!valid_stream_id(" account-session-1"));
        assert!(!valid_stream_id("account-session-1 "));
    }
}
