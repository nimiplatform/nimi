use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use nimi_shell_protected_local::{
    BundledAvatarRuntimeRequest, BundledAvatarRuntimeStreamReceiver, NimiDesktopControl,
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
    clear_desktop_control_on_transport_reason, current_or_open_desktop_control,
    NativeBundledAvatarRuntimeInput, NativeBundledAvatarStreamInput,
    NativeBundledAvatarStreamNextOutcome, NativeJsonOutcome,
};

struct BundledAvatarStream {
    receiver: Mutex<Option<BundledAvatarRuntimeStreamReceiver>>,
    close_tx: watch::Sender<bool>,
    control: Weak<dyn NimiDesktopControl>,
}

type SharedStream = Arc<BundledAvatarStream>;
enum StreamSlot {
    Opening(Weak<dyn NimiDesktopControl>),
    Open(SharedStream),
}
type Registry = HashMap<String, StreamSlot>;
const MAX_BUNDLED_AVATAR_STREAMS: usize = 8;
static STREAMS: OnceLock<Mutex<Registry>> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(1);

fn streams() -> &'static Mutex<Registry> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn slot_belongs_to_control(slot: &StreamSlot, control: &Arc<dyn NimiDesktopControl>) -> bool {
    let candidate = match slot {
        StreamSlot::Opening(control) => control,
        StreamSlot::Open(stream) => &stream.control,
    };
    candidate
        .upgrade()
        .is_some_and(|candidate| Arc::ptr_eq(&candidate, control))
}

fn opened_stream(slot: StreamSlot) -> Option<SharedStream> {
    match slot {
        StreamSlot::Opening(_) => None,
        StreamSlot::Open(stream) => Some(stream),
    }
}

async fn close_stream(stream: SharedStream) {
    stream.close_tx.send_replace(true);
    stream.receiver.lock().await.take();
}

async fn next_stream_item<T>(
    receiver: &Mutex<Option<tokio::sync::mpsc::Receiver<T>>>,
    close_tx: &watch::Sender<bool>,
) -> Result<Option<T>, ()> {
    let mut close_rx = close_tx.subscribe();
    // Close can win after Next clones the stream but before it subscribes.
    // A new watch receiver considers the current value already seen.
    if *close_rx.borrow() {
        return Ok(None);
    }
    let Ok(mut receiver_slot) = receiver.try_lock() else {
        return Err(());
    };
    let Some(receiver) = receiver_slot.as_mut() else {
        return Ok(None);
    };
    Ok(tokio::select! {
        biased;
        changed = close_rx.changed() => { let _ = changed; None }
        next = receiver.recv() => next,
    })
}

#[cfg(not(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
)))]
pub(super) async fn close_all_bundled_avatar_streams() -> usize {
    let registered = {
        let mut registry = streams().lock().await;
        let registered = registry.len();
        let active = registry
            .drain()
            .filter_map(|(_, slot)| opened_stream(slot))
            .collect::<Vec<_>>();
        drop(registry);
        for stream in active {
            close_stream(stream).await;
        }
        registered
    };
    registered
}

pub(super) async fn close_bundled_avatar_streams_for_control(
    control: &Arc<dyn NimiDesktopControl>,
) -> usize {
    let (registered, active) = {
        let mut registry = streams().lock().await;
        let mut registered = 0;
        let mut active = Vec::new();
        registry.retain(|_, slot| {
            if !slot_belongs_to_control(slot, control) {
                return true;
            }
            registered += 1;
            if let StreamSlot::Open(stream) = slot {
                active.push(stream.clone());
            }
            false
        });
        (registered, active)
    };
    for stream in active {
        close_stream(stream).await;
    }
    registered
}

#[napi(js_name = "desktopBundledAvatarStreamOpen")]
pub async fn desktop_bundled_avatar_stream_open(
    input: NativeBundledAvatarRuntimeInput,
) -> NativeJsonOutcome {
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    // Stale-control cleanup drains every old stream slot, so a fresh open must
    // be verified before this attempt reserves its own placeholder.
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    let stream_id = format!("bundled-avatar-{}", COUNTER.fetch_add(1, Ordering::Relaxed));
    let current = super::DESKTOP_CONTROL.lock().await;
    if !current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, &control))
    {
        return NativeJsonOutcome::host_reason("runtime-service-unavailable", true);
    }
    let mut registry = streams().lock().await;
    if registry.len() >= MAX_BUNDLED_AVATAR_STREAMS {
        return NativeJsonOutcome::host_reason("resource-exhausted", false);
    }
    registry.insert(
        stream_id.clone(),
        StreamSlot::Opening(Arc::downgrade(&control)),
    );
    drop(registry);
    drop(current);
    let receiver = match control
        .open_bundled_avatar_stream(BundledAvatarRuntimeRequest {
            method_id: input.method_id,
            request_bytes: input.request_bytes.to_vec(),
            timeout,
        })
        .await
    {
        Ok(receiver) => receiver,
        Err(error) => {
            streams().lock().await.remove(stream_id.as_str());
            clear_desktop_control_on_transport_reason(
                &control,
                error.reason_code(),
                error.reason_metadata(),
            )
            .await;
            return NativeJsonOutcome::host_reason_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            );
        }
    };
    let (close_tx, _) = watch::channel(false);
    let stream = Arc::new(BundledAvatarStream {
        receiver: Mutex::new(Some(receiver)),
        close_tx,
        control: Arc::downgrade(&control),
    });
    let mut registry = streams().lock().await;
    let Some(slot @ StreamSlot::Opening(_)) = registry.get_mut(stream_id.as_str()) else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    *slot = StreamSlot::Open(stream);
    NativeJsonOutcome::success(json!({ "streamId": stream_id }))
}

#[napi(js_name = "desktopBundledAvatarStreamNext")]
pub async fn desktop_bundled_avatar_stream_next(
    input: NativeBundledAvatarStreamInput,
) -> NativeBundledAvatarStreamNextOutcome {
    let stream_id = input.stream_id;
    let stream = streams()
        .lock()
        .await
        .get(stream_id.as_str())
        .and_then(|slot| match slot {
            StreamSlot::Opening(_) => None,
            StreamSlot::Open(stream) => Some(stream.clone()),
        });
    let Some(stream) = stream else {
        return next_error("not-found", false);
    };
    let Ok(next) = next_stream_item(&stream.receiver, &stream.close_tx).await else {
        return next_error("runtime-service-untrusted", false);
    };
    match next {
        Some(Ok(bytes)) => NativeBundledAvatarStreamNextOutcome {
            status: "ok".to_string(),
            value: Some(Buffer::from(bytes)),
            completed: Some(false),
            reason_code: None,
            retryable: None,
            reason_metadata: None,
        },
        Some(Err(error)) => {
            streams().lock().await.remove(stream_id.as_str());
            if let Some(control) = stream.control.upgrade() {
                clear_desktop_control_on_transport_reason(
                    &control,
                    error.reason_code(),
                    error.reason_metadata(),
                )
                .await;
            }
            next_error_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            )
        }
        None => {
            streams().lock().await.remove(stream_id.as_str());
            next_completed()
        }
    }
}

#[napi(js_name = "desktopBundledAvatarStreamClose")]
pub async fn desktop_bundled_avatar_stream_close(
    input: NativeBundledAvatarStreamInput,
) -> NativeJsonOutcome {
    let stream = streams()
        .lock()
        .await
        .remove(input.stream_id.as_str())
        .and_then(opened_stream);
    let closed = stream.is_some();
    if let Some(stream) = stream {
        close_stream(stream).await;
    }
    NativeJsonOutcome::success(json!({ "closed": closed }))
}

fn next_completed() -> NativeBundledAvatarStreamNextOutcome {
    NativeBundledAvatarStreamNextOutcome {
        status: "ok".to_string(),
        value: None,
        completed: Some(true),
        reason_code: None,
        retryable: None,
        reason_metadata: None,
    }
}

fn next_error(
    reason_code: impl Into<String>,
    retryable: bool,
) -> NativeBundledAvatarStreamNextOutcome {
    next_error_with_metadata(reason_code, retryable, &Default::default())
}

fn next_error_with_metadata(
    reason_code: impl Into<String>,
    retryable: bool,
    reason_metadata: &std::collections::BTreeMap<String, String>,
) -> NativeBundledAvatarStreamNextOutcome {
    NativeBundledAvatarStreamNextOutcome {
        status: "error".to_string(),
        value: None,
        completed: None,
        reason_code: Some(reason_code.into()),
        retryable: Some(retryable),
        reason_metadata: (!reason_metadata.is_empty()).then(|| json!(reason_metadata)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{future::Future, task::Poll, time::Duration};

    #[tokio::test]
    async fn close_before_next_subscribes_does_not_wait_for_another_signal() {
        let (sender, receiver) = tokio::sync::mpsc::channel::<()>(1);
        let receiver = Mutex::new(Some(receiver));
        let (close_tx, _) = watch::channel(false);
        close_tx.send_replace(true);

        let next = tokio::time::timeout(
            Duration::from_secs(1),
            next_stream_item(&receiver, &close_tx),
        )
        .await
        .expect("a close before subscription must complete Next")
        .expect("only one Next owns this receiver");
        assert!(next.is_none());
        receiver.lock().await.take();
        assert!(sender.is_closed());
    }

    #[tokio::test]
    async fn close_releases_a_pending_next_and_its_receiver_lock() {
        let (sender, receiver) = tokio::sync::mpsc::channel::<()>(1);
        let receiver = Mutex::new(Some(receiver));
        let (close_tx, _) = watch::channel(false);
        let mut next = Box::pin(next_stream_item(&receiver, &close_tx));
        std::future::poll_fn(|context| {
            assert!(next.as_mut().poll(context).is_pending());
            Poll::Ready(())
        })
        .await;

        close_tx.send_replace(true);
        let (next, _) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(next, async { receiver.lock().await.take() })
        })
        .await
        .expect("Close must finish after waking the pending Next");
        assert!(next.expect("only one Next owns this receiver").is_none());
        assert!(sender.is_closed());
    }
}
