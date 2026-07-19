use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::future::Future;
use std::io;
use std::os::windows::io::AsRawHandle;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};

use hyper_util::rt::TokioIo;
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::Mutex as AsyncMutex;
use tonic::transport::{Channel, Endpoint};
use tower::service_fn;
use windows_service::service::{ServiceAccess, ServiceState};
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::OpenDesktopSessionRequest;
use crate::windows_peer_trust::{verify_runtime_peer_code_signing, VerifiedRuntimePeer};
use crate::{
    DesktopAccountActionRequest, DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse, DesktopAccountSessionStatus,
    DesktopAccountSessionStatusRequest, DesktopProductControlError, DesktopProductControlRequest,
    DesktopProductControlResponse, DesktopRuntimeConsumerError, DesktopRuntimeConsumerRequest,
    DesktopRuntimeConsumerResponse, DeveloperModeStatus, LocalDevelopmentAuthoritySummary,
    LocalDevelopmentAuthorization, LocalDevelopmentDecisionRequest, LocalDevelopmentEndRunRequest,
    LocalDevelopmentEvaluation, LocalDevelopmentEvaluationRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, NimiDesktopControl, NimiHostError, NimiHostErrorReasonCode,
    NimiProtectedLocalHostCarrier, ProtectedCarrierError, ProtectedCarrierReasonCode,
    RuntimeServiceActionOutcome, RuntimeServiceState, RuntimeServiceStatus,
};

#[path = "windows_service_projection.rs"]
mod projection;
use projection::{project_start_outcome, project_status};

#[cfg(not(feature = "windows-e2e-fixture"))]
const RUNTIME_SERVICE_NAME: &str = "NimiRuntime";
#[cfg(feature = "windows-e2e-fixture")]
const RUNTIME_SERVICE_NAME: &str = "NimiRuntimeE2E";
#[cfg(not(feature = "windows-e2e-fixture"))]
const RUNTIME_PROTECTED_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-protected-v1";
#[cfg(feature = "windows-e2e-fixture")]
const RUNTIME_PROTECTED_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-e2e-protected-v1";

#[path = "windows_service_lifecycle.rs"]
mod lifecycle;
use lifecycle::request_verified_runtime_restart_on_channel;

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsNamedPipeCarrier;

struct WindowsDesktopControl {
    session: Arc<VerifiedDesktopRuntimeSession>,
    development_processes:
        Mutex<HashMap<[u8; 32], crate::windows_supervised_process::SupervisedDevelopmentProcess>>,
}

struct VerifiedDesktopRuntimeSession {
    channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    _desktop_session_id: [u8; 32],
    runtime_boot_epoch: [u8; 32],
}

static DESKTOP_RUNTIME_SESSION: OnceLock<AsyncMutex<Option<Arc<VerifiedDesktopRuntimeSession>>>> =
    OnceLock::new();

fn desktop_runtime_session_cache() -> &'static AsyncMutex<Option<Arc<VerifiedDesktopRuntimeSession>>>
{
    DESKTOP_RUNTIME_SESSION.get_or_init(|| AsyncMutex::new(None))
}

impl WindowsDesktopControl {
    fn channel(&self) -> Channel {
        self.session.channel.clone()
    }
}

impl NimiDesktopControl for WindowsDesktopControl {
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
            let mut processes = self.development_processes.lock().map_err(|_| {
                NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
            })?;
            let _replaced = processes.insert(run_id, process).is_some();
            #[cfg(feature = "windows-e2e-fixture")]
            eprintln!(
                "[protected-local local-development windows-e2e-fixture] stage=host-carrier-retained replaced={_replaced}"
            );
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
            let mut processes = self.development_processes.lock().map_err(|_| {
                NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
            })?;
            processes.remove(&run_id);
            result
        })
    }

    fn local_development_host_running(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<bool, NimiHostError> {
        if supervisor_run_id == [0u8; 32] {
            return Err(NimiHostError::new(
                NimiHostErrorReasonCode::RuntimeServiceUntrusted,
                false,
            ));
        }
        let processes = self.development_processes.lock().map_err(|_| {
            NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
        })?;
        let _present = processes.contains_key(&supervisor_run_id);
        let running = processes
            .get(&supervisor_run_id)
            .is_some_and(|process| process.running());
        #[cfg(feature = "windows-e2e-fixture")]
        eprintln!(
            "[protected-local local-development windows-e2e-fixture] stage=host-carrier-health present={_present} running={running}"
        );
        Ok(running)
    }

    fn terminate_local_development_host(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<(), NimiHostError> {
        if supervisor_run_id == [0u8; 32] {
            return Err(NimiHostError::new(
                NimiHostErrorReasonCode::RuntimeServiceUntrusted,
                false,
            ));
        }
        let mut processes = self.development_processes.lock().map_err(|_| {
            NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
        })?;
        let _removed = processes.remove(&supervisor_run_id).is_some();
        #[cfg(feature = "windows-e2e-fixture")]
        eprintln!(
            "[protected-local local-development windows-e2e-fixture] stage=host-carrier-removed removed={_removed}"
        );
        Ok(())
    }
}

impl NimiProtectedLocalHostCarrier for WindowsNamedPipeCarrier {
    fn open_desktop_control(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async { open_verified_desktop_control().await })
    }
}

async fn open_verified_desktop_control(
) -> Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError> {
    let session = shared_verified_desktop_runtime_session().await?;
    Ok(Box::new(WindowsDesktopControl {
        session,
        development_processes: Mutex::new(HashMap::new()),
    }))
}

pub(crate) async fn open_verified_runtime_channel(
    pipe_name: &'static str,
) -> Result<(Channel, VerifiedRuntimePeer), ProtectedCarrierError> {
    let before = query_service_status()?;
    let expected_pid = running_service_pid(&before)?;
    diagnose_desktop_session("service-running");
    let pipe = ClientOptions::new()
        .open(pipe_name)
        .map_err(|_| unavailable())?;
    diagnose_desktop_session("pipe-opened");
    let pipe_server_pid = named_pipe_server_pid_from_handle(pipe.as_raw_handle() as HANDLE)?;
    let after = query_service_status()?;
    let observed_pid = running_service_pid(&after)?;
    validate_stable_server_binding(expected_pid, observed_pid, pipe_server_pid)?;
    diagnose_desktop_session("pipe-scm-binding-verified");
    let runtime_peer = verify_runtime_peer_code_signing(pipe_server_pid)?;
    diagnose_desktop_session("runtime-peer-verified");
    let channel = channel_from_verified_pipe(pipe).await.map_err(|_| {
        // SCM PID stability and Authenticode identity are already verified.
        // A transport handshake that then fails is an availability race, not
        // evidence that an unverified Runtime gained authority.
        diagnose_desktop_session("grpc-channel-open-failed");
        unavailable()
    })?;
    diagnose_desktop_session("grpc-channel-opened");
    Ok((channel, runtime_peer))
}

async fn shared_verified_desktop_runtime_session(
) -> Result<Arc<VerifiedDesktopRuntimeSession>, ProtectedCarrierError> {
    let mut slot = desktop_runtime_session_cache().lock().await;
    if let Some(session) = slot.as_ref() {
        return Ok(session.clone());
    }

    let (channel, runtime_peer) =
        open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await?;
    diagnose_desktop_session("open-desktop-session-started");
    let mut auth = RuntimeAuthServiceClient::new(channel.clone());
    let opened = auth
        .open_desktop_session(OpenDesktopSessionRequest {})
        .await
        .map_err(|status| {
            diagnose_desktop_session(&format!(
                "open-failed-{}-{}",
                status.code(),
                crate::grpc_status::runtime_reason(&status)
                    .unwrap_or_else(|| "no-runtime-reason".to_string())
            ));
            untrusted()
        })?
        .into_inner();
    let desktop_session_id: [u8; 32] = opened
        .desktop_session_id
        .try_into()
        .map_err(|_| untrusted())?;
    let runtime_boot_epoch: [u8; 32] = opened
        .runtime_boot_epoch
        .try_into()
        .map_err(|_| untrusted())?;
    if desktop_session_id == [0u8; 32] || runtime_boot_epoch == [0u8; 32] {
        diagnose_desktop_session("invalid-session-identity");
        return Err(untrusted());
    }
    diagnose_desktop_session("opened");
    let session = Arc::new(VerifiedDesktopRuntimeSession {
        channel,
        _runtime_peer: runtime_peer,
        _desktop_session_id: desktop_session_id,
        runtime_boot_epoch,
    });
    *slot = Some(session.clone());
    Ok(session)
}

fn diagnose_desktop_session(stage: &str) {
    if std::env::var_os("NIMI_PROTECTED_LOCAL_DIAGNOSTICS").as_deref()
        == Some(std::ffi::OsStr::new("1"))
    {
        eprintln!("[protected-local desktop-session] stage={stage}");
    }
}

/// Returns a clone of the one boot-scoped Desktop control channel shared by
/// status, control, unary, and streaming calls. `OpenDesktopSession` runs once
/// on that exact mutually verified connection; no portable session authority
/// or caller-selected endpoint crosses this boundary.
pub async fn open_verified_desktop_runtime_channel() -> Result<Channel, ProtectedCarrierError> {
    Ok(shared_verified_desktop_runtime_session()
        .await?
        .channel
        .clone())
}

/// Drops Kit's owner-side reference after a verified disconnect or Runtime
/// replacement so the next call must repeat the full fixed-service handshake.
pub async fn invalidate_verified_desktop_runtime_channel() {
    if let Some(cache) = DESKTOP_RUNTIME_SESSION.get() {
        cache.lock().await.take();
    }
}

async fn channel_from_verified_pipe(
    pipe: NamedPipeClient,
) -> Result<Channel, ProtectedCarrierError> {
    let pipe = Arc::new(Mutex::new(Some(pipe)));
    let connector = service_fn(move |_| {
        let client = pipe
            .lock()
            .map_err(|_| io::Error::other("protected pipe connector poisoned"))
            .and_then(|mut pipe| {
                pipe.take()
                    .ok_or_else(|| io::Error::other("protected pipe already consumed"))
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

fn service_manager() -> Result<ServiceManager, ProtectedCarrierError> {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|_| unavailable())
}

fn query_service_state(access: ServiceAccess) -> Result<ServiceState, ProtectedCarrierError> {
    let manager = service_manager()?;
    let service = manager
        .open_service(RUNTIME_SERVICE_NAME, access)
        .map_err(|_| unavailable())?;
    service
        .query_status()
        .map(|status| status.current_state)
        .map_err(|_| unavailable())
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

fn verify_fixed_pipe_scm_binding() -> Result<(), ProtectedCarrierError> {
    let before = query_service_status()?;
    let expected_pid = running_service_pid(&before)?;
    let pipe = open_fixed_runtime_pipe()?;
    let pipe_server_pid = named_pipe_server_pid(&pipe)?;
    let after = query_service_status()?;
    let observed_pid = running_service_pid(&after)?;
    validate_stable_server_binding(expected_pid, observed_pid, pipe_server_pid)?;
    verify_runtime_peer_code_signing(pipe_server_pid).map(|_| ())
}

fn query_service_status() -> Result<windows_service::service::ServiceStatus, ProtectedCarrierError>
{
    let manager = service_manager()?;
    let service = manager
        .open_service(RUNTIME_SERVICE_NAME, ServiceAccess::QUERY_STATUS)
        .map_err(|_| unavailable())?;
    service.query_status().map_err(|_| unavailable())
}

fn running_service_pid(
    status: &windows_service::service::ServiceStatus,
) -> Result<u32, ProtectedCarrierError> {
    if status.current_state != ServiceState::Running {
        return Err(unavailable());
    }
    status
        .process_id
        .filter(|pid| *pid != 0)
        .ok_or_else(untrusted)
}

fn open_fixed_runtime_pipe() -> Result<File, ProtectedCarrierError> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(RUNTIME_PROTECTED_PIPE_NAME)
        .map_err(|_| unavailable())
}

fn named_pipe_server_pid(pipe: &File) -> Result<u32, ProtectedCarrierError> {
    named_pipe_server_pid_from_handle(pipe.as_raw_handle() as HANDLE)
}

fn named_pipe_server_pid_from_handle(handle: HANDLE) -> Result<u32, ProtectedCarrierError> {
    if handle.is_null() {
        return Err(untrusted());
    }
    let mut pid = 0u32;
    // SAFETY: `handle` is borrowed from a live `File`, the output pointer is
    // valid for one u32, and neither value escapes this call.
    let succeeded = unsafe { GetNamedPipeServerProcessId(handle, &mut pid) };
    if succeeded == 0 || pid == 0 {
        return Err(untrusted());
    }
    Ok(pid)
}

fn validate_stable_server_binding(
    before_pid: u32,
    after_pid: u32,
    pipe_server_pid: u32,
) -> Result<(), ProtectedCarrierError> {
    if before_pid == 0
        || after_pid == 0
        || pipe_server_pid == 0
        || before_pid != after_pid
        || before_pid != pipe_server_pid
    {
        return Err(untrusted());
    }
    Ok(())
}
