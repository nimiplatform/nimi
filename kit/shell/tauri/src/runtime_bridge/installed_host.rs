#[cfg(target_os = "linux")]
use nimi_shell_protected_local::LinuxAppHostCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsAppHostCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsAppHostCarrier;
use nimi_shell_protected_local::{
    AppHostArtifactBytes, AppHostArtifactReadError, AppHostBootstrapStatus, NimiAppHostCarrier,
    NimiAppHostSession, NimiHostError,
};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::Arc;
use tokio::sync::Mutex;

pub struct RuntimeBridgeAppHost {
    carrier: Arc<dyn NimiAppHostCarrier>,
    session: Mutex<Option<Arc<dyn NimiAppHostSession>>>,
}

impl RuntimeBridgeAppHost {
    fn new(carrier: Arc<dyn NimiAppHostCarrier>) -> Self {
        Self {
            carrier,
            session: Mutex::new(None),
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    pub fn platform_default() -> Self {
        #[cfg(target_os = "windows")]
        let carrier: Arc<dyn NimiAppHostCarrier> = Arc::new(WindowsAppHostCarrier);
        #[cfg(target_os = "macos")]
        let carrier: Arc<dyn NimiAppHostCarrier> = Arc::new(MacOsAppHostCarrier);
        #[cfg(target_os = "linux")]
        let carrier: Arc<dyn NimiAppHostCarrier> = Arc::new(LinuxAppHostCarrier);
        Self::new(carrier)
    }

    pub async fn bootstrap(&self) -> Result<AppHostBootstrapStatus, RuntimeBridgeAppHostError> {
        if let Some(session) = self.session.lock().await.clone() {
            match session.bootstrap_status().await {
                Ok(status) => return Ok(status),
                Err(_) => self.clear_session_if_same(&session).await,
            }
        }
        let opened = self
            .carrier
            .open_app_host_session()
            .await
            .map_err(RuntimeBridgeAppHostError::Carrier)?;
        let session = Arc::<dyn NimiAppHostSession>::from(opened);
        let status = session
            .bootstrap_status()
            .await
            .map_err(RuntimeBridgeAppHostError::Carrier)?;
        *self.session.lock().await = Some(session);
        Ok(status)
    }

    pub async fn read_artifact_bytes(
        &self,
        artifact_id: String,
    ) -> Result<AppHostArtifactBytes, RuntimeBridgeAppHostError> {
        self.bootstrap().await?;
        let session = self.session.lock().await.clone().ok_or_else(|| {
            RuntimeBridgeAppHostError::Carrier(NimiHostError::new(
                nimi_shell_protected_local::NimiHostErrorReasonCode::RuntimeServiceUntrusted,
                false,
            ))
        })?;
        match session.read_artifact_bytes(artifact_id).await {
            Ok(artifact) => Ok(artifact),
            Err(error) => {
                self.clear_session_if_same(&session).await;
                Err(RuntimeBridgeAppHostError::Artifact(error))
            }
        }
    }

    async fn clear_session_if_same(&self, session: &Arc<dyn NimiAppHostSession>) {
        let mut current = self.session.lock().await;
        if current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
        {
            *current = None;
        }
    }
}

impl Default for RuntimeBridgeAppHost {
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    fn default() -> Self {
        Self::platform_default()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    fn default() -> Self {
        compile_error!("Nimi app host requires an admitted platform adapter");
    }
}

#[derive(Debug)]
pub enum RuntimeBridgeAppHostError {
    Carrier(NimiHostError),
    Artifact(AppHostArtifactReadError),
}

impl RuntimeBridgeAppHostError {
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

impl Display for RuntimeBridgeAppHostError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.reason_code())
    }
}

impl Error for RuntimeBridgeAppHostError {
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
        AppHostArtifactReadReasonCode, AppHostBootstrapState, AppHostTrustClass,
        NimiHostErrorReasonCode,
    };
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::{Arc, Mutex as StdMutex};

    struct TestAppHostSession {
        reads: Arc<StdMutex<Vec<String>>>,
    }

    impl NimiAppHostSession for TestAppHostSession {
        fn bootstrap_status(
            &self,
        ) -> Pin<Box<dyn Future<Output = Result<AppHostBootstrapStatus, NimiHostError>> + Send + '_>>
        {
            Box::pin(async { Ok(test_bootstrap()) })
        }

        fn read_artifact_bytes(
            &self,
            artifact_id: String,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<AppHostArtifactBytes, AppHostArtifactReadError>>
                    + Send
                    + '_,
            >,
        > {
            let reads = self.reads.clone();
            Box::pin(async move {
                reads.lock().expect("reads").push(artifact_id.clone());
                Ok(AppHostArtifactBytes {
                    bytes: artifact_id.as_bytes().to_vec(),
                    mime_type: "text/plain".to_string(),
                    size_bytes: artifact_id.len() as i64,
                    mime_inferred: false,
                })
            })
        }
    }

    struct TestAppHostCarrier {
        opens: Arc<StdMutex<u32>>,
        reads: Arc<StdMutex<Vec<String>>>,
        denied: bool,
    }

    impl NimiAppHostCarrier for TestAppHostCarrier {
        fn open_app_host_session(
            &self,
        ) -> Pin<
            Box<
                dyn Future<Output = Result<Box<dyn NimiAppHostSession>, NimiHostError>> + Send + '_,
            >,
        > {
            let opens = self.opens.clone();
            let reads = self.reads.clone();
            let denied = self.denied;
            Box::pin(async move {
                *opens.lock().expect("opens") += 1;
                if denied {
                    return Err(NimiHostError::new(
                        NimiHostErrorReasonCode::ProtectedCarrierRequired,
                        false,
                    ));
                }
                Ok(Box::new(TestAppHostSession { reads }) as Box<dyn NimiAppHostSession>)
            })
        }
    }

    #[tokio::test]
    async fn host_reuses_one_opaque_session_and_projects_bootstrap_without_material() {
        let opens = Arc::new(StdMutex::new(0));
        let reads = Arc::new(StdMutex::new(Vec::new()));
        let host = RuntimeBridgeAppHost::new(Arc::new(TestAppHostCarrier {
            opens: opens.clone(),
            reads: reads.clone(),
            denied: false,
        }));

        let bootstrap = host.bootstrap().await.expect("bootstrap");
        assert_eq!(bootstrap, test_bootstrap());
        let first = host
            .read_artifact_bytes("artifact-one".to_string())
            .await
            .expect("read");
        assert_eq!(first.bytes, b"artifact-one");
        assert_eq!(*opens.lock().expect("opens"), 1);
        assert_eq!(*reads.lock().expect("reads"), vec!["artifact-one"]);
    }

    #[tokio::test]
    async fn host_preserves_carrier_denial_without_caching_pseudo_session() {
        let opens = Arc::new(StdMutex::new(0));
        let host = RuntimeBridgeAppHost::new(Arc::new(TestAppHostCarrier {
            opens: opens.clone(),
            reads: Arc::new(StdMutex::new(Vec::new())),
            denied: true,
        }));

        for _ in 0..2 {
            let error = host.bootstrap().await.expect_err("carrier denial");
            assert_eq!(error.reason_code(), "protected-carrier-required");
        }
        assert_eq!(*opens.lock().expect("opens"), 2);
    }

    #[test]
    fn host_error_preserves_artifact_reason_without_secret_detail() {
        let error = RuntimeBridgeAppHostError::Artifact(AppHostArtifactReadError::new(
            AppHostArtifactReadReasonCode::Forbidden,
            false,
        ));
        assert_eq!(error.reason_code(), "installed-artifact-forbidden");
        assert_eq!(error.to_string(), "installed-artifact-forbidden");
    }

    fn test_bootstrap() -> AppHostBootstrapStatus {
        AppHostBootstrapStatus {
            state: AppHostBootstrapState::Ready,
            trust_class: AppHostTrustClass::LocalDevelopment,
            app_id: "nimi.thirdparty.fixture".to_string(),
            bootstrap_artifact_id: Some("bootstrap-artifact".to_string()),
            expires_at_unix_ms: 1_800_000_000_000,
        }
    }
}
