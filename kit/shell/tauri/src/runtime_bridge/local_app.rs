#[cfg(target_os = "linux")]
use nimi_shell_protected_local::LinuxLocalAppCarrier;
#[cfg(target_os = "macos")]
use nimi_shell_protected_local::MacOsLocalAppCarrier;
#[cfg(target_os = "windows")]
use nimi_shell_protected_local::WindowsLocalAppCarrier;
use nimi_shell_protected_local::{
    LocalAppAIConfigOverwriteRequest, LocalAppOperationError, LocalAppPermissionRequest,
    LocalAppPermissionStatus, LocalAppPermissionStatusRequest, LocalAppReasonCode,
    LocalAppSessionStatus, LocalAppStorageDocument, LocalAppStorageReadRequest,
    LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult, LocalAppStorageWriteRequest,
    LocalAppTextCandidateRequest, LocalAppTextCandidateResult, NimiLocalAppCarrier,
    NimiLocalAppSession,
};
use std::sync::Arc;
use tokio::sync::Mutex;

/// Host-only Tauri projection of one connection-bound Local App session.
/// It exposes the same exact typed operations as the Electron Node-API addon.
pub struct RuntimeBridgeLocalAppHost {
    carrier: Arc<dyn NimiLocalAppCarrier>,
    session: Mutex<Option<Arc<dyn NimiLocalAppSession>>>,
}

impl RuntimeBridgeLocalAppHost {
    fn new(carrier: Arc<dyn NimiLocalAppCarrier>) -> Self {
        Self {
            carrier,
            session: Mutex::new(None),
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    pub fn platform_default() -> Self {
        #[cfg(target_os = "windows")]
        let carrier: Arc<dyn NimiLocalAppCarrier> = Arc::new(WindowsLocalAppCarrier);
        #[cfg(target_os = "macos")]
        let carrier: Arc<dyn NimiLocalAppCarrier> = Arc::new(MacOsLocalAppCarrier);
        #[cfg(target_os = "linux")]
        let carrier: Arc<dyn NimiLocalAppCarrier> = Arc::new(LinuxLocalAppCarrier);
        Self::new(carrier)
    }

    pub async fn session_status(&self) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.session_status().await {
            Ok(status) => Ok(status),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    /// Host-only technical renewal seam. Tauri renderers receive no command
    /// for this operation; an admitted host lifecycle scheduler owns it.
    pub async fn renew_technical_session(
        &self,
    ) -> Result<LocalAppSessionStatus, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.renew_technical_session().await {
            Ok(status) => Ok(status),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn permission_status(
        &self,
        request: LocalAppPermissionStatusRequest,
    ) -> Result<LocalAppPermissionStatus, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.permission_status(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn permission_request(
        &self,
        request: LocalAppPermissionRequest,
    ) -> Result<LocalAppPermissionStatus, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.permission_request(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn generate_text_candidate(
        &self,
        request: LocalAppTextCandidateRequest,
    ) -> Result<LocalAppTextCandidateResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.generate_text_candidate(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn app_ai_config_get(&self) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.app_ai_config_get().await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn app_ai_config_overwrite(
        &self,
        request: LocalAppAIConfigOverwriteRequest,
    ) -> Result<serde_json::Value, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.app_ai_config_overwrite(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_read_json(
        &self,
        request: LocalAppStorageReadRequest,
    ) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_read_json(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_write_json(
        &self,
        request: LocalAppStorageWriteRequest,
    ) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_write_json(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    pub async fn storage_remove_json(
        &self,
        request: LocalAppStorageRemoveRequest,
    ) -> Result<LocalAppStorageRemoveResult, LocalAppOperationError> {
        let session = self.current_or_open_session().await?;
        match session.storage_remove_json(request).await {
            Ok(value) => Ok(value),
            Err(error) => {
                self.clear_on_transport_failure(&session, &error).await;
                Err(error)
            }
        }
    }

    async fn current_or_open_session(
        &self,
    ) -> Result<Arc<dyn NimiLocalAppSession>, LocalAppOperationError> {
        let mut current = self.session.lock().await;
        if let Some(session) = current.as_ref() {
            return Ok(session.clone());
        }
        let session =
            Arc::<dyn NimiLocalAppSession>::from(self.carrier.open_local_app_session().await?);
        *current = Some(session.clone());
        Ok(session)
    }

    async fn clear_on_transport_failure(
        &self,
        session: &Arc<dyn NimiLocalAppSession>,
        error: &LocalAppOperationError,
    ) {
        if !matches!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeServiceUnavailable
                | LocalAppReasonCode::RuntimeServiceUntrusted
                | LocalAppReasonCode::RuntimeUnauthenticated
                | LocalAppReasonCode::ProcessReplaced
                | LocalAppReasonCode::AccountChanged
                | LocalAppReasonCode::RuntimeRestarted
                | LocalAppReasonCode::Revoked
        ) {
            return;
        }
        let mut current = self.session.lock().await;
        if current
            .as_ref()
            .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
        {
            *current = None;
        }
    }
}

impl Default for RuntimeBridgeLocalAppHost {
    fn default() -> Self {
        Self::platform_default()
    }
}
