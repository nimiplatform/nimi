use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::os::fd::AsRawFd;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use hyper_util::rt::TokioIo;
use tokio::net::UnixStream;
use tokio::sync::Mutex as AsyncMutex;
use tonic::transport::{Channel, Endpoint};
use tower::service_fn;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;
use crate::generated::{OpenDesktopSessionRequest, RequestRuntimeRestartRequest};
use crate::macos_peer_trust::{
    verify_runtime_peer, MacOSRuntimeProcessIdentity, VerifiedMacOSRuntimePeer,
    MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH, MACOS_RUNTIME_SOCKET_PATH,
};
use crate::macos_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, DesktopProductControlError,
    DesktopProductControlRequest, DesktopProductControlResponse, DesktopRuntimeConsumerError,
    DesktopRuntimeConsumerRequest, DesktopRuntimeConsumerResponse, DeveloperModeStatus,
    FixedRuntimeServiceControl, LocalDevelopmentAuthoritySummary, LocalDevelopmentAuthorization,
    LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest, LocalDevelopmentEvaluation,
    LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, NimiDesktopControl, NimiHostError, NimiHostErrorReasonCode,
    NimiProtectedLocalHostCarrier, ProtectedCarrierError, ProtectedCarrierReasonCode,
    RuntimeServiceActionOutcome, RuntimeServiceState, RuntimeServiceStatus,
};

const SERVICE_NOT_REGISTERED: i32 = 0;
const SERVICE_ENABLED: i32 = 1;
const SERVICE_REQUIRES_APPROVAL: i32 = 2;
const SERVICE_NOT_FOUND: i32 = 3;
const RESTART_DEADLINE: Duration = Duration::from_secs(90);

unsafe extern "C" {
    fn nimi_macos_runtime_service_status() -> i32;
    fn nimi_macos_register_runtime_service() -> i32;
    fn nimi_macos_reregister_runtime_service() -> i32;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsUnixSocketCarrier;

struct MacOSDesktopControl {
    session: Arc<VerifiedDesktopRuntimeSession>,
    development_processes: Mutex<HashMap<[u8; 32], SupervisedDevelopmentProcess>>,
}

struct VerifiedDesktopRuntimeSession {
    channel: Channel,
    runtime_peer: VerifiedMacOSRuntimePeer,
    _desktop_session_id: [u8; 32],
    runtime_boot_epoch: [u8; 32],
}

static DESKTOP_RUNTIME_SESSION: OnceLock<AsyncMutex<Option<Arc<VerifiedDesktopRuntimeSession>>>> =
    OnceLock::new();

fn desktop_runtime_session_cache() -> &'static AsyncMutex<Option<Arc<VerifiedDesktopRuntimeSession>>>
{
    DESKTOP_RUNTIME_SESSION.get_or_init(|| AsyncMutex::new(None))
}

impl MacOSDesktopControl {
    fn channel(&self) -> Channel {
        self.session.channel.clone()
    }
}

impl NimiDesktopControl for MacOSDesktopControl {
    fn invoke_product_control(
        &self,
        request: DesktopProductControlRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopProductControlResponse, DesktopProductControlError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::desktop_product_control::invoke(
            self.channel(),
            request,
        ))
    }

    fn invoke_runtime_consumer(
        &self,
        request: DesktopRuntimeConsumerRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopRuntimeConsumerResponse, DesktopRuntimeConsumerError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::desktop_runtime_consumer::invoke(
            self.channel(),
            request,
        ))
    }

    fn request_runtime_service_restart(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<RuntimeServiceActionOutcome, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(request_verified_runtime_restart_on_channel(
            self.channel(),
            self.session.runtime_boot_epoch,
            self.session.runtime_peer.identity(),
        ))
    }

    fn get_account_session_status(
        &self,
        request: DesktopAccountSessionStatusRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DesktopAccountSessionStatus, NimiHostError>> + Send + '_>>
    {
        Box::pin(crate::windows_desktop_account::get_account_session_status(
            self.channel(),
            request,
        ))
    }

    fn open_account_session_events(
        &self,
        request: DesktopAccountSessionEventsRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopAccountSessionEventReceiver, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::windows_desktop_account::open_account_session_events(
            self.channel(),
            request,
        ))
    }

    fn begin_account_login(
        &self,
        request: DesktopAccountBeginLoginRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopAccountBeginLoginResponse, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::windows_desktop_account::begin_login(
            self.channel(),
            request,
        ))
    }

    fn complete_account_login(
        &self,
        request: DesktopAccountCompleteLoginRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    > {
        Box::pin(crate::windows_desktop_account::complete_login(
            self.channel(),
            request,
        ))
    }

    fn invoke_account_realm_unary(
        &self,
        request: DesktopAccountRealmUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopAccountRealmUnaryResponse, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::windows_desktop_account::invoke_realm_unary(
            self.channel(),
            request,
        ))
    }

    fn logout_account(
        &self,
        request: DesktopAccountActionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    > {
        Box::pin(crate::windows_desktop_account::logout(
            self.channel(),
            request,
        ))
    }

    fn switch_account(
        &self,
        request: DesktopAccountActionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    > {
        Box::pin(crate::windows_desktop_account::switch_account(
            self.channel(),
            request,
        ))
    }

    fn get_developer_mode_status(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>> {
        Box::pin(crate::windows_local_development::get_developer_mode_status(
            self.channel(),
        ))
    }

    fn get_local_development_authority_summary(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<LocalDevelopmentAuthoritySummary, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(
            crate::windows_local_development_authority_summary::get_authority_summary(
                self.channel(),
            ),
        )
    }

    fn set_developer_mode(
        &self,
        enabled: bool,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>> {
        Box::pin(crate::windows_local_development::set_developer_mode(
            self.channel(),
            enabled,
        ))
    }

    fn evaluate_local_development_project(
        &self,
        request: LocalDevelopmentEvaluationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LocalDevelopmentEvaluation, NimiHostError>> + Send + '_>>
    {
        Box::pin(crate::windows_local_development::evaluate_project(
            self.channel(),
            request,
        ))
    }

    fn decide_local_development_project(
        &self,
        request: LocalDevelopmentDecisionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    > {
        Box::pin(crate::windows_local_development::decide_project(
            self.channel(),
            request,
        ))
    }

    fn list_local_development_authorizations(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalDevelopmentAuthorization>, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::windows_local_development::list_authorizations(
            self.channel(),
        ))
    }

    fn revoke_local_development_authorization(
        &self,
        authorization_id: [u8; 32],
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    > {
        Box::pin(crate::windows_local_development::revoke_authorization(
            self.channel(),
            authorization_id,
        ))
    }

    fn launch_local_development_host(
        &self,
        request: LocalDevelopmentLaunchRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentLaunchOutcome, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            let run_id = request.supervisor_run_id;
            let (outcome, process) =
                crate::windows_local_development::launch_host(self.channel(), request).await?;
            let mut processes = self
                .development_processes
                .lock()
                .map_err(|_| untrusted_host())?;
            if let Some(replaced) = processes.insert(run_id, process) {
                drop(replaced);
                return Err(untrusted_host());
            }
            Ok(outcome)
        })
    }

    fn end_local_development_run(
        &self,
        request: LocalDevelopmentEndRunRequest,
    ) -> Pin<Box<dyn Future<Output = Result<(), NimiHostError>> + Send + '_>> {
        Box::pin(async move {
            let run_id = request.supervisor_run_id;
            let result = crate::windows_local_development::end_run(self.channel(), request).await;
            let process = self
                .development_processes
                .lock()
                .map_err(|_| untrusted_host())?
                .remove(&run_id);
            drop(process);
            result
        })
    }

    fn local_development_host_running(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<bool, NimiHostError> {
        if supervisor_run_id == [0u8; 32] {
            return Err(untrusted_host());
        }
        let processes = self
            .development_processes
            .lock()
            .map_err(|_| untrusted_host())?;
        Ok(processes
            .get(&supervisor_run_id)
            .is_some_and(SupervisedDevelopmentProcess::running))
    }

    fn terminate_local_development_host(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<(), NimiHostError> {
        if supervisor_run_id == [0u8; 32] {
            return Err(untrusted_host());
        }
        let process = self
            .development_processes
            .lock()
            .map_err(|_| untrusted_host())?
            .remove(&supervisor_run_id);
        drop(process);
        Ok(())
    }
}

impl NimiProtectedLocalHostCarrier for MacOsUnixSocketCarrier {
    fn open_desktop_control(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async {
            let session = shared_verified_desktop_runtime_session().await?;
            Ok(Box::new(MacOSDesktopControl {
                session,
                development_processes: Mutex::new(HashMap::new()),
            }) as Box<dyn NimiDesktopControl>)
        })
    }
}

impl FixedRuntimeServiceControl for MacOsUnixSocketCarrier {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
        match macos_service_status()? {
            SERVICE_NOT_REGISTERED => Ok(service_status(RuntimeServiceState::Stopped, None, true)),
            SERVICE_ENABLED => Ok(service_status(
                RuntimeServiceState::StartPending,
                None,
                true,
            )),
            SERVICE_REQUIRES_APPROVAL => Ok(service_status(
                RuntimeServiceState::StartPending,
                Some(ProtectedCarrierReasonCode::RuntimeServiceRepairRequired),
                false,
            )),
            SERVICE_NOT_FOUND => Err(repair_required()),
            _ => Err(untrusted()),
        }
    }

    fn request_runtime_service_start(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
        let before = macos_service_status()?;
        let after = if before == SERVICE_NOT_REGISTERED {
            // SAFETY: SMAppService resolves only the fixed embedded daemon
            // plist in the current /Applications/Nimi.app bundle.
            unsafe { nimi_macos_register_runtime_service() }
        } else if before == SERVICE_ENABLED && runtime_socket_is_absent()? {
            // SAFETY: the explicit start action is repairing the update state
            // where SMAppService still records the previous registration but
            // the installer has booted out its launchd job. The native helper
            // waits for asynchronous unregister completion before registering
            // the exact new /Applications/Nimi.app embedded daemon.
            unsafe { nimi_macos_reregister_runtime_service() }
        } else {
            before
        };
        match after {
            SERVICE_ENABLED => Ok(service_outcome(
                RuntimeServiceState::StartPending,
                None,
                true,
            )),
            SERVICE_REQUIRES_APPROVAL => Ok(service_outcome(
                RuntimeServiceState::StartPending,
                Some(ProtectedCarrierReasonCode::RuntimeServiceRepairRequired),
                false,
            )),
            SERVICE_NOT_REGISTERED => Err(unavailable()),
            SERVICE_NOT_FOUND => Err(repair_required()),
            _ => Err(untrusted()),
        }
    }

    fn request_runtime_service_restart(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<RuntimeServiceActionOutcome, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async {
            let session = shared_verified_desktop_runtime_session().await?;
            request_verified_runtime_restart_on_channel(
                session.channel.clone(),
                session.runtime_boot_epoch,
                session.runtime_peer.identity(),
            )
            .await
        })
    }
}

fn runtime_socket_is_absent() -> Result<bool, ProtectedCarrierError> {
    match std::fs::symlink_metadata(MACOS_RUNTIME_SOCKET_PATH) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(_) => Err(repair_required()),
    }
}

async fn shared_verified_desktop_runtime_session(
) -> Result<Arc<VerifiedDesktopRuntimeSession>, ProtectedCarrierError> {
    let mut slot = desktop_runtime_session_cache().lock().await;
    if let Some(session) = slot.as_ref() {
        if session.runtime_peer.intact() {
            return Ok(session.clone());
        }
        slot.take();
    }
    let session = Arc::new(open_verified_desktop_runtime_session().await?);
    *slot = Some(session.clone());
    Ok(session)
}

async fn open_verified_desktop_runtime_session(
) -> Result<VerifiedDesktopRuntimeSession, ProtectedCarrierError> {
    let (channel, runtime_peer) = open_verified_runtime_channel().await?;
    let opened = RuntimeAuthServiceClient::new(channel.clone())
        .open_desktop_session(OpenDesktopSessionRequest {})
        .await
        .map_err(|_| untrusted())?
        .into_inner();
    let desktop_session_id: [u8; 32] = opened
        .desktop_session_id
        .try_into()
        .map_err(|_| untrusted())?;
    let runtime_boot_epoch: [u8; 32] = opened
        .runtime_boot_epoch
        .try_into()
        .map_err(|_| untrusted())?;
    if desktop_session_id == [0u8; 32] || runtime_boot_epoch == [0u8; 32] || !runtime_peer.intact()
    {
        return Err(untrusted());
    }
    Ok(VerifiedDesktopRuntimeSession {
        channel,
        runtime_peer,
        _desktop_session_id: desktop_session_id,
        runtime_boot_epoch,
    })
}

async fn open_verified_runtime_channel(
) -> Result<(Channel, VerifiedMacOSRuntimePeer), ProtectedCarrierError> {
    if macos_service_status()? != SERVICE_ENABLED {
        return Err(unavailable());
    }
    let stream = UnixStream::connect(MACOS_RUNTIME_SOCKET_PATH)
        .await
        .map_err(|_| unavailable())?;
    let peer = verify_runtime_peer(stream.as_raw_fd(), MACOS_RUNTIME_SOCKET_PATH)?;
    if macos_service_status()? != SERVICE_ENABLED || !peer.intact() {
        return Err(untrusted());
    }
    let channel = channel_from_verified_socket(stream).await?;
    if !peer.intact() {
        return Err(untrusted());
    }
    Ok((channel, peer))
}

pub(crate) async fn open_verified_local_app_runtime_channel(
) -> Result<(Channel, VerifiedMacOSRuntimePeer), ProtectedCarrierError> {
    let stream = UnixStream::connect(MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH)
        .await
        .map_err(|_| unavailable())?;
    let peer = verify_runtime_peer(stream.as_raw_fd(), MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH)?;
    let channel = channel_from_verified_socket(stream).await?;
    if !peer.intact() {
        return Err(untrusted());
    }
    Ok((channel, peer))
}

async fn channel_from_verified_socket(
    stream: UnixStream,
) -> Result<Channel, ProtectedCarrierError> {
    let stream = Arc::new(Mutex::new(Some(stream)));
    let connector = service_fn(move |_| {
        let client = stream
            .lock()
            .map_err(|_| io::Error::other("protected Unix socket connector poisoned"))
            .and_then(|mut stream| {
                stream
                    .take()
                    .ok_or_else(|| io::Error::other("protected Unix socket already consumed"))
            })
            .map(TokioIo::new);
        async move { client }
    });
    Endpoint::try_from("http://[::]:50051")
        .map_err(|_| untrusted())?
        .connect_with_connector(connector)
        .await
        .map_err(|_| untrusted())
}

async fn request_verified_runtime_restart_on_channel(
    channel: Channel,
    before_epoch: [u8; 32],
    before_process: MacOSRuntimeProcessIdentity,
) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
    if before_epoch == [0u8; 32] || before_process.pid == 0 || before_process.pidversion == 0 {
        return Err(untrusted());
    }
    let result = RuntimeServiceControlServiceClient::new(channel)
        .request_runtime_restart(RequestRuntimeRestartRequest {})
        .await;
    match result {
        Ok(response) => {
            if !response.into_inner().accepted {
                return Err(untrusted());
            }
        }
        Err(status)
            if matches!(
                status.code(),
                tonic::Code::Unavailable | tonic::Code::Cancelled | tonic::Code::Unknown
            ) => {}
        _ => return Err(untrusted()),
    }
    invalidate_verified_desktop_runtime_channel().await;
    let deadline = tokio::time::Instant::now() + RESTART_DEADLINE;
    let mut replacement_seen = false;
    loop {
        if tokio::time::Instant::now() >= deadline {
            return Err(if replacement_seen {
                unavailable()
            } else {
                repair_required()
            });
        }
        match open_verified_desktop_runtime_session().await {
            Ok(after) => {
                let after_process = after.runtime_peer.identity();
                if after_process != before_process {
                    if after.runtime_boot_epoch != [0u8; 32]
                        && after.runtime_boot_epoch != before_epoch
                    {
                        let mut slot = desktop_runtime_session_cache().lock().await;
                        *slot = Some(Arc::new(after));
                        return Ok(service_outcome(RuntimeServiceState::Running, None, false));
                    }
                    return Err(untrusted());
                }
            }
            Err(_) => replacement_seen = true,
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

pub async fn invalidate_verified_desktop_runtime_channel() {
    if let Some(cache) = DESKTOP_RUNTIME_SESSION.get() {
        cache.lock().await.take();
    }
}

fn macos_service_status() -> Result<i32, ProtectedCarrierError> {
    // SAFETY: this read-only call returns only SMAppService's closed status
    // enum for the fixed embedded plist and fixed main bundle path.
    let status = unsafe { nimi_macos_runtime_service_status() };
    match status {
        SERVICE_NOT_REGISTERED
        | SERVICE_ENABLED
        | SERVICE_REQUIRES_APPROVAL
        | SERVICE_NOT_FOUND => Ok(status),
        -2 => Err(repair_required()),
        _ => Err(untrusted()),
    }
}

fn service_status(
    state: RuntimeServiceState,
    reason_code: Option<ProtectedCarrierReasonCode>,
    retryable: bool,
) -> RuntimeServiceStatus {
    RuntimeServiceStatus {
        state,
        release_id: None,
        reason_code,
        retryable,
    }
}

fn service_outcome(
    state: RuntimeServiceState,
    reason_code: Option<ProtectedCarrierReasonCode>,
    retryable: bool,
) -> RuntimeServiceActionOutcome {
    RuntimeServiceActionOutcome {
        state,
        release_id: None,
        reason_code,
        retryable,
    }
}

fn unavailable() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUnavailable, true)
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

fn repair_required() -> ProtectedCarrierError {
    ProtectedCarrierError::new(
        ProtectedCarrierReasonCode::RuntimeServiceRepairRequired,
        false,
    )
}

fn untrusted_host() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}
