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
