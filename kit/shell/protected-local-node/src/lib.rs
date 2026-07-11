#![deny(unsafe_code)]

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use nimi_shell_protected_local::{
    AppHostArtifactBytes, AppHostArtifactReadError, AppHostBootstrapStatus, NimiAppHostCarrier,
    NimiAppHostSession, NimiHostError, WindowsAppHostCarrier,
};
use std::sync::Arc;
use tokio::sync::Mutex;

static APP_HOST_SESSION: Mutex<Option<Arc<dyn NimiAppHostSession>>> = Mutex::const_new(None);

#[napi(object)]
pub struct NativeBootstrapOutcome {
    pub status: String,
    pub state: Option<String>,
    pub trust_class: Option<String>,
    pub app_id: Option<String>,
    pub bootstrap_artifact_id: Option<String>,
    pub expires_at_unix_ms: Option<f64>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
}

#[napi(object)]
pub struct NativeArtifactReadOutcome {
    pub status: String,
    pub bytes: Option<Buffer>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<u32>,
    pub mime_inferred: Option<bool>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
}

#[napi(js_name = "openAppHostSession")]
pub async fn open_app_host_session() -> NativeBootstrapOutcome {
    if let Some(session) = current_session().await {
        match session.bootstrap_status().await {
            Ok(status) => return NativeBootstrapOutcome::success(status),
            Err(_) => clear_session_if_same(&session).await,
        }
    }
    let opened = WindowsAppHostCarrier.open_app_host_session().await;
    let session = match opened {
        Ok(session) => Arc::<dyn NimiAppHostSession>::from(session),
        Err(error) => return NativeBootstrapOutcome::error(error),
    };
    let status = match session.bootstrap_status().await {
        Ok(status) => status,
        Err(error) => return NativeBootstrapOutcome::error(error),
    };
    *APP_HOST_SESSION.lock().await = Some(session);
    NativeBootstrapOutcome::success(status)
}

#[napi(js_name = "getAppHostSessionStatus")]
pub async fn get_app_host_session_status() -> NativeBootstrapOutcome {
    let Some(session) = current_session().await else {
        return NativeBootstrapOutcome::error(NimiHostError::new(
            nimi_shell_protected_local::NimiHostErrorReasonCode::ProtectedCarrierRequired,
            false,
        ));
    };
    match session.bootstrap_status().await {
        Ok(status) => NativeBootstrapOutcome::success(status),
        Err(error) => {
            clear_session_if_same(&session).await;
            NativeBootstrapOutcome::error(error)
        }
    }
}

#[napi(js_name = "readAppHostArtifactBytes")]
pub async fn read_app_host_artifact_bytes(artifact_id: String) -> NativeArtifactReadOutcome {
    let Some(session) = current_session().await else {
        return NativeArtifactReadOutcome::error(AppHostArtifactReadError::new(
            nimi_shell_protected_local::AppHostArtifactReadReasonCode::Forbidden,
            false,
        ));
    };
    match session.read_artifact_bytes(artifact_id).await {
        Ok(artifact) => NativeArtifactReadOutcome::success(artifact),
        Err(error) => {
            clear_session_if_same(&session).await;
            NativeArtifactReadOutcome::error(error)
        }
    }
}

async fn current_session() -> Option<Arc<dyn NimiAppHostSession>> {
    APP_HOST_SESSION.lock().await.clone()
}

async fn clear_session_if_same(session: &Arc<dyn NimiAppHostSession>) {
    let mut current = APP_HOST_SESSION.lock().await;
    if current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
    {
        *current = None;
    }
}

impl NativeBootstrapOutcome {
    fn success(bootstrap: AppHostBootstrapStatus) -> Self {
        Self {
            status: "ok".to_string(),
            state: Some(bootstrap.state.as_str().to_string()),
            trust_class: Some(bootstrap.trust_class.as_str().to_string()),
            app_id: Some(bootstrap.app_id),
            bootstrap_artifact_id: bootstrap.bootstrap_artifact_id,
            expires_at_unix_ms: Some(bootstrap.expires_at_unix_ms as f64),
            reason_code: None,
            retryable: None,
        }
    }

    fn error(error: NimiHostError) -> Self {
        Self {
            status: "error".to_string(),
            state: None,
            trust_class: None,
            app_id: None,
            bootstrap_artifact_id: None,
            expires_at_unix_ms: None,
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }
}

impl NativeArtifactReadOutcome {
    fn success(artifact: AppHostArtifactBytes) -> Self {
        let Ok(size_bytes) = u32::try_from(artifact.size_bytes) else {
            return Self::runtime_untrusted();
        };
        if usize::try_from(size_bytes).ok() != Some(artifact.bytes.len()) {
            return Self::runtime_untrusted();
        }
        Self {
            status: "ok".to_string(),
            bytes: Some(artifact.bytes.into()),
            mime_type: Some(artifact.mime_type),
            size_bytes: Some(size_bytes),
            mime_inferred: Some(artifact.mime_inferred),
            reason_code: None,
            retryable: None,
        }
    }

    fn error(error: AppHostArtifactReadError) -> Self {
        Self {
            status: "error".to_string(),
            bytes: None,
            mime_type: None,
            size_bytes: None,
            mime_inferred: None,
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }

    fn runtime_untrusted() -> Self {
        Self::error(AppHostArtifactReadError::new(
            nimi_shell_protected_local::AppHostArtifactReadReasonCode::RuntimeUntrusted,
            false,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nimi_shell_protected_local::{
        AppHostArtifactReadReasonCode, AppHostBootstrapState, AppHostTrustClass,
        NimiHostErrorReasonCode,
    };

    #[test]
    fn host_errors_project_only_typed_reason_and_retryability() {
        let outcome = NativeBootstrapOutcome::error(NimiHostError::new(
            NimiHostErrorReasonCode::RuntimeServiceUnavailable,
            true,
        ));
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some("runtime-service-unavailable")
        );
        assert_eq!(outcome.retryable, Some(true));
        assert!(outcome.app_id.is_none());
        assert!(outcome.bootstrap_artifact_id.is_none());
    }

    #[test]
    fn bootstrap_projects_stable_status_without_technical_material() {
        let outcome = NativeBootstrapOutcome::success(AppHostBootstrapStatus {
            state: AppHostBootstrapState::Ready,
            trust_class: AppHostTrustClass::LocalDevelopment,
            app_id: "app.example".to_string(),
            bootstrap_artifact_id: Some("artifact-one".to_string()),
            expires_at_unix_ms: 1_800_000_000_000,
        });
        assert_eq!(outcome.status, "ok");
        assert_eq!(outcome.state.as_deref(), Some("ready"));
        assert_eq!(outcome.trust_class.as_deref(), Some("local-development"));
        assert_eq!(outcome.app_id.as_deref(), Some("app.example"));
        assert_eq!(
            outcome.bootstrap_artifact_id.as_deref(),
            Some("artifact-one")
        );
        assert!(outcome.reason_code.is_none());
    }

    #[test]
    fn artifact_success_projects_only_validated_public_fields() {
        let outcome = NativeArtifactReadOutcome::success(AppHostArtifactBytes {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        });
        assert_eq!(outcome.status, "ok");
        assert_eq!(outcome.bytes.as_deref(), Some(b"artifact".as_slice()));
        assert_eq!(outcome.size_bytes, Some(8));
    }

    #[test]
    fn artifact_projection_fails_closed_on_impossible_size() {
        let outcome = NativeArtifactReadOutcome::success(AppHostArtifactBytes {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 7,
            mime_inferred: false,
        });
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some(AppHostArtifactReadReasonCode::RuntimeUntrusted.as_str())
        );
    }
}
