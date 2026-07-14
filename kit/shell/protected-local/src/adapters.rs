use crate::{
    FixedRuntimeServiceControl, LocalAppOperationError, LocalAppReasonCode, NimiDesktopControl,
    NimiLocalAppCarrier, NimiLocalAppSession, NimiProtectedLocalHostCarrier, ProtectedCarrierError,
    ProtectedCarrierReasonCode, RuntimeServiceActionOutcome, RuntimeServiceStatus,
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
            ) -> std::pin::Pin<
                Box<
                    dyn std::future::Future<
                            Output = Result<RuntimeServiceActionOutcome, ProtectedCarrierError>,
                        > + Send
                        + '_,
                >,
            > {
                Box::pin(async { Err(unbound()) })
            }
        }

        impl NimiProtectedLocalHostCarrier for $name {
            fn open_desktop_control(
                &self,
            ) -> std::pin::Pin<
                Box<
                    dyn std::future::Future<
                            Output = Result<Box<dyn NimiDesktopControl>, ProtectedCarrierError>,
                        > + Send
                        + '_,
                >,
            > {
                Box::pin(async { Err(unbound()) })
            }
        }
    };
}

#[cfg(not(target_os = "windows"))]
define_unbound_carrier!(WindowsNamedPipeCarrier);
define_unbound_carrier!(LinuxUnixSocketCarrier);
define_unbound_carrier!(MacOsPrivilegedXpcCarrier);

macro_rules! define_unbound_local_app_carrier {
    ($name:ident) => {
        #[derive(Clone, Copy, Debug, Default)]
        pub struct $name;

        impl NimiLocalAppCarrier for $name {
            fn open_local_app_session(
                &self,
            ) -> std::pin::Pin<
                Box<
                    dyn std::future::Future<
                            Output = Result<Box<dyn NimiLocalAppSession>, LocalAppOperationError>,
                        > + Send
                        + '_,
                >,
            > {
                Box::pin(async {
                    Err(LocalAppOperationError::new(
                        LocalAppReasonCode::ProtectedCarrierRequired,
                        false,
                    ))
                })
            }
        }
    };
}

#[cfg(not(target_os = "windows"))]
define_unbound_local_app_carrier!(WindowsLocalAppCarrier);
define_unbound_local_app_carrier!(LinuxLocalAppCarrier);
define_unbound_local_app_carrier!(MacOsLocalAppCarrier);

#[cfg(target_os = "windows")]
pub use crate::windows_local_app::WindowsLocalAppCarrier;
#[cfg(target_os = "windows")]
pub use crate::windows_service_control::WindowsNamedPipeCarrier;
