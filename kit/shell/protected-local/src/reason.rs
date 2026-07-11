use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProtectedCarrierReasonCode {
    ProtectedCarrierRequired,
    RuntimeServiceUnavailable,
    RuntimeServiceUntrusted,
    RuntimeServiceRepairRequired,
}

impl ProtectedCarrierReasonCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProtectedCarrierRequired => "protected-carrier-required",
            Self::RuntimeServiceUnavailable => "runtime-service-unavailable",
            Self::RuntimeServiceUntrusted => "runtime-service-untrusted",
            Self::RuntimeServiceRepairRequired => "runtime-service-repair-required",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProtectedCarrierError {
    reason_code: ProtectedCarrierReasonCode,
    retryable: bool,
}

impl ProtectedCarrierError {
    pub const fn new(reason_code: ProtectedCarrierReasonCode, retryable: bool) -> Self {
        Self {
            reason_code,
            retryable,
        }
    }

    pub const fn reason_code(self) -> ProtectedCarrierReasonCode {
        self.reason_code
    }

    pub const fn retryable(self) -> bool {
        self.retryable
    }
}

impl Display for ProtectedCarrierError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code.as_str())
    }
}

impl Error for ProtectedCarrierError {}
