#[cfg(target_os = "linux")]
use nimi_shell_protected_local::LinuxInstalledAppCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsInstalledAppCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsInstalledAppCarrier;
use nimi_shell_protected_local::{
    InstalledArtifactBytes, InstalledArtifactReadError, NimiInstalledAppCarrier,
    NimiInstalledAppSession, ProtectedCarrierError,
};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::Arc;
use tokio::sync::OnceCell;

pub struct RuntimeBridgeInstalledHost {
    carrier: Arc<dyn NimiInstalledAppCarrier>,
    session: OnceCell<Arc<dyn NimiInstalledAppSession>>,
}

impl RuntimeBridgeInstalledHost {
    fn new(carrier: Arc<dyn NimiInstalledAppCarrier>) -> Self {
        Self {
            carrier,
            session: OnceCell::new(),
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    pub fn platform_default() -> Self {
        #[cfg(target_os = "windows")]
        let carrier: Arc<dyn NimiInstalledAppCarrier> = Arc::new(WindowsInstalledAppCarrier);
        #[cfg(target_os = "macos")]
        let carrier: Arc<dyn NimiInstalledAppCarrier> = Arc::new(MacOsInstalledAppCarrier);
        #[cfg(target_os = "linux")]
        let carrier: Arc<dyn NimiInstalledAppCarrier> = Arc::new(LinuxInstalledAppCarrier);
        Self::new(carrier)
    }

    pub async fn read_artifact_bytes(
        &self,
        artifact_id: String,
    ) -> Result<InstalledArtifactBytes, RuntimeBridgeInstalledHostError> {
        let session = self
            .session
            .get_or_try_init(|| async {
                let opened = self.carrier.open_installed_app_session().await?;
                Ok::<Arc<dyn NimiInstalledAppSession>, ProtectedCarrierError>(Arc::from(opened))
            })
            .await
            .map_err(RuntimeBridgeInstalledHostError::Carrier)?;
        session
            .read_artifact_bytes(artifact_id)
            .await
            .map_err(RuntimeBridgeInstalledHostError::Artifact)
    }
}

impl Default for RuntimeBridgeInstalledHost {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    fn default() -> Self {
        Self::platform_default()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    fn default() -> Self {
        compile_error!("Nimi installed host requires an admitted platform adapter");
    }
}

#[derive(Debug)]
pub enum RuntimeBridgeInstalledHostError {
    Carrier(ProtectedCarrierError),
    Artifact(InstalledArtifactReadError),
}

impl RuntimeBridgeInstalledHostError {
    pub fn reason_code(&self) -> &'static str {
        match self {
            Self::Carrier(error) => error.reason_code().as_str(),
            Self::Artifact(error) => error.reason_code().as_str(),
        }
    }

    pub fn retryable(&self) -> bool {
        match self {
            Self::Carrier(error) => error.retryable(),
            Self::Artifact(error) => error.retryable(),
        }
    }
}

impl Display for RuntimeBridgeInstalledHostError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code())
    }
}

impl Error for RuntimeBridgeInstalledHostError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Carrier(error) => Some(error),
            Self::Artifact(error) => Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nimi_shell_protected_local::{
        InstalledArtifactBytes, InstalledArtifactReadError, InstalledArtifactReadReasonCode,
        NimiInstalledAppCarrier, NimiInstalledAppSession, ProtectedCarrierError,
        ProtectedCarrierReasonCode,
    };
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex};

    struct TestInstalledSession {
        reads: Arc<Mutex<Vec<String>>>,
    }

    impl NimiInstalledAppSession for TestInstalledSession {
        fn read_artifact_bytes(
            &self,
            artifact_id: String,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<InstalledArtifactBytes, InstalledArtifactReadError>>
                    + Send
                    + '_,
            >,
        > {
            let reads = self.reads.clone();
            Box::pin(async move {
                reads.lock().expect("reads").push(artifact_id.clone());
                Ok(InstalledArtifactBytes {
                    bytes: artifact_id.as_bytes().to_vec(),
                    mime_type: "text/plain".to_string(),
                    size_bytes: artifact_id.len() as i64,
                    mime_inferred: false,
                })
            })
        }
    }

    struct TestInstalledCarrier {
        opens: Arc<Mutex<u32>>,
        reads: Arc<Mutex<Vec<String>>>,
        denied: bool,
    }

    impl NimiInstalledAppCarrier for TestInstalledCarrier {
        fn open_installed_app_session(
            &self,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<Box<dyn NimiInstalledAppSession>, ProtectedCarrierError>>
                    + Send
                    + '_,
            >,
        > {
            let opens = self.opens.clone();
            let reads = self.reads.clone();
            let denied = self.denied;
            Box::pin(async move {
                *opens.lock().expect("opens") += 1;
                if denied {
                    return Err(ProtectedCarrierError::new(
                        ProtectedCarrierReasonCode::ProtectedCarrierRequired,
                        false,
                    ));
                }
                Ok(Box::new(TestInstalledSession { reads }) as Box<dyn NimiInstalledAppSession>)
            })
        }
    }

    #[tokio::test]
    async fn host_reuses_one_opaque_session_and_forwards_only_artifact_ids() {
        let opens = Arc::new(Mutex::new(0));
        let reads = Arc::new(Mutex::new(Vec::new()));
        let host = RuntimeBridgeInstalledHost::new(Arc::new(TestInstalledCarrier {
            opens: opens.clone(),
            reads: reads.clone(),
            denied: false,
        }));

        let (first, second) = tokio::join!(
            host.read_artifact_bytes("artifact-one".to_string()),
            host.read_artifact_bytes("artifact-two".to_string()),
        );
        let first = first.expect("first read");
        let second = second.expect("second read");
        assert_eq!(first.bytes, b"artifact-one");
        assert_eq!(second.bytes, b"artifact-two");
        assert_eq!(*opens.lock().expect("opens"), 1);
        assert_eq!(
            *reads.lock().expect("reads"),
            vec!["artifact-one".to_string(), "artifact-two".to_string()]
        );
    }

    #[tokio::test]
    async fn host_preserves_carrier_denial_without_caching_pseudo_session() {
        let opens = Arc::new(Mutex::new(0));
        let host = RuntimeBridgeInstalledHost::new(Arc::new(TestInstalledCarrier {
            opens: opens.clone(),
            reads: Arc::new(Mutex::new(Vec::new())),
            denied: true,
        }));

        for _ in 0..2 {
            let error = host
                .read_artifact_bytes("artifact-denied".to_string())
                .await
                .expect_err("carrier denial");
            assert_eq!(
                error.reason_code(),
                ProtectedCarrierReasonCode::ProtectedCarrierRequired.as_str()
            );
            assert!(!error.retryable());
        }
        assert_eq!(*opens.lock().expect("opens"), 2);
    }

    #[test]
    fn host_error_preserves_artifact_reason_without_secret_detail() {
        let error = RuntimeBridgeInstalledHostError::Artifact(InstalledArtifactReadError::new(
            InstalledArtifactReadReasonCode::Forbidden,
            false,
        ));
        assert_eq!(error.reason_code(), "installed-artifact-forbidden");
        assert_eq!(error.to_string(), "installed-artifact-forbidden");
    }
}
