use std::collections::HashMap;
use std::future::Future;
use std::io;
use std::os::fd::AsRawFd;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};

use hyper_util::rt::TokioIo;
use tokio::net::UnixStream;
use tonic::transport::{Channel, Endpoint};
use tower::service_fn;

use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;
use crate::generated::RequestRuntimeRestartRequest;
use crate::macos_peer_trust::{
    local_app_runtime_socket_path, runtime_socket_path, verify_runtime_peer_once,
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
    DesktopMachineProductStreamRequest, DesktopMachineProductUnaryRequest, DeveloperModeStatus,
    FixedRuntimeServiceControl, LocalDevelopmentEndRunRequest, LocalDevelopmentLaunchOutcome,
    LocalDevelopmentLaunchRequest, LocalDevelopmentRegistration,
    LocalDevelopmentRegistrationRequest, NimiDesktopControl, NimiHostError,
    NimiHostErrorReasonCode, NimiProtectedLocalHostCarrier, ProtectedCarrierError,
    ProtectedCarrierReasonCode, RuntimeServiceActionOutcome, RuntimeServiceState,
    RuntimeServiceStatus,
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

struct SupervisedDevelopmentEntry {
    process: SupervisedDevelopmentProcess,
    request: LocalDevelopmentLaunchRequest,
}

type SupervisedDevelopmentRegistry = Arc<Mutex<HashMap<[u8; 32], SupervisedDevelopmentEntry>>>;

struct MacOSDesktopControl {
    channel: Channel,
    development_processes: SupervisedDevelopmentRegistry,
}

fn development_process_registry() -> SupervisedDevelopmentRegistry {
    #[cfg(feature = "macos-source-local-development")]
    {
        static REGISTRY: OnceLock<SupervisedDevelopmentRegistry> = OnceLock::new();
        return REGISTRY
            .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
            .clone();
    }
    #[cfg(not(feature = "macos-source-local-development"))]
    Arc::new(Mutex::new(HashMap::new()))
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

    fn set_developer_mode(
        &self,
        enabled: bool,
    ) -> Pin<Box<dyn Future<Output = Result<DeveloperModeStatus, NimiHostError>> + Send + '_>> {
        Box::pin(async move {
            crate::windows_local_development::set_developer_mode(self.host_channel()?, enabled)
                .await
        })
    }

    fn register_local_development_project(
        &self,
        request: LocalDevelopmentRegistrationRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentRegistration, NimiHostError>> + Send + '_>,
    > {
        Box::pin(async move {
            crate::windows_local_development::register_project(self.host_channel()?, request).await
        })
    }

    fn list_local_development_registrations(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Vec<LocalDevelopmentRegistration>, NimiHostError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            let channel = self.host_channel()?;
            #[cfg(feature = "macos-source-local-development")]
            renew_supervised_development_rebinds(channel.clone(), self.development_processes.clone())
                .await?;
            crate::windows_local_development::list_registrations(channel).await
        })
    }

    fn remove_local_development_registration(
        &self,
        registration_handle: [u8; 32],
    ) -> Pin<Box<dyn Future<Output = Result<(), NimiHostError>> + Send + '_>> {
        Box::pin(async move {
            crate::windows_local_development::remove_registration(
                self.host_channel()?,
                registration_handle,
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
            let retained_request = request.clone();
            let (outcome, process) =
                crate::windows_local_development::launch_host(self.host_channel()?, request)
                    .await?;
            let mut processes = self
                .development_processes
                .lock()
                .map_err(|_| untrusted_host())?;
            if let Some(replaced) = processes.insert(
                run_id,
                SupervisedDevelopmentEntry {
                    process,
                    request: retained_request,
                },
            ) {
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
            .is_some_and(|entry| entry.process.running()))
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

#[cfg(feature = "macos-source-local-development")]
async fn rebind_supervised_development_processes(
    channel: Channel,
    registry: SupervisedDevelopmentRegistry,
) -> Result<(), ProtectedCarrierError> {
    let running = {
        let mut entries = registry.lock().map_err(|_| untrusted())?;
        entries.retain(|_, entry| entry.process.running());
        entries
            .values()
            .map(|entry| (entry.request.clone(), entry.process.id()))
            .collect::<Vec<_>>()
    };
    for (request, process_id) in running {
        crate::windows_local_development::rebind_host(channel.clone(), request, process_id)
            .await
            .map_err(|error| {
                if error.retryable() {
                    unavailable()
                } else {
                    untrusted()
                }
            })?;
    }
    Ok(())
}

// A one-shot Host rebind witness is consumed by the App's first connect and
// expires at its bind deadline; while the cached Desktop control stays healthy
// nothing re-issues it, so a same-Host App open after that window would fail
// closed forever. The supervisor health poll reaches this listing on every
// cycle, so renewing here keeps a live one-shot witness for each still-running
// supervised Host. Every renewal re-verifies the exact live process, and the
// Runtime's one-shot Consume check is unchanged.
#[cfg(feature = "macos-source-local-development")]
async fn renew_supervised_development_rebinds(
    channel: Channel,
    registry: SupervisedDevelopmentRegistry,
) -> Result<(), NimiHostError> {
    rebind_supervised_development_processes(channel, registry)
        .await
        .map_err(|error| {
            NimiHostError::new(
                host_reason_from_protected(error.reason_code()),
                error.retryable(),
            )
        })
}

#[cfg(feature = "macos-source-local-development")]
fn host_reason_from_protected(reason: ProtectedCarrierReasonCode) -> NimiHostErrorReasonCode {
    match reason {
        ProtectedCarrierReasonCode::ProtectedCarrierRequired => {
            NimiHostErrorReasonCode::ProtectedCarrierRequired
        }
        ProtectedCarrierReasonCode::RuntimeServiceUnavailable => {
            NimiHostErrorReasonCode::RuntimeServiceUnavailable
        }
        ProtectedCarrierReasonCode::RuntimeServiceUntrusted => {
            NimiHostErrorReasonCode::RuntimeServiceUntrusted
        }
        ProtectedCarrierReasonCode::RuntimeServiceRepairRequired => {
            NimiHostErrorReasonCode::RuntimeServiceRepairRequired
        }
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
            #[cfg(not(feature = "macos-source-local-development"))]
            {
                tokio::task::spawn_blocking(
                    crate::macos_data_root::prepare_fixed_runtime_product_control_root,
                )
                .await
                .map_err(|_| repair_required())?
                .map_err(|_| repair_required())?;
            }
            let channel = open_verified_runtime_channel().await?;
            let development_processes = development_process_registry();
            #[cfg(feature = "macos-source-local-development")]
            {
                rebind_supervised_development_processes(
                    channel.clone(),
                    development_processes.clone(),
                )
                .await?;
                verify_source_local_development_runtime_readiness(channel.clone()).await?;
            }
            Ok(Box::new(MacOSDesktopControl {
                channel,
                development_processes,
            }) as Box<dyn NimiDesktopControl>)
        })
    }
}

// A restarted source Runtime can accept its owner-only socket just before all
// protected services finish their ready transition. Keep the one-shot Host
// rebind only on a channel that also completes an ordinary bounded,
// account-independent Runtime roundtrip. Account presence is session-binding
// input, not evidence that the carrier itself is trusted or ready.
#[cfg(feature = "macos-source-local-development")]
async fn verify_source_local_development_runtime_readiness(
    channel: Channel,
) -> Result<(), ProtectedCarrierError> {
    source_local_development_readiness_result(
        crate::windows_local_development::get_developer_mode_status(channel).await,
    )
}

#[cfg(feature = "macos-source-local-development")]
fn source_local_development_readiness_result<T>(
    result: Result<T, NimiHostError>,
) -> Result<(), ProtectedCarrierError> {
    result.map(|_| ()).map_err(|error| {
        if error.retryable() {
            unavailable()
        } else {
            untrusted()
        }
    })
}

impl FixedRuntimeServiceControl for MacOsUnixSocketCarrier {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
        #[cfg(feature = "macos-source-local-development")]
        {
            let state = if runtime_socket_is_absent()? {
                RuntimeServiceState::Stopped
            } else {
                RuntimeServiceState::Running
            };
            return Ok(service_status(state, None, true));
        }
        #[cfg(not(feature = "macos-source-local-development"))]
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
        #[cfg(feature = "macos-source-local-development")]
        {
            return Err(unavailable());
        }
        #[cfg(not(feature = "macos-source-local-development"))]
        let before = macos_service_status()?;
        #[cfg(not(feature = "macos-source-local-development"))]
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
        #[cfg(not(feature = "macos-source-local-development"))]
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
    match std::fs::symlink_metadata(runtime_socket_path()?) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(_) => Err(repair_required()),
    }
}

async fn open_verified_runtime_channel() -> Result<Channel, ProtectedCarrierError> {
    #[cfg(not(feature = "macos-source-local-development"))]
    if macos_service_status()? != SERVICE_ENABLED {
        return Err(unavailable());
    }
    let socket_path = runtime_socket_path()?;
    let socket_text = socket_path.to_str().ok_or_else(untrusted)?;
    let stream = UnixStream::connect(&socket_path)
        .await
        .map_err(|_| unavailable())?;
    verify_runtime_peer_once(stream.as_raw_fd(), socket_text)?;
    channel_from_verified_socket(stream, untrusted).await
}

pub(crate) async fn open_verified_local_app_runtime_channel(
) -> Result<Channel, ProtectedCarrierError> {
    let socket_path = local_app_runtime_socket_path()?;
    let socket_text = socket_path.to_str().ok_or_else(untrusted)?;
    let stream = UnixStream::connect(&socket_path)
        .await
        .map_err(|_| unavailable())?;
    verify_runtime_peer_once(stream.as_raw_fd(), socket_text)?;
    // The socket peer is already verified above; a failed handshake here means
    // the Runtime accepted and closed the socket because it holds no live
    // one-shot launch grant for this Host (not yet re-issued, consumed, or
    // expired). The supervisor renews the grant, so this is a transient
    // unavailable, never a trust verdict.
    channel_from_verified_socket(stream, unavailable).await
}

async fn channel_from_verified_socket(
    stream: UnixStream,
    connect_failure: fn() -> ProtectedCarrierError,
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
        .map_err(|_| connect_failure())
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

#[cfg(all(test, feature = "macos-source-local-development"))]
mod source_local_development_readiness_tests {
    use super::*;

    #[test]
    fn anonymous_ready_runtime_passes_account_independent_readiness() {
        let status = DeveloperModeStatus {
            state: crate::DeveloperModeState::Disabled,
            revision: 1,
        };
        assert!(source_local_development_readiness_result(Ok(status)).is_ok());
    }

    #[test]
    fn unreachable_runtime_still_fails_closed() {
        let error = source_local_development_readiness_result::<DeveloperModeStatus>(Err(
            NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUnavailable, true),
        ))
        .expect_err("unreachable Runtime must fail closed");
        assert_eq!(
            error.reason_code(),
            ProtectedCarrierReasonCode::RuntimeServiceUnavailable
        );
        assert!(error.retryable());
    }

    #[test]
    fn renewal_error_mapping_preserves_reason_and_retry_typing() {
        for (protected, host) in [
            (
                ProtectedCarrierReasonCode::ProtectedCarrierRequired,
                NimiHostErrorReasonCode::ProtectedCarrierRequired,
            ),
            (
                ProtectedCarrierReasonCode::RuntimeServiceUnavailable,
                NimiHostErrorReasonCode::RuntimeServiceUnavailable,
            ),
            (
                ProtectedCarrierReasonCode::RuntimeServiceUntrusted,
                NimiHostErrorReasonCode::RuntimeServiceUntrusted,
            ),
            (
                ProtectedCarrierReasonCode::RuntimeServiceRepairRequired,
                NimiHostErrorReasonCode::RuntimeServiceRepairRequired,
            ),
        ] {
            assert_eq!(host_reason_from_protected(protected), host, "{protected:?}");
        }
    }

    // The Runtime accept loop consumes the one-shot launch grant and closes the
    // socket when no live grant exists. On the App channel that state is
    // transient: the supervisor renews the grant, so the failure must stay
    // retryable unavailable.
    #[tokio::test]
    async fn local_app_accept_rejection_is_transient_unavailable() {
        let path = std::path::PathBuf::from("/tmp").join(format!(
            "nplt-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let listener = tokio::net::UnixListener::bind(&path).expect("bind test socket");
        let accepted = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            drop(stream);
        });
        let stream = std::os::unix::net::UnixStream::connect(&path).expect("connect test socket");
        // A peer close that lands before the handshake preface fails the write;
        // the channel open must surface the caller-selected transient verdict.
        stream
            .shutdown(std::net::Shutdown::Write)
            .expect("shutdown test stream");
        stream.set_nonblocking(true).expect("nonblocking test stream");
        let stream = UnixStream::from_std(stream).expect("tokio test stream");
        let error = channel_from_verified_socket(stream, unavailable)
            .await
            .expect_err("failed handshake must fail");
        assert_eq!(
            error.reason_code(),
            ProtectedCarrierReasonCode::RuntimeServiceUnavailable
        );
        assert!(error.retryable());
        accepted.await.expect("accept task");
        let _ = std::fs::remove_file(&path);
    }

    // The Desktop control channel keeps its fail-closed verdict: a failed
    // handshake there is not a missing-grant state.
    #[tokio::test]
    async fn desktop_accept_rejection_stays_fail_closed_untrusted() {
        let path = std::path::PathBuf::from("/tmp").join(format!(
            "nplt-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let listener = tokio::net::UnixListener::bind(&path).expect("bind test socket");
        let accepted = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            drop(stream);
        });
        let stream = std::os::unix::net::UnixStream::connect(&path).expect("connect test socket");
        stream
            .shutdown(std::net::Shutdown::Write)
            .expect("shutdown test stream");
        stream.set_nonblocking(true).expect("nonblocking test stream");
        let stream = UnixStream::from_std(stream).expect("tokio test stream");
        let error = channel_from_verified_socket(stream, untrusted)
            .await
            .expect_err("failed handshake must fail");
        assert_eq!(
            error.reason_code(),
            ProtectedCarrierReasonCode::RuntimeServiceUntrusted
        );
        assert!(!error.retryable());
        accepted.await.expect("accept task");
        let _ = std::fs::remove_file(&path);
    }
}
