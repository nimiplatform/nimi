#![deny(unsafe_code)]

use napi_derive::napi;
#[cfg(not(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
)))]
use nimi_shell_protected_local::FixedRuntimeServiceControl;
#[cfg(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
))]
use nimi_shell_protected_local::NimiHostErrorReasonCode;
use nimi_shell_protected_local::{
    BundledAvatarRuntimeRequest, DesktopAccountActionRequest, DesktopAccountBeginLoginRequest,
    DesktopAccountBeginLoginResponse, DesktopAccountCompleteLoginRequest,
    DesktopAccountMutationResponse, DesktopAccountProductUnaryMethod,
    DesktopAccountProductUnaryRequest, DesktopAccountProjection, DesktopAccountRealmUnaryRequest,
    DesktopAccountRealmUnaryResponse, DesktopAccountSessionEvent,
    DesktopAccountSessionStatusRequest, DesktopMachineProductUnaryMethod,
    DesktopMachineProductUnaryRequest, LocalAppAIConfigLocalOptionsRequest,
    LocalAppAIConfigOverwriteRequest, LocalAppAgentCommitPresentationRequest,
    LocalAppAgentHandleRequest, LocalAppAgentManagerSnapshotRequest,
    LocalAppAgentMemoryCorrectRequest, LocalAppAgentMemoryDeleteRequest,
    LocalAppAgentMemoryForgetRequest, LocalAppAgentMemoryInspectRequest,
    LocalAppAgentMemorySwitchRequest, LocalAppAgentPresentationAssetInput,
    LocalAppAgentPresentationAssetReadRequest, LocalAppAgentRealtimeAppendInputRequest,
    LocalAppAgentRealtimeOpenRequest, LocalAppAgentRealtimeOutputInterruptRequest,
    LocalAppAgentRealtimeSessionRequest, LocalAppAgentReference,
    LocalAppAgentUpdateAutonomyRequest, LocalAppAiRealtimeAppendInputRequest,
    LocalAppAiRealtimeOpenRequest, LocalAppAiRealtimeOutputInterruptRequest,
    LocalAppAiRealtimeOwnerControlRequest, LocalAppAiRealtimeSessionRequest,
    LocalAppAssetAdoptRequest, LocalAppAssetListRequest, LocalAppAssetMoveRequest,
    LocalAppAssetReadReceiver, LocalAppAssetReadRequest, LocalAppAssetRecord,
    LocalAppAssetRemoveRequest, LocalAppAssetRevealRequest, LocalAppAssetStatRequest,
    LocalAppAssetWriteRequest, LocalAppConversationArtifactReadRequest,
    LocalAppConversationAttachmentUploadRequest, LocalAppConversationEvent,
    LocalAppConversationEventKind, LocalAppConversationInputPart,
    LocalAppConversationInterruptRequest, LocalAppConversationMessageRole,
    LocalAppConversationOpenRequest, LocalAppConversationSendRequest,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver, LocalAppConversationVoiceRenderRequest,
    LocalAppConversationVoiceTranscriptionRequest, LocalAppEmbodimentSnapshotRequest,
    LocalAppEmbodimentSubscribeRequest, LocalAppOperationError,
    LocalAppPersonaCharacterCreateRequest, LocalAppPersonaCharacterDeleteRequest,
    LocalAppPersonaCharacterGetOwnedRequest, LocalAppPersonaCharacterListOwnedRequest,
    LocalAppPersonaCharacterReplaceRequest, LocalAppRealmChatListRequest,
    LocalAppRealmRealtimeAckRequest, LocalAppRealmRealtimeChannelRequest,
    LocalAppRealmRealtimeOpenRequest, LocalAppRealmRealtimeSubscribeRequest,
    LocalAppRealmRealtimeSubscriptionRequest, LocalAppRealtimeSubscriptionReceiver,
    LocalAppReasonCode, LocalAppScenarioCancelRequest, LocalAppScenarioExecuteRequest,
    LocalAppScenarioGetRequest, LocalAppScenarioJobSubscribeRequest,
    LocalAppScenarioListVoiceAssetsRequest, LocalAppScenarioReadArtifactRequest,
    LocalAppScenarioStreamReceiver, LocalAppScenarioSubmitRequest,
    LocalAppScenarioUploadArtifactRequest, LocalAppSessionStatus,
    LocalAppSharedAgentAIConfigLocalOptionsRequest, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageWriteRequest,
    LocalAppTextCandidateMessage, LocalAppTextCandidateRequest, LocalAppTextTurnRequest,
    LocalAppWorldCoreCreateRequest, LocalAppWorldCoreListRequest, LocalDevelopmentEndRunRequest,
    LocalDevelopmentLaunchRequest, LocalDevelopmentRegistration,
    LocalDevelopmentRegistrationRequest, LocalDevelopmentShellKind, NimiDesktopControl,
    NimiHostError, NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError, RuntimeServiceActionOutcome,
};
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::{MacOsLocalAppCarrier, MacOsUnixSocketCarrier};
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::{WindowsLocalAppCarrier, WindowsNamedPipeCarrier};
use serde_json::{json, Value as JsonValue};
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    sync::{Arc, LazyLock},
    time::Duration,
};
use tokio::sync::{Mutex, Notify};

static LOCAL_APP_SESSION: Mutex<Option<Arc<dyn NimiLocalAppSession>>> = Mutex::const_new(None);
static DESKTOP_CONTROL: Mutex<Option<Arc<dyn NimiDesktopControl>>> = Mutex::const_new(None);
const FIRST_PARTY_UNARY_MAX_DURATION: Duration = Duration::from_secs(300);
#[cfg(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
))]
const DESKTOP_CONTROL_OPEN_TIMEOUT: Duration = Duration::from_secs(5);

static FIRST_PARTY_UNARY_CANCELLATIONS: LazyLock<Mutex<FirstPartyUnaryCancellationRegistry>> =
    LazyLock::new(|| Mutex::new(FirstPartyUnaryCancellationRegistry::default()));

tokio::task_local! {
    // Transport invalidation cancels stale peer operations, but the operation
    // that detected the stale control must survive its bounded fresh bind.
    static CURRENT_FIRST_PARTY_UNARY_CANCELLATION: Arc<Notify>;
}

#[derive(Default)]
struct FirstPartyUnaryCancellationRegistry {
    entries: HashMap<String, FirstPartyUnaryCancellation>,
}

enum FirstPartyUnaryCancellation {
    Pending,
    Active(Arc<Notify>),
    Completed,
}

#[cfg(target_os = "macos")]
type PlatformDesktopCarrier = MacOsUnixSocketCarrier;
#[cfg(target_os = "windows")]
type PlatformDesktopCarrier = WindowsNamedPipeCarrier;
#[cfg(target_os = "macos")]
type PlatformLocalAppCarrier = MacOsLocalAppCarrier;
#[cfg(target_os = "windows")]
type PlatformLocalAppCarrier = WindowsLocalAppCarrier;

mod account_events;
mod bundled_avatar_streams;
mod first_party_client_stream;
mod first_party_streams;
mod local_app;
mod native_types;
mod projection;
pub use account_events::*;
pub use bundled_avatar_streams::*;
pub use first_party_client_stream::*;
pub use first_party_streams::*;
pub use local_app::*;
pub use native_types::*;
use projection::*;

#[napi(js_name = "desktopMachineProductUnary")]
pub async fn desktop_machine_product_unary(
    input: NativeFirstPartyProductUnaryInput,
) -> NativeBytesOutcome {
    let request_id = match admitted_first_party_unary_request_id(input.request_id) {
        Some(request_id) => request_id,
        None => return NativeBytesOutcome::error("runtime-service-untrusted", false),
    };
    run_first_party_unary(request_id, async move {
        let Some(method) = DesktopMachineProductUnaryMethod::from_method_id(input.method_id.trim())
        else {
            return NativeBytesOutcome::error("runtime-service-untrusted", false);
        };
        let timeout = input
            .timeout_ms
            .map(u64::from)
            .map(std::time::Duration::from_millis);
        if !machine_product_timeout_allowed(method, timeout) {
            return NativeBytesOutcome::error("runtime-service-untrusted", false);
        }
        let control = match current_or_open_desktop_control().await {
            Ok(control) => control,
            Err(error) => return NativeBytesOutcome::host_error(error),
        };
        match control
            .invoke_machine_product_unary(DesktopMachineProductUnaryRequest {
                method,
                request_bytes: input.request_bytes.to_vec(),
                timeout,
            })
            .await
        {
            Ok(response) => NativeBytesOutcome::success(response.response_bytes),
            Err(error) => {
                clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
                NativeBytesOutcome::error_with_metadata(
                    error.reason_code(),
                    error.retryable(),
                    error.reason_metadata(),
                )
            }
        }
    })
    .await
}

#[napi(js_name = "desktopAccountProductUnary")]
pub async fn desktop_account_product_unary(
    input: NativeFirstPartyProductUnaryInput,
) -> NativeBytesOutcome {
    let request_id = match admitted_first_party_unary_request_id(input.request_id) {
        Some(request_id) => request_id,
        None => return NativeBytesOutcome::error("runtime-service-untrusted", false),
    };
    run_first_party_unary(request_id, async move {
        let Some(method) = DesktopAccountProductUnaryMethod::from_method_id(input.method_id.trim())
        else {
            return NativeBytesOutcome::error("runtime-service-untrusted", false);
        };
        let timeout = input
            .timeout_ms
            .map(u64::from)
            .map(std::time::Duration::from_millis);
        if timeout.is_some_and(|value| value.is_zero() || value > FIRST_PARTY_UNARY_MAX_DURATION) {
            return NativeBytesOutcome::error("runtime-service-untrusted", false);
        }
        let control = match current_or_open_desktop_control().await {
            Ok(control) => control,
            Err(error) => return NativeBytesOutcome::host_error(error),
        };
        match control
            .invoke_account_product_unary(DesktopAccountProductUnaryRequest {
                method,
                request_bytes: input.request_bytes.to_vec(),
                timeout,
            })
            .await
        {
            Ok(response) => NativeBytesOutcome::success(response.response_bytes),
            Err(error) => {
                clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
                NativeBytesOutcome::error_with_metadata(
                    error.reason_code(),
                    error.retryable(),
                    error.reason_metadata(),
                )
            }
        }
    })
    .await
}

#[napi(js_name = "desktopFirstPartyProductUnaryCancel")]
pub async fn desktop_first_party_product_unary_cancel(
    input: NativeFirstPartyProductUnaryCancelInput,
) -> NativeJsonOutcome {
    let Some(request_id) = admitted_first_party_unary_request_id(input.request_id) else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    {
        let mut registry = FIRST_PARTY_UNARY_CANCELLATIONS.lock().await;
        let canceled = match registry.entries.get(&request_id) {
            Some(FirstPartyUnaryCancellation::Active(cancellation)) => {
                cancellation.notify_one();
                true
            }
            Some(FirstPartyUnaryCancellation::Pending) => true,
            Some(FirstPartyUnaryCancellation::Completed) => false,
            None => {
                registry
                    .entries
                    .insert(request_id, FirstPartyUnaryCancellation::Pending);
                true
            }
        };
        return NativeJsonOutcome::success(json!({ "canceled": canceled }));
    }
}

#[napi(js_name = "desktopFirstPartyProductUnaryRelease")]
pub async fn desktop_first_party_product_unary_release(
    input: NativeFirstPartyProductUnaryCancelInput,
) -> NativeJsonOutcome {
    let Some(request_id) = admitted_first_party_unary_request_id(input.request_id) else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    let mut registry = FIRST_PARTY_UNARY_CANCELLATIONS.lock().await;
    let released = matches!(
        registry.entries.get(&request_id),
        Some(FirstPartyUnaryCancellation::Pending | FirstPartyUnaryCancellation::Completed)
    );
    if released {
        registry.entries.remove(&request_id);
    }
    NativeJsonOutcome::success(json!({ "released": released }))
}

async fn run_first_party_unary<F>(request_id: String, operation: F) -> NativeBytesOutcome
where
    F: Future<Output = NativeBytesOutcome>,
{
    let cancellation = Arc::new(Notify::new());
    {
        let mut registry = FIRST_PARTY_UNARY_CANCELLATIONS.lock().await;
        match registry.entries.remove(&request_id) {
            Some(FirstPartyUnaryCancellation::Pending) => {
                registry
                    .entries
                    .insert(request_id, FirstPartyUnaryCancellation::Completed);
                return NativeBytesOutcome::error("runtime-request-canceled", false);
            }
            Some(existing) => {
                registry.entries.insert(request_id, existing);
                return NativeBytesOutcome::error("runtime-service-untrusted", false);
            }
            None => {}
        }
        registry.entries.insert(
            request_id.clone(),
            FirstPartyUnaryCancellation::Active(Arc::clone(&cancellation)),
        );
    }
    let cancellation_signal = Arc::clone(&cancellation);
    let outcome = CURRENT_FIRST_PARTY_UNARY_CANCELLATION
        .scope(Arc::clone(&cancellation), async move {
            tokio::pin!(operation);
            tokio::select! {
                biased;
                outcome = &mut operation => outcome,
                () = cancellation_signal.notified() => NativeBytesOutcome::error("runtime-request-canceled", false),
            }
        })
        .await;
    let mut registry = FIRST_PARTY_UNARY_CANCELLATIONS.lock().await;
    if matches!(
        registry.entries.get(&request_id),
        Some(FirstPartyUnaryCancellation::Active(current)) if Arc::ptr_eq(current, &cancellation)
    ) {
        registry
            .entries
            .insert(request_id, FirstPartyUnaryCancellation::Completed);
    }
    outcome
}

async fn cancel_active_and_clear_completed_first_party_unaries() {
    let current = CURRENT_FIRST_PARTY_UNARY_CANCELLATION
        .try_with(Arc::clone)
        .ok();
    let active_cancellations = {
        let mut registry = FIRST_PARTY_UNARY_CANCELLATIONS.lock().await;
        let mut active = Vec::new();
        registry.entries.retain(|_, entry| match entry {
            FirstPartyUnaryCancellation::Pending => true,
            FirstPartyUnaryCancellation::Active(cancellation)
                if current
                    .as_ref()
                    .is_some_and(|current| Arc::ptr_eq(current, cancellation)) =>
            {
                true
            }
            FirstPartyUnaryCancellation::Active(cancellation) => {
                active.push(Arc::clone(cancellation));
                false
            }
            FirstPartyUnaryCancellation::Completed => false,
        });
        active
    };
    for cancellation in active_cancellations {
        cancellation.notify_one();
    }
}

fn admitted_first_party_unary_request_id(value: String) -> Option<String> {
    let request_id = value.trim();
    if request_id.is_empty()
        || request_id.len() > 160
        || !request_id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b':' | b'-'))
        })
    {
        return None;
    }
    Some(request_id.to_owned())
}

#[cfg(test)]
mod first_party_unary_cancellation_tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    static CANCELLATION_TEST_LOCK: Mutex<()> = Mutex::const_new(());

    struct DropMarker(Arc<AtomicBool>);

    impl Drop for DropMarker {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn cancel_before_registration_is_consumed_without_polling_the_operation() {
        let _guard = CANCELLATION_TEST_LOCK.lock().await;
        let operation_polled = Arc::new(AtomicBool::new(false));
        let cancellation =
            desktop_first_party_product_unary_cancel(NativeFirstPartyProductUnaryCancelInput {
                request_id: "desktop-protected-account-unary-before-register".to_owned(),
            })
            .await;
        assert_eq!(cancellation.status, "ok");
        assert_eq!(cancellation.value, Some(json!({ "canceled": true })));

        let polled = Arc::clone(&operation_polled);
        let outcome = run_first_party_unary(
            "desktop-protected-account-unary-before-register".to_owned(),
            async move {
                polled.store(true, Ordering::SeqCst);
                NativeBytesOutcome::success(Vec::new())
            },
        )
        .await;

        assert_eq!(
            outcome.reason_code.as_deref(),
            Some("runtime-request-canceled")
        );
        assert!(!operation_polled.load(Ordering::SeqCst));
        let release =
            desktop_first_party_product_unary_release(NativeFirstPartyProductUnaryCancelInput {
                request_id: "desktop-protected-account-unary-before-register".to_owned(),
            })
            .await;
        assert_eq!(release.value, Some(json!({ "released": true })));
        assert!(!FIRST_PARTY_UNARY_CANCELLATIONS
            .lock()
            .await
            .entries
            .contains_key("desktop-protected-account-unary-before-register"));

        desktop_first_party_product_unary_cancel(NativeFirstPartyProductUnaryCancelInput {
            request_id: "desktop-protected-account-unary-lifecycle-cleanup".to_owned(),
        })
        .await;
        cancel_active_and_clear_completed_first_party_unaries().await;
        assert!(matches!(
            FIRST_PARTY_UNARY_CANCELLATIONS
                .lock()
                .await
                .entries
                .get("desktop-protected-account-unary-lifecycle-cleanup"),
            Some(FirstPartyUnaryCancellation::Pending)
        ));
        let lifecycle_release =
            desktop_first_party_product_unary_release(NativeFirstPartyProductUnaryCancelInput {
                request_id: "desktop-protected-account-unary-lifecycle-cleanup".to_owned(),
            })
            .await;
        assert_eq!(lifecycle_release.value, Some(json!({ "released": true })));
        assert!(!FIRST_PARTY_UNARY_CANCELLATIONS
            .lock()
            .await
            .entries
            .contains_key("desktop-protected-account-unary-lifecycle-cleanup"));
    }

    #[tokio::test]
    async fn request_keyed_cancel_drops_the_inflight_native_operation_before_request_completion() {
        let _guard = CANCELLATION_TEST_LOCK.lock().await;
        let started = Arc::new(Notify::new());
        let dropped = Arc::new(AtomicBool::new(false));
        let operation_started = Arc::clone(&started);
        let operation_dropped = Arc::clone(&dropped);
        let task = tokio::spawn(run_first_party_unary(
            "runtime-client-unary-native-test".to_owned(),
            async move {
                let _drop_marker = DropMarker(operation_dropped);
                operation_started.notify_one();
                std::future::pending::<NativeBytesOutcome>().await
            },
        ));
        started.notified().await;

        let cancellation =
            desktop_first_party_product_unary_cancel(NativeFirstPartyProductUnaryCancelInput {
                request_id: "runtime-client-unary-native-test".to_owned(),
            })
            .await;
        assert_eq!(cancellation.status, "ok");
        assert_eq!(cancellation.value, Some(json!({ "canceled": true })));

        let outcome = task.await.expect("cancellable unary task must join");
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some("runtime-request-canceled")
        );
        assert!(dropped.load(Ordering::SeqCst));
        let release =
            desktop_first_party_product_unary_release(NativeFirstPartyProductUnaryCancelInput {
                request_id: "runtime-client-unary-native-test".to_owned(),
            })
            .await;
        assert_eq!(release.value, Some(json!({ "released": true })));
        assert!(!FIRST_PARTY_UNARY_CANCELLATIONS
            .lock()
            .await
            .entries
            .contains_key("runtime-client-unary-native-test"));
    }

    #[tokio::test]
    async fn transport_cleanup_cancels_stale_peers_without_canceling_the_triggering_unary() {
        let _guard = CANCELLATION_TEST_LOCK.lock().await;
        let peer_started = Arc::new(Notify::new());
        let peer_started_signal = Arc::clone(&peer_started);
        let peer = tokio::spawn(run_first_party_unary(
            "desktop-protected-peer-before-reconnect".to_owned(),
            async move {
                peer_started_signal.notify_one();
                std::future::pending::<NativeBytesOutcome>().await
            },
        ));
        peer_started.notified().await;

        let trigger_request_id = "desktop-protected-triggering-reconnect";
        let trigger = run_first_party_unary(trigger_request_id.to_owned(), async {
            cancel_active_and_clear_completed_first_party_unaries().await;
            NativeBytesOutcome::success(vec![1])
        })
        .await;
        assert_eq!(trigger.status, "ok");
        assert_eq!(trigger.value.as_deref(), Some(&[1][..]));

        let peer = peer.await.expect("stale peer task must join");
        assert_eq!(
            peer.reason_code.as_deref(),
            Some("runtime-request-canceled")
        );
        assert!(matches!(
            FIRST_PARTY_UNARY_CANCELLATIONS
                .lock()
                .await
                .entries
                .get(trigger_request_id),
            Some(FirstPartyUnaryCancellation::Completed)
        ));
        let release =
            desktop_first_party_product_unary_release(NativeFirstPartyProductUnaryCancelInput {
                request_id: trigger_request_id.to_owned(),
            })
            .await;
        assert_eq!(release.value, Some(json!({ "released": true })));
    }

    #[tokio::test]
    async fn completion_wins_a_late_cancel_until_explicit_release_cleans_the_registry() {
        let _guard = CANCELLATION_TEST_LOCK.lock().await;
        let request_id = "desktop-protected-account-unary-completed-before-cancel";
        let outcome = run_first_party_unary(request_id.to_owned(), async {
            NativeBytesOutcome::success(Vec::new())
        })
        .await;
        assert_eq!(outcome.status, "ok");

        let cancellation =
            desktop_first_party_product_unary_cancel(NativeFirstPartyProductUnaryCancelInput {
                request_id: request_id.to_owned(),
            })
            .await;
        assert_eq!(cancellation.value, Some(json!({ "canceled": false })));
        assert!(matches!(
            FIRST_PARTY_UNARY_CANCELLATIONS
                .lock()
                .await
                .entries
                .get(request_id),
            Some(FirstPartyUnaryCancellation::Completed)
        ));

        let release =
            desktop_first_party_product_unary_release(NativeFirstPartyProductUnaryCancelInput {
                request_id: request_id.to_owned(),
            })
            .await;
        assert_eq!(release.value, Some(json!({ "released": true })));
        assert!(!FIRST_PARTY_UNARY_CANCELLATIONS
            .lock()
            .await
            .entries
            .contains_key(request_id));
    }
}

#[napi(js_name = "desktopBundledAvatarUnary")]
pub async fn desktop_bundled_avatar_unary(
    input: NativeFirstPartyProductUnaryInput,
) -> NativeBytesOutcome {
    let request_id = match admitted_first_party_unary_request_id(input.request_id) {
        Some(request_id) => request_id,
        None => return NativeBytesOutcome::error("runtime-service-untrusted", false),
    };
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    run_first_party_unary(request_id, async move {
        let control = match current_or_open_desktop_control().await {
            Ok(control) => control,
            Err(error) => return NativeBytesOutcome::host_error(error),
        };
        match control
            .invoke_bundled_avatar(BundledAvatarRuntimeRequest {
                method_id: input.method_id,
                request_bytes: input.request_bytes.to_vec(),
                timeout,
            })
            .await
        {
            Ok(response) => NativeBytesOutcome::success(response.response_bytes),
            Err(error) => {
                clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
                NativeBytesOutcome::error_with_metadata(
                    error.reason_code(),
                    error.retryable(),
                    error.reason_metadata(),
                )
            }
        }
    })
    .await
}

fn machine_product_timeout_allowed(
    _method: DesktopMachineProductUnaryMethod,
    timeout: Option<std::time::Duration>,
) -> bool {
    let maximum = FIRST_PARTY_UNARY_MAX_DURATION;
    timeout.is_none_or(|value| !value.is_zero() && value <= maximum)
}

#[cfg(test)]
mod first_party_product_timeout_tests {
    use super::*;

    #[test]
    fn machine_product_methods_keep_the_five_minute_bound() {
        assert!(machine_product_timeout_allowed(
            DesktopMachineProductUnaryMethod::GetProductControlRecord,
            Some(std::time::Duration::from_secs(300)),
        ));
        assert!(!machine_product_timeout_allowed(
            DesktopMachineProductUnaryMethod::GetProductControlRecord,
            Some(std::time::Duration::from_secs(301)),
        ));
        assert!(!machine_product_timeout_allowed(
            DesktopMachineProductUnaryMethod::GetProductControlRecord,
            Some(std::time::Duration::ZERO),
        ));
    }
}

#[napi(js_name = "desktopAccountSessionStatus")]
pub async fn desktop_account_session_status() -> NativeJsonOutcome {
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match control
        .get_account_session_status(DesktopAccountSessionStatusRequest {
            app_id: "nimi.desktop".to_string(),
            app_instance_id: "nimi.desktop.local-first-party".to_string(),
            device_id: "desktop-shell".to_string(),
        })
        .await
    {
        Ok(status) => NativeJsonOutcome::success(json!({
            "sequence": status.sequence.to_string(),
            "state": status.state.as_str(),
            "reasonCode": status.reason_code,
            "accountReasonCode": status.account_reason_code,
            "accountProjection": status.account_projection.map(project_account_projection),
        })),
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
    }
}

#[napi(js_name = "desktopAccountBeginLogin")]
pub async fn desktop_account_begin_login(
    input: NativeDesktopAccountBeginLoginInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .begin_account_login(DesktopAccountBeginLoginRequest {
                redirect_uri: input.redirect_uri,
                callback_origin: input.callback_origin,
                requested_scopes: input.requested_scopes,
                ttl_seconds: input.ttl_seconds,
            })
            .await
            .map(project_account_begin_login)
    })
    .await
}

#[napi(js_name = "desktopAccountCompleteLogin")]
pub async fn desktop_account_complete_login(
    input: NativeDesktopAccountCompleteLoginInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .complete_account_login(DesktopAccountCompleteLoginRequest {
                login_attempt_id: input.login_attempt_id,
                code: input.code,
                state: input.state,
                nonce: input.nonce,
                redirect_uri: input.redirect_uri,
                callback_origin: input.callback_origin,
            })
            .await
            .map(project_account_mutation)
    })
    .await
}

#[napi(js_name = "desktopAccountInvokeRealmUnary")]
pub async fn desktop_account_invoke_realm_unary(
    input: NativeDesktopAccountRealmUnaryInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .invoke_account_realm_unary(DesktopAccountRealmUnaryRequest {
                method_id: input.method_id,
                request_json: input.request_json,
                timeout_ms: input.timeout_ms,
                idempotency_key: input.idempotency_key,
            })
            .await
            .map(project_account_realm_unary)
    })
    .await
}

#[napi(js_name = "desktopAccountLogout")]
pub async fn desktop_account_logout(input: NativeDesktopAccountActionInput) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .logout_account(DesktopAccountActionRequest {
                reason: input.reason,
            })
            .await
            .map(project_account_mutation)
    })
    .await
}

#[napi(js_name = "desktopAccountSwitchAccount")]
pub async fn desktop_account_switch_account(
    input: NativeDesktopAccountActionInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .switch_account(DesktopAccountActionRequest {
                reason: input.reason,
            })
            .await
            .map(project_account_mutation)
    })
    .await
}

#[napi(js_name = "fixedRuntimeServiceStatus")]
pub async fn fixed_runtime_service_status() -> NativeJsonOutcome {
    match current_or_open_desktop_control().await {
        Ok(_) => NativeJsonOutcome::success(project_verified_runtime_service_running()),
        Err(error) => NativeJsonOutcome::host_error(error),
    }
}

#[napi(js_name = "fixedRuntimeServiceStart")]
pub async fn fixed_runtime_service_start() -> NativeJsonOutcome {
    #[cfg(any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    ))]
    {
        return NativeJsonOutcome::host_reason("runtime-service-unavailable", false);
    }
    #[cfg(not(any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    )))]
    if current_or_open_desktop_control().await.is_ok() {
        return NativeJsonOutcome::success(project_verified_runtime_service_running());
    }
    #[cfg(not(any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    )))]
    match PlatformDesktopCarrier::default().request_runtime_service_start() {
        Ok(outcome) => NativeJsonOutcome::success(project_runtime_service_action(outcome)),
        Err(error) => NativeJsonOutcome::protected_error(error),
    }
}

#[napi(js_name = "fixedRuntimeServiceRestart")]
pub async fn fixed_runtime_service_restart() -> NativeJsonOutcome {
    #[cfg(any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    ))]
    {
        return NativeJsonOutcome::host_reason("runtime-service-unavailable", false);
    }
    #[cfg(not(any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    )))]
    {
        // Runtime admits one mutually verified Desktop pipe connection at a time.
        // Keep the owner slot locked across the restart so a concurrent renderer
        // status/product-control call cannot observe the old transport failure,
        // clear the slot, and win the replacement pipe before the restart verifier.
        let mut current = DESKTOP_CONTROL.lock().await;
        let control = match current.as_ref() {
            Some(control) => control.clone(),
            None => {
                let opened = match PlatformDesktopCarrier::default()
                    .open_desktop_control()
                    .await
                {
                    Ok(opened) => opened,
                    Err(error) => return NativeJsonOutcome::host_error(NimiHostError::from(error)),
                };
                let control = Arc::<dyn NimiDesktopControl>::from(opened);
                *current = Some(control.clone());
                control
            }
        };
        let result = control.request_runtime_service_restart().await;
        if current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, &control))
        {
            *current = None;
        }
        drop(current);
        cancel_active_and_clear_completed_first_party_unaries().await;
        account_events::close_all_account_event_streams().await;
        bundled_avatar_streams::close_all_bundled_avatar_streams().await;
        first_party_streams::close_all_first_party_product_streams().await;
        control.invalidate_cached_transport().await;
        match result {
            Ok(outcome) => NativeJsonOutcome::success(project_runtime_service_action(outcome)),
            Err(error) => NativeJsonOutcome::protected_error(error),
        }
    }
}

#[napi(js_name = "desktopDeveloperModeStatus")]
pub async fn desktop_developer_mode_status() -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .get_developer_mode_status()
            .await
            .map(project_developer_mode_status)
    })
    .await
}

#[napi(js_name = "desktopDeveloperModeSet")]
pub async fn desktop_developer_mode_set(input: NativeDeveloperModeSetInput) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .set_developer_mode(input.enabled)
            .await
            .map(project_developer_mode_status)
    })
    .await
}

#[napi(js_name = "desktopRegisterLocalDevelopmentProject")]
pub async fn desktop_register_local_development_project(
    input: NativeLocalDevelopmentRegisterInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let shell_kind = match local_development_shell(&input.shell) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .register_local_development_project(LocalDevelopmentRegistrationRequest {
                expected_app_id: input.expected_app_id,
                project_root: PathBuf::from(input.project_root),
                shell_kind,
                supervisor_run_id,
            })
            .await
            .map(project_local_development_registration)
    })
    .await
}

#[napi(js_name = "desktopListLocalDevelopmentRegistrations")]
pub async fn desktop_list_local_development_registrations() -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .list_local_development_registrations()
            .await
            .map(|rows| {
                JsonValue::Array(
                    rows.into_iter()
                        .map(project_local_development_registration)
                        .collect(),
                )
            })
    })
    .await
}

#[napi(js_name = "desktopRemoveLocalDevelopmentRegistration")]
pub async fn desktop_remove_local_development_registration(
    input: NativeLocalDevelopmentRegistrationInput,
) -> NativeJsonOutcome {
    let registration_handle = match decode_identifier(&input.registration_handle) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .remove_local_development_registration(registration_handle)
            .await
            .map(|()| json!({ "removed": true }))
    })
    .await
}

#[napi(js_name = "desktopLaunchLocalDevelopmentHost")]
pub async fn desktop_launch_local_development_host(
    input: NativeLocalDevelopmentLaunchInput,
) -> NativeJsonOutcome {
    let registration_handle = match decode_identifier(&input.registration_handle) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let shell_kind = match local_development_shell(&input.shell) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .launch_local_development_host(LocalDevelopmentLaunchRequest {
                registration_handle,
                supervisor_run_id,
                shell_kind,
                host_executable_path: PathBuf::from(input.host_executable_path),
                renderer_origin: input.renderer_origin,
                host_arguments: input.host_arguments,
                working_directory: PathBuf::from(input.working_directory),
            })
            .await
            .map(|outcome| {
                json!({
                    "processId": outcome.process_id,
                    "bindDeadlineUnixMs": outcome.bind_deadline_unix_ms,
                })
            })
    })
    .await
}

#[napi(js_name = "desktopLocalDevelopmentHostRunning")]
pub async fn desktop_local_development_host_running(
    input: NativeLocalDevelopmentRunInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match control.local_development_host_running(supervisor_run_id) {
        Ok(running) => NativeJsonOutcome::success(json!({ "running": running })),
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
    }
}

#[napi(js_name = "desktopTerminateLocalDevelopmentHost")]
pub async fn desktop_terminate_local_development_host(
    input: NativeLocalDevelopmentRunInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    #[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
    {
        return match nimi_shell_protected_local::terminate_source_local_development_host(
            supervisor_run_id,
        ) {
            Ok(()) => NativeJsonOutcome::success(json!({ "terminated": true })),
            Err(error) => NativeJsonOutcome::host_error(error),
        };
    }
    #[cfg(not(all(target_os = "windows", feature = "windows-source-local-development")))]
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    #[cfg(not(all(target_os = "windows", feature = "windows-source-local-development")))]
    match control.terminate_local_development_host(supervisor_run_id) {
        Ok(()) => NativeJsonOutcome::success(json!({ "terminated": true })),
        Err(error) => NativeJsonOutcome::host_error(error),
    }
}

#[napi(js_name = "desktopEndLocalDevelopmentRun")]
pub async fn desktop_end_local_development_run(
    input: NativeLocalDevelopmentEndRunInput,
) -> NativeJsonOutcome {
    let registration_handle = match decode_identifier(&input.registration_handle) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .end_local_development_run(LocalDevelopmentEndRunRequest {
                registration_handle,
                supervisor_run_id,
            })
            .await
            .map(|()| json!({ "ended": true }))
    })
    .await
}

async fn invoke_desktop_json<F, Fut>(operation: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiDesktopControl>) -> Fut,
    Fut: std::future::Future<Output = Result<JsonValue, NimiHostError>>,
{
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    match operation(control.clone()).await {
        Ok(value) => NativeJsonOutcome::success(value),
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
    }
}

#[cfg(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
))]
async fn current_or_open_desktop_control() -> Result<Arc<dyn NimiDesktopControl>, NimiHostError> {
    let mut reconnect_available = true;
    loop {
        let cached = {
            let current = DESKTOP_CONTROL.lock().await;
            current.as_ref().cloned()
        };
        if let Some(control) = cached {
            match control.get_developer_mode_status().await {
                Ok(_) => return Ok(control),
                Err(error) => {
                    let reconnect = reconnect_available
                        && invalidates_desktop_transport(error.reason_code().as_str());
                    clear_desktop_control_on_host_failure(&control, &error).await;
                    if !reconnect {
                        return Err(error);
                    }
                    reconnect_available = false;
                    drop(control);
                    continue;
                }
            }
        }
        return get_or_open_cached_desktop_control(
            &DESKTOP_CONTROL,
            DESKTOP_CONTROL_OPEN_TIMEOUT,
            || async {
                let opened = PlatformDesktopCarrier::default()
                    .open_desktop_control()
                    .await
                    .map_err(NimiHostError::from)?;
                Ok(Arc::<dyn NimiDesktopControl>::from(opened))
            },
        )
        .await;
    }
}

#[cfg(not(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
)))]
async fn current_or_open_desktop_control() -> Result<Arc<dyn NimiDesktopControl>, NimiHostError> {
    let mut current = DESKTOP_CONTROL.lock().await;
    if let Some(control) = current.as_ref() {
        return Ok(control.clone());
    }
    let opened = PlatformDesktopCarrier::default()
        .open_desktop_control()
        .await
        .map_err(NimiHostError::from)?;
    let control = Arc::<dyn NimiDesktopControl>::from(opened);
    *current = Some(control.clone());
    Ok(control)
}

#[cfg(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
))]
async fn get_or_open_cached_desktop_control<T, F, Fut>(
    slot: &Mutex<Option<T>>,
    open_timeout: Duration,
    open: F,
) -> Result<T, NimiHostError>
where
    T: Clone + Send,
    F: FnOnce() -> Fut + Send,
    Fut: Future<Output = Result<T, NimiHostError>> + Send,
{
    // Source Runtime admits one active Desktop connection. Serialize the
    // cache-miss open and re-check under the same lock so concurrent callers
    // cannot create a second connection; bound the open while holding it.
    let mut current = slot.lock().await;
    if let Some(control) = current.as_ref() {
        return Ok(control.clone());
    }
    let control = tokio::time::timeout(open_timeout, open())
        .await
        .map_err(|_| {
            NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true)
        })??;
    *current = Some(control.clone());
    Ok(control)
}

async fn clear_desktop_control_on_transport_reason(
    control: &Arc<dyn NimiDesktopControl>,
    reason_code: &str,
) {
    if !invalidates_desktop_transport(reason_code) {
        return;
    }
    clear_desktop_control(control).await;
}

async fn clear_desktop_control_on_host_failure(
    control: &Arc<dyn NimiDesktopControl>,
    error: &NimiHostError,
) {
    if !invalidates_desktop_transport(error.reason_code().as_str()) {
        return;
    }
    clear_desktop_control(control).await;
}

fn invalidates_desktop_transport(reason_code: &str) -> bool {
    matches!(
        reason_code,
        "runtime-service-unavailable"
            | "runtime-service-error-unclassified"
            | "runtime-service-untrusted"
            | "runtime-service-repair-required"
            | "runtime-restarted"
            | "process-replaced"
            | "PROTECTED_ORIGIN_ROLE_MISMATCH"
    )
}

async fn clear_desktop_control(control: &Arc<dyn NimiDesktopControl>) {
    let removed = {
        let mut current = DESKTOP_CONTROL.lock().await;
        if current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, control))
        {
            *current = None;
            true
        } else {
            false
        }
    };
    // A delayed failure from a stale pre-restart control must not invalidate a
    // newer verified session already installed by another caller.
    if removed {
        // Remove only this control's lower carrier session. A validation retry
        // may already have installed a replacement while stale stream cleanup
        // was settling, so a process-global cache clear is not safe here.
        control.invalidate_cached_transport().await;
        cancel_active_and_clear_completed_first_party_unaries().await;
        account_events::close_account_event_streams_for_control(control).await;
        bundled_avatar_streams::close_bundled_avatar_streams_for_control(control).await;
        first_party_streams::close_first_party_product_streams_for_control(control).await;
    }
}

#[cfg(test)]
mod desktop_transport_invalidation_tests {
    use super::invalidates_desktop_transport;

    #[test]
    fn invalidates_only_transport_or_verified_origin_failures() {
        for reason in [
            "runtime-service-unavailable",
            "runtime-service-error-unclassified",
            "runtime-service-untrusted",
            "runtime-service-repair-required",
            "runtime-restarted",
            "process-replaced",
            "PROTECTED_ORIGIN_ROLE_MISMATCH",
        ] {
            assert!(invalidates_desktop_transport(reason), "{reason}");
        }
    }

    #[test]
    fn account_and_local_development_results_never_poison_the_verified_channel() {
        for reason in [
            "principal-unauthorized",
            "account-changed",
            "local-development-project-changed",
            "local-development-supervisor-required",
            "local-development-session-revoked",
            "local-app-developer-mode-disabled",
            "local-app-presence-required",
            "local-app-presence-expired",
            "local-app-operation-unavailable",
            "PRINCIPAL_UNAUTHORIZED",
            "AUTH_TOKEN_INVALID",
            "BROKER_FORBIDDEN",
            "REALM_UNAVAILABLE",
        ] {
            assert!(!invalidates_desktop_transport(reason), "{reason}");
        }
    }
}

#[cfg(all(
    test,
    any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    )
))]
mod desktop_control_cache_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test(flavor = "current_thread")]
    async fn concurrent_cache_misses_open_once_and_share_control() {
        let slot = Arc::new(Mutex::new(None::<Arc<()>>));
        let opens = Arc::new(AtomicUsize::new(0));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());

        let first = tokio::spawn({
            let slot = slot.clone();
            let opens = opens.clone();
            let started = started.clone();
            let release = release.clone();
            async move {
                get_or_open_cached_desktop_control(&slot, Duration::from_secs(1), || async {
                    opens.fetch_add(1, Ordering::SeqCst);
                    started.notify_one();
                    release.notified().await;
                    Ok(Arc::new(()))
                })
                .await
            }
        });
        started.notified().await;
        let second = tokio::spawn({
            let slot = slot.clone();
            let opens = opens.clone();
            async move {
                get_or_open_cached_desktop_control(&slot, Duration::from_secs(1), || async {
                    opens.fetch_add(1, Ordering::SeqCst);
                    Ok(Arc::new(()))
                })
                .await
            }
        });
        release.notify_one();

        let first = first.await.expect("first task").expect("first control");
        let second = second.await.expect("second task").expect("second control");
        assert_eq!(opens.load(Ordering::SeqCst), 1);
        assert!(Arc::ptr_eq(&first, &second));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn pending_open_times_out_without_poisoning_cache() {
        let slot = Mutex::new(None::<Arc<()>>);
        let error = tokio::time::timeout(
            Duration::from_secs(1),
            get_or_open_cached_desktop_control(&slot, Duration::ZERO, || {
                std::future::pending::<Result<Arc<()>, NimiHostError>>()
            }),
        )
        .await
        .expect("open timeout must settle")
        .expect_err("pending open must fail");
        assert_eq!(
            error.reason_code(),
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        );
        assert!(error.retryable());
        assert!(slot.lock().await.is_none());

        let recovered =
            get_or_open_cached_desktop_control(&slot, Duration::from_secs(1), || async {
                Ok(Arc::new(()))
            })
            .await
            .expect("cache must recover after a timed-out open");
        let cached = slot.lock().await;
        assert!(cached
            .as_ref()
            .is_some_and(|control| Arc::ptr_eq(control, &recovered)));
    }
}
