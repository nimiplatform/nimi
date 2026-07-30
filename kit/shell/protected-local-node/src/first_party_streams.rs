use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use nimi_shell_protected_local::{
    DesktopAccountProductStreamMethod, DesktopAccountProductStreamRequest,
    DesktopFirstPartyProductStreamReceiver, DesktopMachineProductStreamMethod,
    DesktopMachineProductStreamRequest, NimiDesktopControl,
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
    NativeBundledAvatarStreamNextOutcome, NativeFirstPartyProductInput,
    NativeFirstPartyProductStreamInput, NativeJsonOutcome,
};

struct FirstPartyProductStream {
    receiver: Mutex<Option<DesktopFirstPartyProductStreamReceiver>>,
    close_tx: watch::Sender<bool>,
    control: Weak<dyn NimiDesktopControl>,
}

type SharedStream = Arc<FirstPartyProductStream>;
type Registry = HashMap<String, Option<SharedStream>>;
const MAX_FIRST_PARTY_PRODUCT_STREAMS: usize = 16;
static STREAMS: OnceLock<Mutex<Registry>> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(1);

fn streams() -> &'static Mutex<Registry> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn close_stream(stream: SharedStream) {
    stream.close_tx.send_replace(true);
    stream.receiver.lock().await.take();
}

pub(super) async fn close_all_first_party_product_streams() -> usize {
    let mut registry = streams().lock().await;
    let count = registry.len();
    let active = registry
        .drain()
        .filter_map(|(_, stream)| stream)
        .collect::<Vec<_>>();
    drop(registry);
    for stream in active {
        close_stream(stream).await;
    }
    count
}

#[napi(js_name = "desktopMachineProductStreamOpen")]
pub async fn desktop_machine_product_stream_open(
    input: NativeFirstPartyProductInput,
) -> NativeJsonOutcome {
    let Some(method) = DesktopMachineProductStreamMethod::from_method_id(input.method_id.trim())
    else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    open_stream(input, |control, request_bytes, timeout| async move {
        control
            .open_machine_product_stream(DesktopMachineProductStreamRequest {
                method,
                request_bytes,
                timeout,
            })
            .await
    })
    .await
}

#[napi(js_name = "desktopAccountProductStreamOpen")]
pub async fn desktop_account_product_stream_open(
    input: NativeFirstPartyProductInput,
) -> NativeJsonOutcome {
    let Some(method) = DesktopAccountProductStreamMethod::from_method_id(input.method_id.trim())
    else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    open_stream(input, |control, request_bytes, timeout| async move {
        control
            .open_account_product_stream(DesktopAccountProductStreamRequest {
                method,
                request_bytes,
                timeout,
            })
            .await
    })
    .await
}

async fn open_stream<F, Fut>(input: NativeFirstPartyProductInput, open: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiDesktopControl>, Vec<u8>, Option<std::time::Duration>) -> Fut,
    Fut: std::future::Future<
        Output = Result<
            DesktopFirstPartyProductStreamReceiver,
            nimi_shell_protected_local::DesktopFirstPartyProductError,
        >,
    >,
{
    let stream_id = format!(
        "first-party-product-{}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut registry = streams().lock().await;
    if registry.len() >= MAX_FIRST_PARTY_PRODUCT_STREAMS {
        return NativeJsonOutcome::host_reason("resource-exhausted", false);
    }
    registry.insert(stream_id.clone(), None);
    drop(registry);
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => {
            streams().lock().await.remove(stream_id.as_str());
            return NativeJsonOutcome::host_error(error);
        }
    };
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    if timeout.is_some_and(|value| value.is_zero() || value > std::time::Duration::from_secs(300)) {
        streams().lock().await.remove(stream_id.as_str());
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    }
    let receiver = match open(control.clone(), input.request_bytes.to_vec(), timeout).await {
        Ok(receiver) => receiver,
        Err(error) => {
            streams().lock().await.remove(stream_id.as_str());
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            return NativeJsonOutcome::host_reason_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            );
        }
    };
    let (close_tx, _) = watch::channel(false);
    let stream = Arc::new(FirstPartyProductStream {
        receiver: Mutex::new(Some(receiver)),
        close_tx,
        control: Arc::downgrade(&control),
    });
    let mut registry = streams().lock().await;
    let Some(slot) = registry.get_mut(stream_id.as_str()) else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    *slot = Some(stream);
    NativeJsonOutcome::success(json!({ "streamId": stream_id }))
}

#[napi(js_name = "desktopFirstPartyProductStreamNext")]
pub async fn desktop_first_party_product_stream_next(
    input: NativeFirstPartyProductStreamInput,
) -> NativeBundledAvatarStreamNextOutcome {
    let stream_id = input.stream_id;
    let stream = streams()
        .lock()
        .await
        .get(stream_id.as_str())
        .and_then(Clone::clone);
    let Some(stream) = stream else {
        return next_error("not-found", false);
    };
    let mut close_rx = stream.close_tx.subscribe();
    let Ok(mut receiver_slot) = stream.receiver.try_lock() else {
        return next_error("runtime-service-untrusted", false);
    };
    let Some(receiver) = receiver_slot.as_mut() else {
        return next_completed();
    };
    let next = tokio::select! {
        biased;
        changed = close_rx.changed() => { let _ = changed; None }
        next = receiver.recv() => next,
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
                clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
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

#[napi(js_name = "desktopFirstPartyProductStreamClose")]
pub async fn desktop_first_party_product_stream_close(
    input: NativeFirstPartyProductStreamInput,
) -> NativeJsonOutcome {
    let stream = streams()
        .lock()
        .await
        .remove(input.stream_id.as_str())
        .flatten();
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
