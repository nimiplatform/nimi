use crate::{
    FixedRuntimeServiceControl, NimiDesktopControl, NimiProtectedLocalHostCarrier,
    ProtectedCarrierError, ProtectedCarrierReasonCode, RuntimeServiceActionOutcome,
    RuntimeServiceStatus,
};

fn unbound() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::ProtectedCarrierRequired, false)
}

macro_rules! define_unbound_carrier {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default)]
        pub struct $name;

        impl FixedRuntimeServiceControl for $name {
            fn runtime_service_status(
                &self,
            ) -> Result<RuntimeServiceStatus, ProtectedCarrierError> {
                Err(unbound())
            }

            fn request_runtime_service_start(
                &self,
            ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
                Err(unbound())
            }

            fn request_runtime_service_restart(
                &self,
            ) -> Result<RuntimeServiceActionOutcome, ProtectedCarrierError> {
                Err(unbound())
            }
        }

        impl NimiProtectedLocalHostCarrier for $name {
            fn open_desktop_control(
                &self,
            ) -> Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError> {
                Err(unbound())
            }
        }
    };
}

#[cfg(not(target_os = "windows"))]
define_unbound_carrier!(WindowsNamedPipeCarrier);
define_unbound_carrier!(LinuxUnixSocketCarrier);
define_unbound_carrier!(MacOsPrivilegedXpcCarrier);

#[cfg(target_os = "windows")]
pub use crate::windows_service_control::WindowsNamedPipeCarrier;
