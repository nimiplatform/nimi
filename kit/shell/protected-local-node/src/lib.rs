#![deny(unsafe_code)]

use napi_derive::napi;
#[cfg(not(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
)))]
use nimi_shell_protected_local::FixedRuntimeServiceControl;
use nimi_shell_protected_local::NimiHostErrorReasonCode;
use nimi_shell_protected_local::{
    BundledAvatarRuntimeRequest, DesktopAccountActionRequest, DesktopAccountBeginLoginRequest,
    DesktopAccountBeginLoginResponse, DesktopAccountCompleteLoginRequest,
    DesktopAccountMutationResponse, DesktopAccountProductUnaryMethod,
    DesktopAccountProductUnaryRequest, DesktopAccountProjection, DesktopAccountRealmUnaryRequest,
    DesktopAccountRealmUnaryResponse, DesktopAccountSessionEvent,
    DesktopAccountSessionStatusRequest, DesktopMachineProductUnaryMethod,
    DesktopMachineProductUnaryRequest, LocalAppAIConfigLocalOptionsRequest,
    LocalAppAIConfigOverwriteRequest, LocalAppActivityListRequest, LocalAppActivityMarkReadRequest,
    LocalAppActivityOpenRequest, LocalAppActivityOpenRequestCompleteRequest,
    LocalAppActivityPutRequest, LocalAppActivitySubscribeRequest, LocalAppActivityTimestamp,
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentManagerSnapshotRequest, LocalAppAgentMemoryCorrectRequest,
    LocalAppAgentMemoryDeleteRequest, LocalAppAgentMemoryForgetRequest,
    LocalAppAgentMemoryInspectRequest, LocalAppAgentMemorySwitchRequest,
    LocalAppAgentPresentationAssetInput, LocalAppAgentPresentationAssetReadRequest,
    LocalAppAgentRealtimeAppendInputRequest, LocalAppAgentRealtimeOpenRequest,
    LocalAppAgentRealtimeOutputInterruptRequest, LocalAppAgentRealtimeSessionRequest,
    LocalAppAgentReference, LocalAppAgentUpdateAutonomyRequest,
    LocalAppAgentUpdateConversationContextRequest, LocalAppAiRealtimeAppendInputRequest,
    LocalAppAiRealtimeOpenRequest, LocalAppAiRealtimeOutputInterruptRequest,
    LocalAppAiRealtimeOwnerControlRequest, LocalAppAiRealtimeSessionRequest,
    LocalAppAssetAdoptRequest, LocalAppAssetListRequest, LocalAppAssetMoveRequest,
    LocalAppAssetReadReceiver, LocalAppAssetReadRequest, LocalAppAssetRecord,
    LocalAppAssetRemoveRequest, LocalAppAssetRevealRequest, LocalAppAssetStatRequest,
    LocalAppAssetWriteRequest, LocalAppAvatarHostTargetResolveRequest,
    LocalAppConversationArtifactReadRequest, LocalAppConversationAttachmentUploadRequest,
    LocalAppConversationEvent, LocalAppConversationEventKind, LocalAppConversationInputPart,
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
    LocalAppTextCandidateMessage, LocalAppTextCandidateRequest, LocalAppTextMessage,
    LocalAppTextTurnRequest, LocalAppWorldCharacterCreateRequest, LocalAppWorldCharacterGetRequest,
    LocalAppWorldCharacterListRequest, LocalAppWorldCharacterReplaceRequest,
    LocalAppWorldCoreCreateRequest, LocalAppWorldCoreGetRequest, LocalAppWorldCoreListRequest,
    LocalAppWorldCoreReplaceRequest, LocalAppWorldEntityCreateRequest,
    LocalAppWorldEntityGetRequest, LocalAppWorldEntityListRequest,
    LocalAppWorldRelationshipGetRequest, LocalAppWorldRelationshipListRequest,
    LocalDevelopmentEndRunRequest, LocalDevelopmentLaunchRequest, LocalDevelopmentRegistration,
    LocalDevelopmentRegistrationRequest, LocalDevelopmentShellKind, NimiDesktopControl,
    NimiHostError, NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError,
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

struct LocalAppSessionCache {
    session: Option<Arc<CachedLocalAppSession>>,
    invalidated: Option<LocalAppOperationError>,
}
struct CachedLocalAppSession(Arc<dyn NimiLocalAppSession>);
impl std::ops::Deref for CachedLocalAppSession {
    type Target = dyn NimiLocalAppSession;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}
static LOCAL_APP_SESSION: Mutex<LocalAppSessionCache> = Mutex::const_new(LocalAppSessionCache {
    session: None,
    invalidated: None,
});
static DESKTOP_CONTROL: LazyLock<Arc<Mutex<Option<Arc<dyn NimiDesktopControl>>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));
const FIRST_PARTY_UNARY_MAX_DURATION: Duration = Duration::from_secs(300);
const DESKTOP_CONTROL_CACHE_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
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
                clear_desktop_control_on_transport_reason(
                    &control,
                    error.reason_code(),
                    error.reason_metadata(),
                )
                .await;
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
                clear_desktop_control_on_transport_reason(
                    &control,
                    error.reason_code(),
                    error.reason_metadata(),
                )
                .await;
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

    #[cfg(any(
        feature = "macos-source-local-development",
        feature = "windows-source-local-development"
    ))]
    #[tokio::test]
    async fn renderer_cancel_cannot_interrupt_retirement_or_open_a_replacement_early() {
        let _guard = CANCELLATION_TEST_LOCK.lock().await;
        let dropped = Arc::new(AtomicBool::new(false));
        let control = Arc::new(DropMarker(Arc::clone(&dropped)));
        let old_control = Arc::downgrade(&control);
        let slot = Arc::new(Mutex::new(Some(Arc::clone(&control))));
        let started = Arc::new(Notify::new());
        let release_retirement = Arc::new(Notify::new());
        let request_id = "desktop-retirement-renderer-cancel";
        let task = tokio::spawn(run_first_party_unary(request_id.to_owned(), {
            let slot = Arc::clone(&slot);
            let started = Arc::clone(&started);
            let release_retirement = Arc::clone(&release_retirement);
            async move {
                retire_cached_desktop_control(slot, control, |control| async move {
                    // The owner task must preserve the triggering unary's
                    // exclusion from bulk peer cancellation.
                    cancel_active_and_clear_completed_first_party_unaries().await;
                    started.notify_one();
                    release_retirement.notified().await;
                    drop(control);
                })
                .await;
                NativeBytesOutcome::error("runtime-service-unavailable", true)
            }
        }));
        started.notified().await;
        assert!(!task.is_finished());
        assert!(!dropped.load(Ordering::SeqCst));

        desktop_first_party_product_unary_cancel(NativeFirstPartyProductUnaryCancelInput {
            request_id: request_id.to_owned(),
        })
        .await;
        let canceled = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("renderer cancellation must complete the caller")
            .expect("unary caller task must join");
        assert_eq!(
            canceled.reason_code.as_deref(),
            Some("runtime-request-canceled")
        );
        assert!(
            old_control.upgrade().is_some(),
            "the owner retains the retiring control"
        );

        let opened = Arc::new(AtomicBool::new(false));
        let attempt = get_or_open_cached_desktop_control(
            &slot,
            Duration::from_millis(10),
            || async {
                opened.store(true, Ordering::SeqCst);
                Ok(Arc::new(DropMarker(Arc::new(AtomicBool::new(false)))))
            },
        )
        .await;
        assert!(matches!(attempt, Err(ref error) if error.reason_code() == NimiHostErrorReasonCode::RuntimeServiceUnavailable));
        assert!(
            !opened.load(Ordering::SeqCst),
            "a new open cannot bypass retirement"
        );
        assert!(
            !dropped.load(Ordering::SeqCst),
            "a waiting caller timeout cannot abort retirement"
        );

        release_retirement.notify_one();
        let replacement = get_or_open_cached_desktop_control(
            &slot,
            Duration::from_secs(1),
            || async {
                opened.store(true, Ordering::SeqCst);
                Ok(Arc::new(DropMarker(Arc::new(AtomicBool::new(false)))))
            },
        )
        .await
        .expect("a replacement may open after owner retirement finishes");
        assert!(opened.load(Ordering::SeqCst));
        assert!(dropped.load(Ordering::SeqCst));
        assert!(old_control.upgrade().is_none());
        assert!(slot
            .lock()
            .await
            .as_ref()
            .is_some_and(|cached| Arc::ptr_eq(cached, &replacement)));
        desktop_first_party_product_unary_release(NativeFirstPartyProductUnaryCancelInput {
            request_id: request_id.to_owned(),
        })
        .await;
    }

    #[tokio::test]
    async fn delayed_failure_cannot_retire_a_replacement_control() {
        let old = Arc::new(());
        let replacement = Arc::new(());
        let slot = Arc::new(Mutex::new(Some(Arc::clone(&replacement))));
        retire_cached_desktop_control(Arc::clone(&slot), old, |_| async {
            panic!("a delayed failure must not run retirement for the replacement");
        })
        .await;
        assert!(slot
            .lock()
            .await
            .as_ref()
            .is_some_and(|cached| Arc::ptr_eq(cached, &replacement)));
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
                clear_desktop_control_on_transport_reason(
                    &control,
                    error.reason_code(),
                    error.reason_metadata(),
                )
                .await;
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
            "auditDiagnostic": status.audit_diagnostic.map(project_account_audit),
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

// @nimi-authority: rule.nimi.runtime.protected-session.r034
#[napi(js_name = "fixedRuntimeServiceStatus")]
pub async fn fixed_runtime_service_status() -> NativeJsonOutcome {
    match current_or_open_desktop_control().await {
        Ok(control) => NativeJsonOutcome::success(project_verified_runtime_release(
            control.runtime_service_mode(),
            control.runtime_release_version(),
        )),
        Err(error) => NativeJsonOutcome::host_error(error),
    }
}

#[napi(js_name = "windowsProductUpdateHost")]
pub fn windows_product_update_host() -> NativeJsonOutcome {
    #[cfg(all(
        target_os = "windows",
        not(feature = "windows-source-local-development")
    ))]
    match nimi_shell_protected_local::windows_product_update_host() {
        Ok((helper, public_key)) => {
            return NativeJsonOutcome::success(
                serde_json::json!({ "helperPath": helper, "publicKey": public_key }),
            )
        }
        Err(error) => return NativeJsonOutcome::protected_error(error),
    }
    #[cfg(not(all(
        target_os = "windows",
        not(feature = "windows-source-local-development")
    )))]
    NativeJsonOutcome::host_reason("runtime-service-untrusted", false)
}

#[cfg(target_os = "macos")]
#[napi(js_name = "macosRuntimeServiceRegistration")]
pub async fn macos_runtime_service_registration(operation: String) -> NativeJsonOutcome {
    match tokio::task::spawn_blocking(move || {
        nimi_shell_protected_local::macos_runtime_service_registration(&operation)
    })
    .await
    {
        Ok(Ok(status)) => {
            NativeJsonOutcome::success(serde_json::json!({ "registrationStatus": status }))
        }
        Ok(Err(error)) => NativeJsonOutcome::protected_error(error),
        Err(_) => NativeJsonOutcome::host_reason("runtime-service-unavailable", true),
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
    if let Ok(control) = current_or_open_desktop_control().await {
        return NativeJsonOutcome::success(project_verified_runtime_release(
            control.runtime_service_mode(),
            control.runtime_release_version(),
        ));
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

#[napi(js_name = "desktopLaunchInstalledApp")]
pub fn desktop_launch_installed_app<'env>(
    env: &'env napi::Env,
    input: NativeInstalledAppLaunchInput,
) -> napi::Result<napi::bindgen_prelude::PromiseRaw<'env, NativeJsonOutcome>> {
    // Register synchronously before returning the Promise so an immediate stop
    // cannot overtake the async task's first poll.
    let selector = input.launch_selector.clone();
    let pending = installed_launch_cancellation::begin(&selector);
    env.spawn_future(async move {
        let Some(mut pending) = pending else {
            return Ok(NativeJsonOutcome::host_reason("installed-app-launch-failed", false));
        };
        let outcome = tokio::select! {
            biased;
            _ = pending.canceled() => NativeJsonOutcome::host_reason("installed-app-launch-canceled", false),
            result = invoke_desktop_json(|control| async move {
                control.launch_installed_app(input.launch_selector.into_bytes()).await.map(|result| json!({
                    "launchId": encode_identifier(&result.launch_id), "processId": result.process_id,
                    "appId": result.app_id, "version": result.version,
                }))
            }) => result,
        };
        Ok(outcome)
    })
}

#[napi(js_name = "desktopCancelInstalledAppLaunch")]
pub fn desktop_cancel_installed_app_launch(
    input: NativeInstalledAppLaunchInput,
) -> NativeJsonOutcome {
    installed_launch_cancellation::cancel(&input.launch_selector);
    NativeJsonOutcome::success(json!({"canceled": true}))
}

mod installed_launch_cancellation;

#[napi(js_name = "desktopInstalledAppStatus")]
pub fn desktop_installed_app_status(input: NativeInstalledAppRunInput) -> NativeJsonOutcome {
    let Some(id) = decode_identifier(&input.launch_id) else {
        return NativeJsonOutcome::host_reason("installed-app-launch-failed", false);
    };
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return match nimi_shell_protected_local::installed_app_process_status(id) {
        Ok((running, exit_code)) => {
            NativeJsonOutcome::success(json!({"running": running, "exitCode": exit_code}))
        }
        Err(error) => NativeJsonOutcome::host_error(error),
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = id;
        NativeJsonOutcome::host_reason("local-app-operation-unavailable", false)
    }
}

#[napi(js_name = "desktopFocusInstalledApp")]
pub fn desktop_focus_installed_app(input: NativeInstalledAppRunInput) -> NativeJsonOutcome {
    let Some(id) = decode_identifier(&input.launch_id) else {
        return NativeJsonOutcome::host_reason("installed-app-launch-failed", false);
    };
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return match nimi_shell_protected_local::focus_installed_app_process(id) {
        Ok(()) => NativeJsonOutcome::success(json!({"focused": true})),
        Err(error) => NativeJsonOutcome::host_error(error),
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = id;
        NativeJsonOutcome::host_reason("local-app-operation-unavailable", false)
    }
}

#[napi(js_name = "desktopStopInstalledApp")]
pub fn desktop_stop_installed_app(input: NativeInstalledAppRunInput) -> NativeJsonOutcome {
    let Some(id) = decode_identifier(&input.launch_id) else {
        return NativeJsonOutcome::host_reason("installed-app-launch-failed", false);
    };
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    return match nimi_shell_protected_local::stop_installed_app_process(id) {
        Ok(()) => NativeJsonOutcome::success(json!({"stopped": true})),
        Err(error) => NativeJsonOutcome::host_error(error),
    };
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = id;
        NativeJsonOutcome::host_reason("local-app-operation-unavailable", false)
    }
}

#[napi(js_name = "desktopCompleteAppUninstall")]
pub async fn desktop_complete_app_uninstall(
    input: NativeInstalledAppUninstallInput,
) -> NativeJsonOutcome {
    invoke_desktop_json(|control| async move {
        control
            .complete_app_uninstall(
                input.job_id.into_bytes(),
                input.launch_selector.into_bytes(),
            )
            .await
            .map(|()| json!({"completed": true}))
    })
    .await
}

#[napi(js_name = "desktopEndInstalledAppRun")]
pub async fn desktop_end_installed_app_run(input: NativeInstalledAppRunInput) -> NativeJsonOutcome {
    let Some(id) = decode_identifier(&input.launch_id) else {
        return NativeJsonOutcome::host_reason("installed-app-launch-failed", false);
    };
    invoke_desktop_json(|control| async move {
        control
            .end_installed_app_run(id)
            .await
            .map(|()| json!({"ended": true}))
    })
    .await
}

#[napi(js_name = "desktopInstalledAppRunAccess")]
pub async fn desktop_installed_app_run_access(
    input: NativeInstalledAppRunInput,
) -> NativeJsonOutcome {
    let Some(id) = decode_identifier(&input.launch_id) else {
        return NativeJsonOutcome::host_reason("installed-app-launch-failed", false);
    };
    invoke_desktop_json(|control| async move {
        control.installed_app_run_access(id).await.map(|result| {
            json!({
                "available": result.available, "reasonCode": result.reason_code, "executionScopeRef": result.execution_scope_ref,
            })
        })
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
                    "hostProfileRoot": outcome.host_profile_root.to_string_lossy(),
                })
            })
    })
    .await
}

#[napi(js_name = "desktopLocalDevelopmentRunAccess")]
pub async fn desktop_local_development_run_access(input: JsonValue) -> NativeJsonOutcome {
    let Some(record) = input.as_object() else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    if record.len() != 2 {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    }
    let registration_handle = record
        .get("registrationHandle")
        .and_then(JsonValue::as_str)
        .and_then(decode_identifier);
    let supervisor_run_id = record
        .get("supervisorRunId")
        .and_then(JsonValue::as_str)
        .and_then(decode_identifier);
    let (Some(registration_handle), Some(supervisor_run_id)) =
        (registration_handle, supervisor_run_id)
    else {
        return NativeJsonOutcome::host_reason("runtime-service-untrusted", false);
    };
    invoke_desktop_json(|control| async move {
        control.local_development_run_access(nimi_shell_protected_local::LocalDevelopmentRunAccessRequest { registration_handle, supervisor_run_id }).await.map(|value| json!({
            "available": value.available, "reasonCode": value.reason_code, "executionScopeRef": value.execution_scope_ref,
        }))
    }).await
}

#[napi(js_name = "desktopLocalDevelopmentHostStatus")]
pub async fn desktop_local_development_host_status(
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
    match control.local_development_host_status(supervisor_run_id) {
        Ok((running, exit_code)) => {
            NativeJsonOutcome::success(json!({ "running": running, "exitCode": exit_code }))
        }
        Err(error) => {
            clear_desktop_control_on_host_failure(&control, &error).await;
            NativeJsonOutcome::host_error(error)
        }
    }
}

#[napi(js_name = "desktopFocusLocalDevelopmentHost")]
pub async fn desktop_focus_local_development_host(
    input: NativeLocalDevelopmentRunInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    invoke_desktop_json(|control| async move {
        control
            .focus_local_development_host(supervisor_run_id)
            .map(|()| json!({ "focused": true }))
    })
    .await
}

#[napi(js_name = "desktopTerminateLocalDevelopmentHost")]
pub async fn desktop_terminate_local_development_host(
    input: NativeLocalDevelopmentRunInput,
) -> NativeJsonOutcome {
    let supervisor_run_id = match decode_identifier(&input.supervisor_run_id) {
        Some(value) => value,
        None => return NativeJsonOutcome::host_reason("runtime-service-untrusted", false),
    };
    #[cfg(any(
        all(target_os = "macos", feature = "macos-source-local-development"),
        all(target_os = "windows", feature = "windows-source-local-development")
    ))]
    {
        return match nimi_shell_protected_local::terminate_source_local_development_host(
            supervisor_run_id,
        ) {
            Ok(()) => NativeJsonOutcome::success(json!({ "terminated": true })),
            Err(error) => NativeJsonOutcome::host_error(error),
        };
    }
    #[cfg(not(any(
        all(target_os = "macos", feature = "macos-source-local-development"),
        all(target_os = "windows", feature = "windows-source-local-development")
    )))]
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeJsonOutcome::host_error(error),
    };
    #[cfg(not(any(
        all(target_os = "macos", feature = "macos-source-local-development"),
        all(target_os = "windows", feature = "windows-source-local-development")
    )))]
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
    // Compiler-generated closure identity is static code information, never
    // a captured request value or a caller-supplied operation label.
    let operation_name = std::any::type_name::<F>();
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => {
            diagnose_desktop_host_failure(operation_name, "acquire-control", &error);
            return NativeJsonOutcome::host_error(error);
        }
    };
    match operation(control.clone()).await {
        Ok(value) => NativeJsonOutcome::success(value),
        Err(error) => {
            diagnose_desktop_host_failure(operation_name, "operation", &error);
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
            let current =
                tokio::time::timeout(DESKTOP_CONTROL_CACHE_WAIT_TIMEOUT, DESKTOP_CONTROL.lock())
                    .await
                    .map_err(|_| {
                        let error = desktop_control_unavailable();
                        diagnose_desktop_host_failure(
                            "current_or_open_desktop_control",
                            "cache-lock-deadline",
                            &error,
                        );
                        error
                    })?;
            current.as_ref().cloned()
        };
        if let Some(control) = cached {
            match control.verify_runtime_serving().await {
                Ok(()) => return Ok(control),
                Err(error) => {
                    diagnose_desktop_host_failure(
                        "current_or_open_desktop_control",
                        "readiness",
                        &error,
                    );
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
    let mut current =
        tokio::time::timeout(DESKTOP_CONTROL_CACHE_WAIT_TIMEOUT, DESKTOP_CONTROL.lock())
            .await
            .map_err(|_| {
                let error = desktop_control_unavailable();
                diagnose_desktop_host_failure(
                    "current_or_open_desktop_control",
                    "cache-lock-deadline",
                    &error,
                );
                error
            })?;
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
    // Retirement holds this same slot until its streams and transport are
    // released. Bound the wait as well as opening; timing out a caller must
    // not cancel the owner retirement or permit an overlapping connection.
    tokio::time::timeout(open_timeout, async {
        let mut current = slot.lock().await;
        if let Some(control) = current.as_ref() {
            return Ok(control.clone());
        }
        let control = open().await?;
        *current = Some(control.clone());
        Ok(control)
    })
    .await
    .map_err(|_| {
        let error = desktop_control_unavailable();
        diagnose_desktop_host_failure(
            "get_or_open_cached_desktop_control",
            "cache-open-deadline",
            &error,
        );
        error
    })?
}

fn desktop_control_unavailable() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true)
}

async fn clear_desktop_control_on_transport_reason(
    control: &Arc<dyn NimiDesktopControl>,
    reason_code: &str,
    reason_metadata: &std::collections::BTreeMap<String, String>,
) {
    retire_desktop_control_on_transport_failure(
        "product-call",
        reason_code,
        reason_metadata,
        || clear_desktop_control(control),
    )
    .await;
}

#[track_caller]
fn clear_desktop_control_on_host_failure<'a>(
    control: &'a Arc<dyn NimiDesktopControl>,
    error: &'a NimiHostError,
) -> impl Future<Output = ()> + 'a {
    // Capture the synchronous callsite before creating the future: an async
    // track_caller function would report the poller rather than its caller.
    let caller = std::panic::Location::caller();
    async move {
        if invalidates_desktop_transport(error.reason_code().as_str())
            && desktop_diagnostics_enabled()
        {
            eprintln!(
                "[protected-local desktop-control] host-invalidation-site file={} line={}",
                caller.file(),
                caller.line()
            );
        }
        retire_desktop_control_on_transport_failure(
            "host-call",
            error.reason_code().as_str(),
            error.reason_metadata(),
            || clear_desktop_control(control),
        )
        .await;
    }
}

// Both native result families use the same gate before touching the cache or
// its streams. Keep ordinary request cancellation out of owner retirement.
// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
async fn retire_desktop_control_on_transport_failure<F, Fut>(
    family: &'static str,
    reason_code: &str,
    reason_metadata: &std::collections::BTreeMap<String, String>,
    retire: F,
) where
    F: FnOnce() -> Fut,
    Fut: Future<Output = ()>,
{
    if invalidates_desktop_transport(reason_code) {
        diagnose_desktop_transport_invalidation(family, reason_code, reason_metadata);
        retire().await;
    }
}

fn diagnose_desktop_transport_invalidation(
    family: &'static str,
    reason_code: &str,
    reason_metadata: &std::collections::BTreeMap<String, String>,
) {
    if !desktop_diagnostics_enabled() {
        return;
    }
    // Callers pass only an admitted transport reason. Project the numeric
    // status, never the status message or other Runtime error metadata.
    let status = diagnostic_grpc_status(reason_metadata);
    eprintln!("[protected-local desktop-control] invalidate family={family} reason={reason_code} grpc_status_code={status}");
}

fn desktop_diagnostics_enabled() -> bool {
    std::env::var_os("NIMI_PROTECTED_LOCAL_DIAGNOSTICS").as_deref()
        == Some(std::ffi::OsStr::new("1"))
}

fn diagnostic_grpc_status(reason_metadata: &std::collections::BTreeMap<String, String>) -> String {
    reason_metadata
        .get("grpc_status_code")
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value <= 16)
        .map_or_else(|| "none".to_string(), |value| value.to_string())
}

fn desktop_host_failure_diagnostic(
    operation: &'static str,
    phase: &'static str,
    error: &NimiHostError,
) -> String {
    format!(
        "[protected-local desktop-control] host-failure operation={operation} phase={phase} reason={} retryable={} grpc_status_code={}",
        error.reason_code().as_str(), error.retryable(), diagnostic_grpc_status(error.reason_metadata()),
    )
}

fn diagnose_desktop_host_failure(
    operation: &'static str,
    phase: &'static str,
    error: &NimiHostError,
) {
    if desktop_diagnostics_enabled() {
        eprintln!(
            "{}",
            desktop_host_failure_diagnostic(operation, phase, error)
        );
    }
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
    retire_cached_desktop_control(
        Arc::clone(&DESKTOP_CONTROL),
        Arc::clone(control),
        |control| async move {
            control.invalidate_cached_transport().await;
            cancel_active_and_clear_completed_first_party_unaries().await;
            account_events::close_account_event_streams_for_control(&control).await;
            bundled_avatar_streams::close_bundled_avatar_streams_for_control(&control).await;
            first_party_streams::close_first_party_product_streams_for_control(&control).await;
        },
    )
    .await;
}

async fn retire_cached_desktop_control<T, F, Fut>(
    slot: Arc<Mutex<Option<Arc<T>>>>,
    control: Arc<T>,
    retire: F,
) where
    T: ?Sized + Send + Sync + 'static,
    F: FnOnce(Arc<T>) -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let triggering_unary = CURRENT_FIRST_PARTY_UNARY_CANCELLATION
        .try_with(Arc::clone)
        .ok();
    // A renderer cancellation may drop this caller while the cache is already
    // empty. The short-lived owner task must finish draining the old streams;
    // its strong control reference also keeps their Weak ownership matchable.
    let retirement = tokio::spawn(async move {
        let work = async move {
            let mut current = slot.lock().await;
            if !current
                .as_ref()
                .is_some_and(|candidate| Arc::ptr_eq(candidate, &control))
            {
                return; // A stale failure cannot retire a replacement.
            }
            *current = None;
            retire(control).await;
            // Keep the slot locked through retirement. A new open cannot
            // overtake cleanup and inherit or compete with the old transport.
        };
        if let Some(triggering_unary) = triggering_unary {
            CURRENT_FIRST_PARTY_UNARY_CANCELLATION
                .scope(triggering_unary, work)
                .await;
        } else {
            work.await;
        }
    });
    // Dropping a JoinHandle detaches the owner task; it does not abort it.
    let _ = retirement.await;
}

#[cfg(test)]
mod desktop_transport_invalidation_tests {
    use super::{
        desktop_host_failure_diagnostic, invalidates_desktop_transport,
        retire_cached_desktop_control, retire_desktop_control_on_transport_failure,
    };
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use tokio::sync::Mutex;

    #[test]
    fn host_diagnostic_contains_only_static_site_and_bounded_numeric_status() {
        use nimi_shell_protected_local::{NimiHostError, NimiHostErrorReasonCode};
        use std::collections::BTreeMap;

        for (raw_code, expected) in [
            ("14", "14"),
            ("1", "1"),
            ("17", "none"),
            ("-1", "none"),
            ("13\nprivate-status-body", "none"),
        ] {
            let error =
                NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true)
                    .with_reason_metadata(BTreeMap::from([
                        ("grpc_status_code".to_string(), raw_code.to_string()),
                        (
                            "diagnostic_stage".to_string(),
                            "private-request-value".to_string(),
                        ),
                        ("detail".to_string(), "private-status-body".to_string()),
                    ]));
            let line =
                desktop_host_failure_diagnostic("static_host_operation", "readiness", &error);
            assert!(line.contains("operation=static_host_operation phase=readiness"));
            assert!(line.ends_with(&format!("grpc_status_code={expected}")));
            assert!(!line.contains("private-"));
            assert!(!line.contains("diagnostic_stage"));
            assert!(!line.contains('\n'));
        }
    }

    #[tokio::test]
    async fn request_cancel_keeps_cached_owner_while_unavailable_retires_it() {
        for family in ["product-call", "host-call"] {
            let control = Arc::new(());
            let slot = Arc::new(Mutex::new(Some(Arc::clone(&control))));
            let retired = Arc::new(AtomicBool::new(false));
            for reason in ["runtime-request-canceled", "runtime-service-unavailable"] {
                let retiring_slot = Arc::clone(&slot);
                let retiring_control = Arc::clone(&control);
                let retired_marker = Arc::clone(&retired);
                retire_desktop_control_on_transport_failure(
                    family,
                    reason,
                    &Default::default(),
                    move || async move {
                        retire_cached_desktop_control(
                            retiring_slot,
                            retiring_control,
                            move |_| async move {
                                retired_marker.store(true, Ordering::SeqCst);
                            },
                        )
                        .await;
                    },
                )
                .await;
                if reason == "runtime-request-canceled" {
                    assert!(
                        !retired.load(Ordering::SeqCst),
                        "cancellation must not touch owner streams/transport"
                    );
                    assert!(slot
                        .lock()
                        .await
                        .as_ref()
                        .is_some_and(|cached| Arc::ptr_eq(cached, &control)));
                }
            }
            assert!(retired.load(Ordering::SeqCst));
            assert!(
                slot.lock().await.is_none(),
                "a real transport failure still retires the exact cache entry"
            );
        }
    }

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
            "runtime-request-canceled",
            "account-changed",
            "local-development-project-changed",
            "local-development-supervisor-required",
            "local-development-session-revoked",
            "local-app-developer-mode-disabled",
            "local-app-presence-required",
            "local-app-presence-expired",
            "local-app-operation-unavailable",
            "process-focus-failed",
            "LOCAL_APP_OPERATION_UNAVAILABLE",
            "LOCAL_APP_OWNER_UNAVAILABLE",
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

    #[cfg(any(
        all(target_os = "macos", feature = "macos-source-local-development"),
        all(target_os = "windows", feature = "windows-source-local-development")
    ))]
    #[tokio::test(flavor = "current_thread")]
    async fn terminate_owned_host_does_not_open_runtime_control() {
        // Hold the transport cache lock: local cleanup must not even consult
        // this cache, whether Runtime is absent, reconnecting, or unavailable.
        let _cache = DESKTOP_CONTROL.lock().await;
        for _ in 0..2 {
            let outcome = tokio::time::timeout(
                Duration::from_millis(100),
                desktop_terminate_local_development_host(NativeLocalDevelopmentRunInput {
                    supervisor_run_id: encode_identifier(&[73; 32]),
                }),
            )
            .await
            .expect("local termination must not wait for Runtime control");
            assert_eq!(outcome.status, "ok");
            assert_eq!(outcome.value, Some(json!({ "terminated": true })));
        }
        let invalid = desktop_terminate_local_development_host(NativeLocalDevelopmentRunInput {
            supervisor_run_id: encode_identifier(&[0; 32]),
        })
        .await;
        assert_eq!(invalid.status, "error");
        assert_eq!(
            invalid.reason_code.as_deref(),
            Some("runtime-service-untrusted")
        );
    }

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
