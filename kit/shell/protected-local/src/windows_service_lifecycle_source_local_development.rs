use std::future::Future;
use std::pin::Pin;

use crate::{
    FixedRuntimeServiceControl, ProtectedCarrierError, RuntimeServiceActionOutcome,
    RuntimeServiceStatus,
};

use super::{unavailable, WindowsNamedPipeCarrier};

impl FixedRuntimeServiceControl for WindowsNamedPipeCarrier {
    fn runtime_service_status(&self) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
        // A published pipe is not a live, verified Runtime. Source lifecycle
        // status is projected asynchronously through the protected Desktop
        // control roundtrip in the Node/Electron host.
        Err(unavailable())
    }

    fn request_runtime_service_start(
        &self,
    ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
        Err(unavailable())
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
        Box::pin(async { Err(unavailable()) })
    }
}
