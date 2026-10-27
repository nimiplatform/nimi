use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeServiceState {
    Stopped,
    StartPending,
    Running,
    RestartPending,
    Unavailable,
}

impl RuntimeServiceState {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::StartPending => "start_pending",
            Self::Running => "running",
            Self::RestartPending => "restart_pending",
            Self::Unavailable => "unavailable",
        }
    }
}

/// The typed protected surface a verified Runtime channel serves
/// (runtime.protected-session r034). A maintenance Runtime refused ordinary
/// startup and answers only its maintenance operations.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeServiceMode {
    Ordinary,
    MaintenanceStoredDataUnsupported,
}

impl RuntimeServiceMode {
    /// The bounded reason a maintenance Runtime reports; none when ordinary.
    pub const fn maintenance_reason(self) -> Option<&'static str> {
        match self {
            Self::Ordinary => None,
            Self::MaintenanceStoredDataUnsupported => Some("runtime-stored-data-unsupported"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RuntimeServiceAction {
    Start,
    Restart,
}

impl RuntimeServiceAction {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Restart => "restart",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeServiceStatus {
    pub state: RuntimeServiceState,
    pub release_id: Option<String>,
    pub reason_code: Option<ProtectedCarrierReasonCode>,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RuntimeServiceActionOutcome {
    pub state: RuntimeServiceState,
    pub release_id: Option<String>,
    pub reason_code: Option<ProtectedCarrierReasonCode>,
    pub retryable: bool,
}

pub trait FixedRuntimeServiceControl: Send + Sync {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError>;

    fn request_runtime_service_start(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError>;

    fn request_runtime_service_restart(
        &self,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<
                    Output = Result<RuntimeServiceActionOutcome, ProtectedCarrierError>,
                > + Send
                + '_,
        >,
    >;
}

// @nimi-authority: rule.nimi.runtime.protected-session.r006
#[cfg(not(any(
    feature = "macos-source-local-development",
    feature = "windows-source-local-development"
)))]
pub(crate) async fn request_runtime_stop(
    channel: tonic::transport::Channel,
) -> Result<(), ProtectedCarrierError> {
    let mut request = tonic::Request::new(crate::generated::RequestRuntimeStopRequest {});
    request.set_timeout(std::time::Duration::from_secs(10));
    let result = crate::grpc_limits::runtime_service_control_client(channel)
        .request_runtime_stop(request)
        .await;
    match result {
        Ok(response) if response.get_ref().accepted => Ok(()),
        Err(status)
            if matches!(
                status.code(),
                tonic::Code::Unavailable | tonic::Code::Cancelled | tonic::Code::Unknown
            ) =>
        {
            Ok(())
        }
        _ => Err(ProtectedCarrierError::new(
            ProtectedCarrierReasonCode::RuntimeServiceUntrusted,
            false,
        )),
    }
}
