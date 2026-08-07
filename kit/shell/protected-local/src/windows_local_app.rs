mod app_ai_config;
mod conversation;
mod realm_world_core;
mod reference;
mod storage;
mod text_candidate;

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tokio::sync::RwLock;
use tonic::transport::Channel;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::{OpenLocalAppSessionRequest, RenewLocalAppSessionRequest};
use crate::grpc_status::local_app_error_from_status;
#[cfg(target_os = "macos")]
use crate::macos_service_control::open_verified_local_app_runtime_channel;
#[cfg(target_os = "windows")]
use crate::windows_peer_trust::VerifiedRuntimePeer;
#[cfg(all(target_os = "windows", not(feature = "windows-source-local-development")))]
use crate::windows_service_control::open_verified_runtime_channel;
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
use crate::windows_service_control::{
    open_verified_runtime_channel, SOURCE_LOCAL_APP_PIPE_REF,
};
use crate::{
    LocalAppAIConfigOverwriteRequest, LocalAppAgentReference, LocalAppConversationInterruptRequest,
    LocalAppConversationInterruptResult, LocalAppConversationOpenRequest,
    LocalAppConversationOpenResult, LocalAppConversationSendRequest,
    LocalAppConversationSendResult, LocalAppConversationSnapshot,
    LocalAppConversationSnapshotRequest, LocalAppConversationSubscribeRequest,
    LocalAppConversationSubscriptionReceiver,
    LocalAppCurrentUserDisplay, LocalAppCurrentUserStatus, LocalAppOperationError,
    LocalAppReasonCode, LocalAppSessionState, LocalAppSessionStatus,
    LocalAppStorageDocument, LocalAppStorageReadRequest, LocalAppStorageRemoveRequest,
    LocalAppStorageRemoveResult, LocalAppStorageWriteRequest, LocalAppTextCandidateRequest,
    LocalAppTextCandidateResult, LocalAppWorldCoreCreateRequest, LocalAppWorldCoreListRequest,
    NimiLocalAppCarrier, NimiLocalAppSession,
};

#[cfg(all(target_os = "windows", not(feature = "windows-source-local-development")))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-local-app-v1";
#[cfg(all(target_os = "windows", feature = "windows-source-local-development"))]
const RUNTIME_LOCAL_APP_PIPE_NAME: &str = SOURCE_LOCAL_APP_PIPE_REF;

const ACTION_EXECUTED: i32 = 1;
const LOCAL_APP_SESSION_READY: i32 = 1;
const CURRENT_USER_DISPLAY_UNAVAILABLE: i32 = 710;

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsLocalAppCarrier;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsLocalAppCarrier;

#[cfg(target_os = "windows")]
type PlatformRuntimePeer = VerifiedRuntimePeer;

struct PlatformLocalAppSession {
    channel: Channel,
    #[cfg(target_os = "windows")]
    runtime_peer: PlatformRuntimePeer,
    operation_gate: RwLock<()>,
    session_bound: AtomicBool,
    account_required: AtomicBool,
    current_user: RwLock<LocalAppCurrentUserStatus>,
}

impl PlatformLocalAppSession {
    fn transport_channel(&self) -> Result<Channel, LocalAppOperationError> {
        #[cfg(target_os = "windows")]
        if !self.runtime_peer.running() {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::RuntimeServiceUnavailable,
                true,
            ));
        }
        Ok(self.channel.clone())
    }

    fn checked_channel(&self) -> Result<Channel, LocalAppOperationError> {
        if !self.session_bound.load(Ordering::Acquire)
            || self.account_required.load(Ordering::Acquire)
        {
            return Err(runtime_unauthenticated());
        }
        self.transport_channel()
    }

    async fn store_ready_status(&self, status: &LocalAppSessionStatus) {
        *self.current_user.write().await = status.current_user.clone();
        self.session_bound.store(true, Ordering::Release);
        self.account_required.store(false, Ordering::Release);
    }

    fn record_session_error(&self, error: &LocalAppOperationError) {
        if error.reason_code() == LocalAppReasonCode::RuntimeUnauthenticated {
            self.session_bound.store(false, Ordering::Release);
            self.account_required.store(true, Ordering::Release);
        }
    }

    async fn open_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let _opening = self.operation_gate.write().await;
        if self.session_bound.load(Ordering::Acquire) {
            return Ok(ready_session_status(self.current_user.read().await.clone()));
        }
        let response = RuntimeAuthServiceClient::new(self.transport_channel()?)
            .open_local_app_session(OpenLocalAppSessionRequest {})
            .await
            .map_err(local_app_error_from_status);
        let response = match response {
            Ok(response) => response.into_inner(),
            Err(error) => {
                self.record_session_error(&error);
                return Err(error);
            }
        };
        let status = validate_session_projection(response)?;
        self.store_ready_status(&status).await;
        Ok(status)
    }

    async fn renew_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let _renewal = self.operation_gate.write().await;
        let response = RuntimeAuthServiceClient::new(self.transport_channel()?)
            .renew_local_app_session(RenewLocalAppSessionRequest {})
            .await
            .map_err(local_app_error_from_status);
        let response = match response {
            Ok(response) => response.into_inner(),
            Err(error) => {
                self.record_session_error(&error);
                return Err(error);
            }
        };
        let status = validate_session_projection(response)?;
        self.store_ready_status(&status).await;
        Ok(status)
    }

    async fn refresh_session(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        if self.session_bound.load(Ordering::Acquire) {
            self.renew_session().await
        } else {
            self.open_session().await
        }
    }
}

impl NimiLocalAppSession for PlatformLocalAppSession {
    fn session_status(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(async move {
            if !self.session_bound.load(Ordering::Acquire)
                || self.account_required.load(Ordering::Acquire)
            {
                return self.refresh_session().await;
            }
            let _operation = self.operation_gate.read().await;
            self.checked_channel()?;
            let current_user = self.current_user.read().await.clone();
            Ok(ready_session_status(current_user))
        })
    }

    fn renew_technical_session(
        &self,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalAppSessionStatus, LocalAppOperationError>> + Send + '_>,
    > {
        Box::pin(self.refresh_session())
    }

    fn generate_text_candidate(
        &self,
        request: LocalAppTextCandidateRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppTextCandidateResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            text_candidate::generate(self.checked_channel()?, request).await
        })
    }

    fn app_ai_config_get(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_ai_config::get(self.checked_channel()?).await
        })
    }

    fn app_ai_config_overwrite(
        &self,
        request: LocalAppAIConfigOverwriteRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            app_ai_config::overwrite(self.checked_channel()?, request).await
        })
    }

    fn realm_world_core_list(
        &self,
        request: LocalAppWorldCoreListRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::list(self.checked_channel()?, request).await
        })
    }

    fn realm_world_core_create(
        &self,
        request: LocalAppWorldCoreCreateRequest,
    ) -> Pin<Box<dyn Future<Output = Result<serde_json::Value, LocalAppOperationError>> + Send + '_>>
    {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            realm_world_core::create(self.checked_channel()?, request).await
        })
    }

    fn storage_read_json(
        &self,
        request: LocalAppStorageReadRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageDocument, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::read_local_app_storage_json(self.checked_channel()?, request).await
        })
    }

    fn storage_write_json(
        &self,
        request: LocalAppStorageWriteRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageDocument, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::write_local_app_storage_json(self.checked_channel()?, request).await
        })
    }

    fn storage_remove_json(
        &self,
        request: LocalAppStorageRemoveRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppStorageRemoveResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            storage::remove_local_app_storage_json(self.checked_channel()?, request).await
        })
    }

    fn agent_reference_list(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalAppAgentReference>, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            reference::list(self.checked_channel()?).await
        })
    }

    fn conversation_open(
        &self,
        request: LocalAppConversationOpenRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationOpenResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::open_conversation(self.checked_channel()?, request).await
        })
    }

    fn conversation_send_turn(
        &self,
        request: LocalAppConversationSendRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationSendResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::send_turn(self.checked_channel()?, request).await
        })
    }

    fn conversation_interrupt_turn(
        &self,
        request: LocalAppConversationInterruptRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationInterruptResult, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::interrupt_turn(self.checked_channel()?, request).await
        })
    }

    fn conversation_subscribe(
        &self,
        request: LocalAppConversationSubscribeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        LocalAppConversationSubscriptionReceiver,
                        LocalAppOperationError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::subscribe(self.checked_channel()?, request).await
        })
    }

    fn conversation_snapshot(
        &self,
        request: LocalAppConversationSnapshotRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalAppConversationSnapshot, LocalAppOperationError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let _operation = self.operation_gate.read().await;
            conversation::conversation_snapshot(self.checked_channel()?, request).await
        })
    }

}

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "macos")]
impl NimiLocalAppCarrier for MacOsLocalAppCarrier {
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

#[cfg(target_os = "windows")]
async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let (channel, runtime_peer) = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let session = PlatformLocalAppSession {
        channel,
        runtime_peer,
        operation_gate: RwLock::new(()),
        session_bound: AtomicBool::new(false),
        account_required: AtomicBool::new(false),
        current_user: RwLock::new(unavailable_current_user()),
    };
    if let Err(error) = session.open_session().await {
        if !retain_channel_for_account_required(&error) {
            return Err(transient_open_session_failure(error));
        }
    }
    Ok(Box::new(session))
}

#[cfg(target_os = "macos")]
async fn open_local_app_session() -> Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let channel = open_local_app_runtime_channel()
        .await
        .map_err(local_app_error_from_protected)?;
    let session = PlatformLocalAppSession {
        channel,
        operation_gate: RwLock::new(()),
        session_bound: AtomicBool::new(false),
        account_required: AtomicBool::new(false),
        current_user: RwLock::new(unavailable_current_user()),
    };
    if let Err(error) = session.open_session().await {
        if !retain_channel_for_account_required(&error) {
            return Err(transient_open_session_failure(error));
        }
    }
    Ok(Box::new(session))
}

fn ready_session_status(current_user: LocalAppCurrentUserStatus) -> LocalAppSessionStatus {
    LocalAppSessionStatus {
        state: LocalAppSessionState::Ready,
        reason_code: LocalAppReasonCode::ActionExecuted,
        retryable: false,
        current_user,
    }
}

fn unavailable_current_user() -> LocalAppCurrentUserStatus {
    LocalAppCurrentUserStatus {
        value: None,
        reason_code: LocalAppReasonCode::CurrentUserDisplayUnavailable,
        retryable: true,
    }
}

fn retain_channel_for_account_required(error: &LocalAppOperationError) -> bool {
    error.reason_code() == LocalAppReasonCode::RuntimeUnauthenticated
}

// A failed session open on a freshly verified one-shot channel means the
// Runtime either closed its accept-side grant check or is still finishing its
// ready transition; both are transient because the supervisor renews the
// one-shot grant and the next open reconnects. Typed denials keep their exact
// fail-closed verdicts.
fn transient_open_session_failure(error: LocalAppOperationError) -> LocalAppOperationError {
    match error.reason_code() {
        LocalAppReasonCode::RuntimeServiceErrorUnclassified
        | LocalAppReasonCode::OperationUnavailable => {
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
        }
        _ => error,
    }
}

fn runtime_unauthenticated() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeUnauthenticated, false)
}

fn validate_session_projection(
    response: crate::generated::OpenLocalAppSessionResponse,
) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
    if response.state != LOCAL_APP_SESSION_READY || response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    let current_user = match (response.current_user, response.current_user_reason_code) {
        (Some(value), ACTION_EXECUTED) => {
            if !valid_current_user_text(&value.handle, 160)
                || !valid_current_user_text(&value.display_name, 256)
                || value
                    .avatar_url
                    .as_deref()
                    .is_some_and(|avatar| !valid_current_user_avatar(avatar))
            {
                return Err(untrusted());
            }
            LocalAppCurrentUserStatus {
                value: Some(LocalAppCurrentUserDisplay {
                    handle: value.handle,
                    display_name: value.display_name,
                    avatar_url: value.avatar_url,
                }),
                reason_code: LocalAppReasonCode::ActionExecuted,
                retryable: false,
            }
        }
        (None, CURRENT_USER_DISPLAY_UNAVAILABLE) => LocalAppCurrentUserStatus {
            value: None,
            reason_code: LocalAppReasonCode::CurrentUserDisplayUnavailable,
            retryable: true,
        },
        _ => return Err(untrusted()),
    };
    Ok(ready_session_status(current_user))
}

fn valid_current_user_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.len() <= maximum
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

fn valid_current_user_avatar(value: &str) -> bool {
    if value.is_empty() || value.len() > 2048 || value.trim() != value {
        return false;
    }
    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return false;
    }
    match parsed.scheme() {
        "https" => parsed.port().is_none_or(|port| port == 443),
        "http" => parsed.host_str() == Some("127.0.0.1") && parsed.port() == Some(3002),
        _ => false,
    }
}

#[cfg(target_os = "windows")]
async fn open_local_app_runtime_channel(
) -> Result<(Channel, VerifiedRuntimePeer), crate::ProtectedCarrierError> {
    with_one_unavailable_retry(
        || open_verified_runtime_channel(RUNTIME_LOCAL_APP_PIPE_NAME),
        Duration::from_millis(100),
    )
    .await
}

#[cfg(target_os = "macos")]
async fn open_local_app_runtime_channel() -> Result<Channel, crate::ProtectedCarrierError> {
    with_one_unavailable_retry(
        open_verified_local_app_runtime_channel,
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

pub(super) fn invalid_payload() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false)
}

pub(super) fn untrusted() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[test]
    fn local_app_session_decodes_exact_current_user_and_isolates_unavailable_display() {
        let ready = validate_session_projection(crate::generated::OpenLocalAppSessionResponse {
            state: LOCAL_APP_SESSION_READY,
            reason_code: ACTION_EXECUTED,
            current_user: Some(crate::generated::CurrentUserDisplayProjection {
                handle: "halliday".to_string(),
                display_name: "Halliday".to_string(),
                avatar_url: None,
            }),
            current_user_reason_code: ACTION_EXECUTED,
        })
        .expect("ready Current User");
        assert_eq!(
            ready.current_user.value.expect("display"),
            LocalAppCurrentUserDisplay {
                handle: "halliday".to_string(),
                display_name: "Halliday".to_string(),
                avatar_url: None,
            }
        );

        let unavailable =
            validate_session_projection(crate::generated::OpenLocalAppSessionResponse {
                state: LOCAL_APP_SESSION_READY,
                reason_code: ACTION_EXECUTED,
                current_user: None,
                current_user_reason_code: CURRENT_USER_DISPLAY_UNAVAILABLE,
            })
            .expect("display failure must not fail the App session");
        assert_eq!(unavailable.state, LocalAppSessionState::Ready);
        assert_eq!(unavailable.current_user.value, None);
        assert!(unavailable.current_user.retryable);
    }

    #[test]
    fn local_app_session_rejects_malformed_or_credential_bearing_avatar_projection() {
        for avatar in [
            "https://cdn.example/a.png?token=secret",
            "https://user:secret@cdn.example/a.png",
            "http://realm.example/a.png",
        ] {
            let response = crate::generated::OpenLocalAppSessionResponse {
                state: LOCAL_APP_SESSION_READY,
                reason_code: ACTION_EXECUTED,
                current_user: Some(crate::generated::CurrentUserDisplayProjection {
                    handle: "halliday".to_string(),
                    display_name: "Halliday".to_string(),
                    avatar_url: Some(avatar.to_string()),
                }),
                current_user_reason_code: ACTION_EXECUTED,
            };
            assert!(
                validate_session_projection(response).is_err(),
                "avatar {avatar}"
            );
        }
    }

    #[test]
    fn anonymous_ready_runtime_retains_verified_channel_for_later_account_binding() {
        let error = LocalAppOperationError::new(LocalAppReasonCode::RuntimeUnauthenticated, false);
        assert!(retain_channel_for_account_required(&error));
    }

    #[test]
    fn unreachable_runtime_does_not_masquerade_as_account_required() {
        let error =
            LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true);
        assert!(!retain_channel_for_account_required(&error));
    }

    #[test]
    fn raced_session_open_failure_stays_transient_unavailable() {
        for reason in [
            LocalAppReasonCode::RuntimeServiceErrorUnclassified,
            LocalAppReasonCode::OperationUnavailable,
        ] {
            let error = transient_open_session_failure(LocalAppOperationError::new(reason, false));
            assert_eq!(
                error.reason_code(),
                LocalAppReasonCode::RuntimeServiceUnavailable,
                "{reason:?}"
            );
            assert!(error.retryable(), "{reason:?}");
        }
    }

    #[test]
    fn typed_session_open_denials_keep_exact_verdicts() {
        for reason in [
            LocalAppReasonCode::RuntimeServiceUntrusted,
            LocalAppReasonCode::Revoked,
            LocalAppReasonCode::RuntimeAccessDenied,
            LocalAppReasonCode::ProcessReplaced,
        ] {
            let error = LocalAppOperationError::new(reason, false);
            assert_eq!(
                transient_open_session_failure(error).reason_code(),
                reason,
                "{reason:?}"
            );
        }
    }

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
}
