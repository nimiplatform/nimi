use std::collections::HashMap;
#[cfg(not(feature = "windows-source-local-development"))]
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
#[cfg(not(feature = "windows-source-local-development"))]
use windows_service::service::{ServiceAccess, ServiceState};
#[cfg(not(feature = "windows-source-local-development"))]
use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::Pipes::GetNamedPipeServerProcessId;

#[cfg(not(feature = "windows-source-local-development"))]
use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
#[cfg(not(feature = "windows-source-local-development"))]
use crate::generated::OpenDesktopSessionRequest;
use crate::windows_peer_trust::{verify_runtime_peer, VerifiedRuntimePeer};
#[cfg(feature = "windows-source-local-development")]
use crate::windows_source_policy::{source_pipe_name, WindowsSourcePipeRole};
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
    LocalDevelopmentEndRunRequest, LocalDevelopmentLaunchOutcome, LocalDevelopmentLaunchRequest,
    LocalDevelopmentRegistration, LocalDevelopmentRegistrationRequest, NimiDesktopControl,
    NimiHostError, NimiHostErrorReasonCode, NimiProtectedLocalHostCarrier, ProtectedCarrierError,
    ProtectedCarrierReasonCode, RuntimeServiceActionOutcome,
};
#[cfg(not(feature = "windows-source-local-development"))]
use crate::{RuntimeServiceState, RuntimeServiceStatus};

#[cfg(not(feature = "windows-source-local-development"))]
#[path = "windows_service_projection.rs"]
mod projection;
#[cfg(not(feature = "windows-source-local-development"))]
use projection::{project_start_outcome, project_status};

#[cfg(not(feature = "windows-source-local-development"))]
const RUNTIME_SERVICE_NAME: &str = "NimiRuntime";
#[cfg(not(feature = "windows-source-local-development"))]
const RUNTIME_PROTECTED_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-protected-v1";
#[cfg(feature = "windows-source-local-development")]
const RUNTIME_PROTECTED_PIPE_NAME: &str = "source-current-user-desktop";
#[cfg(feature = "windows-source-local-development")]
pub(crate) const SOURCE_LOCAL_APP_PIPE_REF: &str = "source-current-user-local-app";

#[cfg(not(feature = "windows-source-local-development"))]
#[path = "windows_service_lifecycle.rs"]
mod lifecycle;
#[cfg(feature = "windows-source-local-development")]
#[path = "windows_service_lifecycle_source_local_development.rs"]
mod lifecycle;
#[cfg(not(feature = "windows-source-local-development"))]
use lifecycle::request_verified_runtime_restart_on_channel;

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsNamedPipeCarrier;

struct SupervisedDevelopmentEntry {
    process: crate::windows_supervised_process::SupervisedDevelopmentProcess,
    #[cfg(feature = "windows-source-local-development")]
    request: LocalDevelopmentLaunchRequest,
}

type SupervisedDevelopmentRegistry = Arc<Mutex<HashMap<[u8; 32], SupervisedDevelopmentEntry>>>;

struct WindowsDesktopControl {
    session: Arc<VerifiedDesktopRuntimeSession>,
    development_processes: SupervisedDevelopmentRegistry,
}

struct VerifiedDesktopRuntimeSession {
    channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    #[cfg(not(feature = "windows-source-local-development"))]
    _desktop_session_id: [u8; 32],
    #[cfg(not(feature = "windows-source-local-development"))]
    runtime_boot_epoch: [u8; 32],
}

static DESKTOP_RUNTIME_SESSION: OnceLock<AsyncMutex<Option<Arc<VerifiedDesktopRuntimeSession>>>> =
    OnceLock::new();

fn desktop_runtime_session_cache() -> &'static AsyncMutex<Option<Arc<VerifiedDesktopRuntimeSession>>>
{
    DESKTOP_RUNTIME_SESSION.get_or_init(|| AsyncMutex::new(None))
}

async fn invalidate_exact_desktop_runtime_session(failed: &Arc<VerifiedDesktopRuntimeSession>) {
    let mut slot = desktop_runtime_session_cache().lock().await;
    if take_matching_cached_session(&mut slot, failed).is_some() {
        diagnose_desktop_session("exact-session-invalidated");
    }
}

fn take_matching_cached_session<T>(slot: &mut Option<Arc<T>>, failed: &Arc<T>) -> Option<Arc<T>> {
    if slot
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, failed))
    {
        slot.take()
    } else {
        None
    }
}

#[cfg(all(test, feature = "windows-source-local-development"))]
mod source_runtime_session_cache_tests {
    use super::{take_matching_cached_session, validate_before_caching_source_session};
    use std::sync::Arc;
    use tokio::sync::{Mutex, Notify};

    #[test]
    fn failed_session_eviction_is_scoped_to_the_exact_cached_session() {
        let failed = Arc::new("failed");
        let mut slot = Some(failed.clone());

        let removed = take_matching_cached_session(&mut slot, &failed)
            .expect("the failed cached session must be removed");
        assert!(Arc::ptr_eq(&removed, &failed));
        assert!(slot.is_none());

        let replacement = Arc::new("replacement");
        slot = Some(replacement.clone());
        assert!(take_matching_cached_session(&mut slot, &failed).is_none());
        assert!(slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &replacement)));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn canceled_source_validation_leaves_no_cached_session() {
        let cached = Arc::new("cached");
        let slot = Arc::new(Mutex::new(Some(cached)));
        let started = Arc::new(Notify::new());
        let task = tokio::spawn({
            let slot = slot.clone();
            let started = started.clone();
            async move {
                validate_before_caching_source_session(&slot, |_session| async move {
                    started.notify_one();
                    std::future::pending::<Result<Arc<&'static str>, ()>>().await
                })
                .await
            }
        });
        started.notified().await;

        task.abort();
        let _ = task.await;
        assert!(slot.lock().await.is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn successful_source_validation_commits_only_the_validated_session() {
        let previous = Arc::new("previous");
        let replacement = Arc::new("replacement");
        let slot = Mutex::new(Some(previous.clone()));

        let validated = validate_before_caching_source_session(&slot, {
            let replacement = replacement.clone();
            move |cached| async move {
                assert!(cached
                    .as_ref()
                    .is_some_and(|session| Arc::ptr_eq(session, &previous)));
                Ok::<_, ()>(replacement)
            }
        })
        .await
        .expect("validation must succeed");

        assert!(Arc::ptr_eq(&validated, &replacement));
        assert!(slot
            .lock()
            .await
            .as_ref()
            .is_some_and(|session| Arc::ptr_eq(session, &replacement)));
    }
}

#[cfg(feature = "windows-source-local-development")]
async fn validate_before_caching_source_session<T, E, F, Fut>(
    slot: &AsyncMutex<Option<Arc<T>>>,
    validate: F,
) -> Result<Arc<T>, E>
where
    T: Send + Sync,
    F: FnOnce(Option<Arc<T>>) -> Fut,
    Fut: Future<Output = Result<Arc<T>, E>>,
{
    // Move the candidate out before validation. If the caller times out and
    // cancels this future, both the candidate and lock guard are dropped while
    // the cache remains empty, so a one-shot connector cannot be retained in a
    // half-validated state.
    let mut slot = slot.lock().await;
    let candidate = slot.take();
    let validated = validate(candidate).await?;
    *slot = Some(validated.clone());
    Ok(validated)
}

fn development_process_registry() -> SupervisedDevelopmentRegistry {
    #[cfg(feature = "windows-source-local-development")]
    {
        static REGISTRY: OnceLock<SupervisedDevelopmentRegistry> = OnceLock::new();
        return REGISTRY
            .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
            .clone();
    }
    #[cfg(not(feature = "windows-source-local-development"))]
    Arc::new(Mutex::new(HashMap::new()))
}

impl WindowsDesktopControl {
    fn channel(&self) -> Channel {
        self.session.channel.clone()
    }
}

impl NimiDesktopControl for WindowsDesktopControl {
    fn invalidate_cached_transport(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(invalidate_exact_desktop_runtime_session(&self.session))
    }

    fn invoke_bundled_avatar(
        &self,
        request: BundledAvatarRuntimeRequest,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<BundledAvatarRuntimeResponse, BundledAvatarRuntimeError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(crate::bundled_avatar::invoke(self.channel(), request))
    }

    fn open_bundled_avatar_stream(
        &self,
        request: BundledAvatarRuntimeRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<BundledAvatarRuntimeStreamReceiver, BundledAvatarRuntimeError>,
                > + Send
                + '_,
        >,
    > {
        Box::pin(crate::bundled_avatar::open_stream(self.channel(), request))
    }

    fn invoke_machine_product_unary(
        &self,
        request: DesktopMachineProductUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductUnaryResponse,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(crate::first_party_product::invoke_machine_unary(
            self.channel(),
            request,
        ))
    }

    fn open_machine_product_stream(
        &self,
        request: DesktopMachineProductStreamRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductStreamReceiver,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(crate::first_party_product::open_machine_stream(
            self.channel(),
            request,
        ))
    }

    fn invoke_account_product_unary(
        &self,
        request: DesktopAccountProductUnaryRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductUnaryResponse,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(crate::first_party_product::invoke_account_unary(
            self.channel(),
            request,
        ))
    }

    fn open_account_product_stream(
        &self,
        request: DesktopAccountProductStreamRequest,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        DesktopFirstPartyProductStreamReceiver,
                        DesktopFirstPartyProductError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(crate::first_party_product::open_account_stream(
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
        #[cfg(not(feature = "windows-source-local-development"))]
        {
            Box::pin(request_verified_runtime_restart_on_channel(
                self.channel(),
                self.session.runtime_boot_epoch,
            ))
        }
        #[cfg(feature = "windows-source-local-development")]
        {
            Box::pin(async { Err(unavailable()) })
        }
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
        #[cfg(feature = "windows-source-local-development")]
        if !self.session._runtime_peer.running() {
            return Box::pin(async { Err(NimiHostError::from(unavailable())) });
        }
        Box::pin(crate::windows_local_development::get_developer_mode_status(
            self.channel(),
        ))
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

    fn register_local_development_project(
        &self,
        request: LocalDevelopmentRegistrationRequest,
    ) -> Pin<
        Box<dyn Future<Output = Result<LocalDevelopmentRegistration, NimiHostError>> + Send + '_>,
    > {
        Box::pin(crate::windows_local_development::register_project(
            self.channel(),
            request,
        ))
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
            let channel = self.channel();
            #[cfg(feature = "windows-source-local-development")]
            renew_supervised_development_rebinds(
                channel.clone(),
                self.development_processes.clone(),
            )
            .await?;
            crate::windows_local_development::list_registrations(channel).await
        })
    }

    fn remove_local_development_registration(
        &self,
        registration_handle: [u8; 32],
    ) -> Pin<Box<dyn Future<Output = Result<(), NimiHostError>> + Send + '_>> {
        Box::pin(crate::windows_local_development::remove_registration(
            self.channel(),
            registration_handle,
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
            #[cfg(feature = "windows-source-local-development")]
            let retained_request = request.clone();
            let (outcome, process) =
                crate::windows_local_development::launch_host(self.channel(), request).await?;
            let mut processes = self.development_processes.lock().map_err(|_| {
                NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
            })?;
            if let Some(replaced) = processes.insert(
                run_id,
                SupervisedDevelopmentEntry {
                    process,
                    #[cfg(feature = "windows-source-local-development")]
                    request: retained_request,
                },
            ) {
                drop(replaced);
                return Err(NimiHostError::new(
                    NimiHostErrorReasonCode::RuntimeServiceUntrusted,
                    false,
                ));
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
        let running = processes
            .get(&supervisor_run_id)
            .is_some_and(|entry| entry.process.running());
        Ok(running)
    }

    fn terminate_local_development_host(
        &self,
        supervisor_run_id: [u8; 32],
    ) -> Result<(), NimiHostError> {
        terminate_development_host(&self.development_processes, supervisor_run_id)
    }
}

fn terminate_development_host(
    registry: &SupervisedDevelopmentRegistry,
    supervisor_run_id: [u8; 32],
) -> Result<(), NimiHostError> {
    if supervisor_run_id == [0u8; 32] {
        return Err(NimiHostError::new(
            NimiHostErrorReasonCode::RuntimeServiceUntrusted,
            false,
        ));
    }
    let mut processes = registry
        .lock()
        .map_err(|_| NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false))?;
    if let Some(entry) = processes.get_mut(&supervisor_run_id) {
        entry.process.terminate()?;
    }
    processes.remove(&supervisor_run_id);
    Ok(())
}

#[cfg(feature = "windows-source-local-development")]
pub fn terminate_source_local_development_host(
    supervisor_run_id: [u8; 32],
) -> Result<(), NimiHostError> {
    terminate_development_host(&development_process_registry(), supervisor_run_id)
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
    #[cfg(not(feature = "windows-source-local-development"))]
    {
        tokio::task::spawn_blocking(
            crate::windows_data_root::prepare_fixed_runtime_product_control_root,
        )
        .await
        .map_err(|_| repair_required())?
        .map_err(|_| repair_required())?;
    }
    let session = shared_verified_desktop_runtime_session().await?;
    let development_processes = development_process_registry();
    Ok(Box::new(WindowsDesktopControl {
        session,
        development_processes,
    }))
}

#[cfg(feature = "windows-source-local-development")]
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

#[cfg(feature = "windows-source-local-development")]
async fn verify_source_local_development_runtime_readiness(
    channel: Channel,
) -> Result<(), ProtectedCarrierError> {
    crate::windows_local_development::get_developer_mode_status(channel)
        .await
        .map(|_| ())
        .map_err(|error| {
            if error.retryable() {
                unavailable()
            } else {
                untrusted()
            }
        })
}

// Mirrors the macOS carrier: the supervisor health poll reaches this listing
// on every cycle, so renewing here keeps a live one-shot rebind witness for
// each still-running supervised Host after Runtime loss. Every renewal
// re-verifies the exact live process; the one-shot Consume check is unchanged.
#[cfg(feature = "windows-source-local-development")]
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

#[cfg(feature = "windows-source-local-development")]
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

pub(crate) async fn open_verified_runtime_channel(
    pipe_name: &'static str,
) -> Result<(Channel, VerifiedRuntimePeer), ProtectedCarrierError> {
    #[cfg(not(feature = "windows-source-local-development"))]
    let resolved_pipe_name = pipe_name.to_string();
    #[cfg(feature = "windows-source-local-development")]
    let resolved_pipe_name = {
        let role = match pipe_name {
            RUNTIME_PROTECTED_PIPE_NAME => WindowsSourcePipeRole::Desktop,
            SOURCE_LOCAL_APP_PIPE_REF => WindowsSourcePipeRole::LocalApp,
            _ => return Err(untrusted()),
        };
        let user_sid = crate::windows_peer_trust::current_user_sid()?;
        source_pipe_name(&user_sid, role).map_err(|_| untrusted())?
    };

    #[cfg(not(feature = "windows-source-local-development"))]
    let expected_pid = {
        let before = query_service_status()?;
        let pid = running_service_pid(&before)?;
        diagnose_desktop_session("service-running");
        pid
    };
    #[cfg(not(feature = "windows-source-local-development"))]
    let pipe = ClientOptions::new()
        .open(&resolved_pipe_name)
        .map_err(|_| unavailable())?;
    #[cfg(feature = "windows-source-local-development")]
    let pipe = open_source_runtime_pipe(&resolved_pipe_name).await?;
    diagnose_desktop_session("pipe-opened");
    let pipe_server_pid = named_pipe_server_pid_from_handle(pipe.as_raw_handle() as HANDLE)?;
    #[cfg(not(feature = "windows-source-local-development"))]
    {
        let after = query_service_status()?;
        let observed_pid = running_service_pid(&after)?;
        validate_stable_server_binding(expected_pid, observed_pid, pipe_server_pid)?;
        diagnose_desktop_session("pipe-service-binding-verified");
    }
    let runtime_peer = verify_runtime_peer(pipe_server_pid)?;
    diagnose_desktop_session("runtime-peer-verified");
    let channel = channel_from_verified_pipe(pipe).await.map_err(|_| {
        diagnose_desktop_session("grpc-channel-open-failed");
        unavailable()
    })?;
    diagnose_desktop_session("grpc-channel-opened");
    Ok((channel, runtime_peer))
}

#[cfg(feature = "windows-source-local-development")]
async fn open_source_runtime_pipe(name: &str) -> Result<NamedPipeClient, ProtectedCarrierError> {
    ClientOptions::new().open(name).map_err(|_| unavailable())
}

async fn shared_verified_desktop_runtime_session(
) -> Result<Arc<VerifiedDesktopRuntimeSession>, ProtectedCarrierError> {
    #[cfg(feature = "windows-source-local-development")]
    {
        return validate_before_caching_source_session(
            desktop_runtime_session_cache(),
            |cached| async move {
                let session = match cached {
                    Some(session) if session._runtime_peer.running() => session,
                    Some(_) => {
                        diagnose_desktop_session("cached-runtime-peer-exited");
                        open_source_desktop_runtime_session().await?
                    }
                    None => open_source_desktop_runtime_session().await?,
                };
                let development_processes = development_process_registry();
                rebind_supervised_development_processes(
                    session.channel.clone(),
                    development_processes,
                )
                .await?;
                verify_source_local_development_runtime_readiness(session.channel.clone()).await?;
                diagnose_desktop_session("source-session-validated");
                Ok(session)
            },
        )
        .await;
    }
    #[cfg(not(feature = "windows-source-local-development"))]
    {
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
}

#[cfg(feature = "windows-source-local-development")]
async fn open_source_desktop_runtime_session(
) -> Result<Arc<VerifiedDesktopRuntimeSession>, ProtectedCarrierError> {
    let (channel, runtime_peer) =
        open_verified_runtime_channel(RUNTIME_PROTECTED_PIPE_NAME).await?;
    diagnose_desktop_session("opened-direct");
    Ok(Arc::new(VerifiedDesktopRuntimeSession {
        channel,
        _runtime_peer: runtime_peer,
    }))
}

fn diagnose_desktop_session(stage: &str) {
    if std::env::var_os("NIMI_PROTECTED_LOCAL_DIAGNOSTICS").as_deref()
        == Some(std::ffi::OsStr::new("1"))
    {
        eprintln!("[protected-local desktop-session] stage={stage}");
    }
}

/// Returns a clone of the verified Desktop control channel shared by status,
/// control, unary, and streaming calls. Service-backed Windows opens one
/// boot-scoped Desktop session; source-local Windows retains the exact direct
/// Runtime peer instead. No portable authority or caller-selected endpoint
/// crosses this boundary.
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

#[cfg(not(feature = "windows-source-local-development"))]
fn service_manager() -> Result<ServiceManager, ProtectedCarrierError> {
    ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)
        .map_err(|_| unavailable())
}

#[cfg(not(feature = "windows-source-local-development"))]
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

#[cfg(not(feature = "windows-source-local-development"))]
fn repair_required() -> ProtectedCarrierError {
    ProtectedCarrierError::new(
        ProtectedCarrierReasonCode::RuntimeServiceRepairRequired,
        false,
    )
}

#[cfg(not(feature = "windows-source-local-development"))]
fn verify_fixed_pipe_scm_binding() -> Result<(), ProtectedCarrierError> {
    let before = query_service_status()?;
    let expected_pid = running_service_pid(&before)?;
    let pipe = open_fixed_runtime_pipe()?;
    let pipe_server_pid = named_pipe_server_pid(&pipe)?;
    let after = query_service_status()?;
    let observed_pid = running_service_pid(&after)?;
    validate_stable_server_binding(expected_pid, observed_pid, pipe_server_pid)?;
    verify_runtime_peer(pipe_server_pid).map(|_| ())
}

#[cfg(not(feature = "windows-source-local-development"))]
fn query_service_status() -> Result<windows_service::service::ServiceStatus, ProtectedCarrierError>
{
    let manager = service_manager()?;
    let service = manager
        .open_service(RUNTIME_SERVICE_NAME, ServiceAccess::QUERY_STATUS)
        .map_err(|_| unavailable())?;
    service.query_status().map_err(|_| unavailable())
}

#[cfg(not(feature = "windows-source-local-development"))]
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

#[cfg(not(feature = "windows-source-local-development"))]
fn open_fixed_runtime_pipe() -> Result<File, ProtectedCarrierError> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .open(RUNTIME_PROTECTED_PIPE_NAME)
        .map_err(|_| unavailable())
}

#[cfg(not(feature = "windows-source-local-development"))]
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

#[cfg(not(feature = "windows-source-local-development"))]
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
