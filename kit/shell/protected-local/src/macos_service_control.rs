use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::os::fd::AsRawFd;
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use hyper_util::rt::TokioIo;
use tokio::net::UnixStream;
use tonic::transport::{Channel, Endpoint};
use tower::service_fn;

use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;
use crate::generated::RequestRuntimeRestartRequest;
use crate::macos_peer_trust::{
    verify_runtime_peer_once, MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH, MACOS_RUNTIME_SOCKET_PATH,
};
use crate::macos_supervised_process::SupervisedDevelopmentProcess;
use crate::{
    BundledAvatarRuntimeError, BundledAvatarRuntimeRequest, BundledAvatarRuntimeResponse,
    BundledAvatarRuntimeStreamReceiver, DesktopAccountActionRequest,
    DesktopAccountBeginLoginRequest, DesktopAccountBeginLoginResponse,
    DesktopAccountCompleteLoginRequest, DesktopAccountMutationResponse,
    DesktopAccountProductStreamRequest, DesktopAccountProductUnaryRequest,
    DesktopAccountRealmUnaryRequest, DesktopAccountRealmUnaryResponse,
    DesktopAccountSessionEventReceiver, DesktopAccountSessionEventsRequest,
    DesktopAccountSessionStatus, DesktopAccountSessionStatusRequest, DesktopFirstPartyProductError,
    DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductUnaryResponse,
    DesktopMachineProductStreamRequest, DesktopMachineProductUnaryRequest,
    DesktopPermissionOwnerUnaryRequest, DesktopPermissionOwnerUnaryResponse, DeveloperModeStatus,
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

type ControlFuture<'a, T, E> = Pin<Box<dyn Future<Output = Result<T, E>> + Send + 'a>>;

unsafe extern "C" {
    fn nimi_macos_runtime_service_status() -> i32;
    fn nimi_macos_register_runtime_service() -> i32;
    fn nimi_macos_reregister_runtime_service() -> i32;
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MacOsUnixSocketCarrier;

struct MacOSDesktopControl {
    channel: Channel,
    development_processes: Mutex<HashMap<[u8; 32], SupervisedDevelopmentProcess>>,
}

impl MacOSDesktopControl {
    fn host_channel(&self) -> Result<Channel, NimiHostError> {
        Ok(self.channel.clone())
    }

    fn product_profile_channel(&self) -> Result<Channel, DesktopFirstPartyProductError> {
        self.host_channel().map_err(|error| {
            DesktopFirstPartyProductError::new(error.reason_code().as_str(), error.retryable())
        })
    }

    fn bundled_avatar_channel(&self) -> Result<Channel, BundledAvatarRuntimeError> {
        self.host_channel().map_err(|error| {
            BundledAvatarRuntimeError::new(error.reason_code().as_str(), error.retryable())
        })
    }
}

impl NimiDesktopControl for MacOSDesktopControl {
    fn invoke_bundled_avatar(
        &self,
        request: BundledAvatarRuntimeRequest,
    ) -> ControlFuture<'_, BundledAvatarRuntimeResponse, BundledAvatarRuntimeError> {
        Box::pin(async move {
            crate::bundled_avatar::invoke(self.bundled_avatar_channel()?, request).await
        })
    }

    fn open_bundled_avatar_stream(
        &self,
        request: BundledAvatarRuntimeRequest,
    ) -> ControlFuture<'_, BundledAvatarRuntimeStreamReceiver, BundledAvatarRuntimeError> {
        Box::pin(async move {
            crate::bundled_avatar::open_stream(self.bundled_avatar_channel()?, request).await
        })
    }

    fn invoke_machine_product_unary(
        &self,
        request: DesktopMachineProductUnaryRequest,
    ) -> ControlFuture<'_, DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError>
    {
        Box::pin(async move {
            crate::first_party_product::invoke_machine_unary(
                self.product_profile_channel()?,
                request,
            )
            .await
        })
    }

    fn open_machine_product_stream(
        &self,
        request: DesktopMachineProductStreamRequest,
    ) -> ControlFuture<'_, DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductError>
    {
        Box::pin(async move {
            crate::first_party_product::open_machine_stream(
                self.product_profile_channel()?,
                request,
            )
            .await
        })
    }

    fn invoke_account_product_unary(
        &self,
        request: DesktopAccountProductUnaryRequest,
    ) -> ControlFuture<'_, DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError>
    {
        Box::pin(async move {
            crate::first_party_product::invoke_account_unary(
                self.product_profile_channel()?,
                request,
            )
            .await
        })
    }

    fn open_account_product_stream(
        &self,
        request: DesktopAccountProductStreamRequest,
    ) -> ControlFuture<'_, DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductError>
    {
        Box::pin(async move {
            crate::first_party_product::open_account_stream(
                self.product_profile_channel()?,
                request,
            )
            .await
        })
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
        Box::pin(async move { request_runtime_restart_on_channel(self.channel.clone()).await })
    }

    fn get_account_session_status(
        &self,
        request: DesktopAccountSessionStatusRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DesktopAccountSessionStatus, NimiHostError>> + Send + '_>>
    {
        Box::pin(async move {
            crate::windows_desktop_account::get_account_session_status(
                self.host_channel()?,
                request,
            )
            .await
        })
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
        Box::pin(async move {
            crate::windows_desktop_account::open_account_session_events(
                self.host_channel()?,
                request,
            )
            .await
        })
    }

    fn invoke_permission_owner_unary(
        &self,
        request: DesktopPermissionOwnerUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<DesktopPermissionOwnerUnaryResponse, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            crate::windows_desktop_account::invoke_permission_owner_unary(
                self.host_channel()?,
                request,
            )
            .await
        })
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
        Box::pin(async move {
            crate::windows_desktop_account::begin_login(self.host_channel()?, request).await
        })
    }

    fn complete_account_login(
        &self,
        request: DesktopAccountCompleteLoginRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            crate::windows_desktop_account::complete_login(self.host_channel()?, request).await
        })
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
        Box::pin(async move {
            crate::windows_desktop_account::invoke_realm_unary(self.host_channel()?, request).await
        })
    }

    fn logout_account(
        &self,
        request: DesktopAccountActionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            crate::windows_desktop_account::logout(self.host_channel()?, request).await
        })
    }

    fn switch_account(
        &self,
        request: DesktopAccountActionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<DesktopAccountMutationResponse, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            crate::windows_desktop_account::switch_account(self.host_channel()?, request).await
        })
    }

    fn get_developer_mode_status(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>> {
        Box::pin(async move {
            crate::windows_local_development::get_developer_mode_status(self.host_channel()?).await
        })
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
        Box::pin(async move {
            crate::windows_local_development_authority_summary::get_authority_summary(
                self.host_channel()?,
            )
            .await
        })
    }

    fn set_developer_mode(
        &self,
        enabled: bool,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>> {
        Box::pin(async move {
            crate::windows_local_development::set_developer_mode(self.host_channel()?, enabled)
                .await
        })
    }

    fn evaluate_local_development_project(
        &self,
        request: LocalDevelopmentEvaluationRequest,
    ) -> Pin<Box<dyn Future<Output = Result<LocalDevelopmentEvaluation, NimiHostError>> + Send + '_>>
    {
        Box::pin(async move {
            crate::windows_local_development::evaluate_project(self.host_channel()?, request).await
        })
    }

    fn decide_local_development_project(
        &self,
        request: LocalDevelopmentDecisionRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            crate::windows_local_development::decide_project(self.host_channel()?, request).await
        })
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
        Box::pin(async move {
            crate::windows_local_development::list_authorizations(self.host_channel()?).await
        })
    }

    fn revoke_local_development_authorization(
        &self,
        authorization_id: [u8; 32],
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentAuthorization, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            crate::windows_local_development::revoke_authorization(
                self.host_channel()?,
                authorization_id,
            )
            .await
        })
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
                crate::windows_local_development::launch_host(self.host_channel()?, request)
                    .await?;
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
            let result = match self.host_channel() {
                Ok(channel) => crate::windows_local_development::end_run(channel, request).await,
                Err(error) => Err(error),
            };
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
        self.host_channel()?;
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
            tokio::task::spawn_blocking(
                crate::macos_data_root::prepare_fixed_runtime_product_control_root,
            )
            .await
            .map_err(|_| repair_required())?
            .map_err(|_| repair_required())?;
            let channel = open_verified_runtime_channel().await?;
            Ok(Box::new(MacOSDesktopControl {
                channel,
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
            let channel = open_verified_runtime_channel().await?;
            request_runtime_restart_on_channel(channel).await
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

async fn open_verified_runtime_channel() -> Result<Channel, ProtectedCarrierError> {
    if macos_service_status()? != SERVICE_ENABLED {
        return Err(unavailable());
    }
    let stream = UnixStream::connect(MACOS_RUNTIME_SOCKET_PATH)
        .await
        .map_err(|_| unavailable())?;
    verify_runtime_peer_once(stream.as_raw_fd(), MACOS_RUNTIME_SOCKET_PATH)?;
    channel_from_verified_socket(stream).await
}

pub(crate) async fn open_verified_local_app_runtime_channel(
) -> Result<Channel, ProtectedCarrierError> {
    let stream = UnixStream::connect(MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH)
        .await
        .map_err(|_| unavailable())?;
    verify_runtime_peer_once(stream.as_raw_fd(), MACOS_RUNTIME_LOCAL_APP_SOCKET_PATH)?;
    channel_from_verified_socket(stream).await
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

async fn request_runtime_restart_on_channel(
    channel: Channel,
) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
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
    Ok(service_outcome(
        RuntimeServiceState::RestartPending,
        None,
        true,
    ))
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
