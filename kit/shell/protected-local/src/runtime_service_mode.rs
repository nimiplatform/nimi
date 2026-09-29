use tonic::transport::Channel;
use tonic::Code;

use crate::generated::{
    GetRuntimeServiceStateRequest, ReasonCode, RuntimeServiceMode as WireRuntimeServiceMode,
};
use crate::{ProtectedCarrierError, ProtectedCarrierReasonCode, RuntimeServiceMode};

// @nimi-authority: rule.nimi.runtime.protected-session.r034
/// Reads the typed service mode on a freshly verified channel, before any
/// development rebind or readiness roundtrip. A lost connection is a retryable
/// unavailable result; an unknown mode or reason fails closed as untrusted.
pub(crate) async fn read_runtime_service_mode(
    channel: Channel,
) -> Result<RuntimeServiceMode, ProtectedCarrierError> {
    let response = crate::grpc_limits::runtime_service_control_client(channel)
        .get_runtime_service_state(GetRuntimeServiceStateRequest {})
        .await
        .map_err(|status| match status.code() {
            Code::Unavailable | Code::Cancelled | Code::DeadlineExceeded | Code::Unknown => {
                ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUnavailable, true)
            }
            _ => ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false),
        })?
        .into_inner();
    runtime_service_mode_from_wire(response.mode, response.reason_code)
}

pub(crate) fn runtime_service_mode_from_wire(
    mode: i32,
    reason_code: i32,
) -> Result<RuntimeServiceMode, ProtectedCarrierError> {
    match WireRuntimeServiceMode::try_from(mode) {
        Ok(WireRuntimeServiceMode::Ordinary) => Ok(RuntimeServiceMode::Ordinary),
        Ok(WireRuntimeServiceMode::Maintenance)
            if reason_code == ReasonCode::RuntimeStoredDataUnsupported as i32 =>
        {
            Ok(RuntimeServiceMode::MaintenanceStoredDataUnsupported)
        }
        _ => Err(ProtectedCarrierError::new(
            ProtectedCarrierReasonCode::RuntimeServiceUntrusted,
            false,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_modes_and_reasons_are_accepted() {
        assert_eq!(
            runtime_service_mode_from_wire(WireRuntimeServiceMode::Ordinary as i32, 0),
            Ok(RuntimeServiceMode::Ordinary)
        );
        assert_eq!(
            runtime_service_mode_from_wire(
                WireRuntimeServiceMode::Maintenance as i32,
                ReasonCode::RuntimeStoredDataUnsupported as i32
            ),
            Ok(RuntimeServiceMode::MaintenanceStoredDataUnsupported)
        );
        for (mode, reason) in [
            (WireRuntimeServiceMode::Unspecified as i32, 0),
            (WireRuntimeServiceMode::Maintenance as i32, 0),
            (
                WireRuntimeServiceMode::Maintenance as i32,
                ReasonCode::ActionExecuted as i32,
            ),
            (42, 0),
        ] {
            let error = runtime_service_mode_from_wire(mode, reason).expect_err("fail closed");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::RuntimeServiceUntrusted
            );
        }
        assert_eq!(
            RuntimeServiceMode::MaintenanceStoredDataUnsupported.maintenance_reason(),
            Some("runtime-stored-data-unsupported")
        );
        assert_eq!(RuntimeServiceMode::Ordinary.maintenance_reason(), None);
    }
}
