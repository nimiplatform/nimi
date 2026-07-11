#![deny(unsafe_code)]

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use nimi_shell_protected_local::{
    InstalledArtifactBytes, InstalledArtifactReadError, NimiInstalledAppCarrier,
    NimiInstalledAppSession, ProtectedCarrierError, WindowsInstalledAppCarrier,
};
use std::sync::Arc;
use tokio::sync::OnceCell;

static INSTALLED_SESSION: OnceCell<Arc<dyn NimiInstalledAppSession>> = OnceCell::const_new();

#[napi(object)]
pub struct NativeOpenOutcome {
    pub status: String,
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

#[napi(js_name = "openInstalledAppSession")]
pub async fn open_installed_app_session() -> NativeOpenOutcome {
    let opened = INSTALLED_SESSION
        .get_or_try_init(|| async {
            let session = WindowsInstalledAppCarrier
                .open_installed_app_session()
                .await?;
            Ok::<Arc<dyn NimiInstalledAppSession>, ProtectedCarrierError>(Arc::from(session))
        })
        .await;
    match opened {
        Ok(_) => NativeOpenOutcome::success(),
        Err(error) => NativeOpenOutcome::error(error),
    }
}

#[napi(js_name = "readInstalledArtifactBytes")]
pub async fn read_installed_artifact_bytes(artifact_id: String) -> NativeArtifactReadOutcome {
    let Some(session) = INSTALLED_SESSION.get().cloned() else {
        return NativeArtifactReadOutcome::error(InstalledArtifactReadError::new(
            nimi_shell_protected_local::InstalledArtifactReadReasonCode::Forbidden,
            false,
        ));
    };
    match session.read_artifact_bytes(artifact_id).await {
        Ok(artifact) => NativeArtifactReadOutcome::success(artifact),
        Err(error) => NativeArtifactReadOutcome::error(error),
    }
}

impl NativeOpenOutcome {
    fn success() -> Self {
        Self {
            status: "ok".to_string(),
            reason_code: None,
            retryable: None,
        }
    }

    fn error(error: ProtectedCarrierError) -> Self {
        Self {
            status: "error".to_string(),
            reason_code: Some(error.reason_code().as_str().to_string()),
            retryable: Some(error.retryable()),
        }
    }
}

impl NativeArtifactReadOutcome {
    fn success(artifact: InstalledArtifactBytes) -> Self {
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

    fn error(error: InstalledArtifactReadError) -> Self {
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
        Self::error(InstalledArtifactReadError::new(
            nimi_shell_protected_local::InstalledArtifactReadReasonCode::RuntimeUntrusted,
            false,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nimi_shell_protected_local::{InstalledArtifactReadReasonCode, ProtectedCarrierReasonCode};

    #[test]
    fn carrier_errors_project_only_typed_reason_and_retryability() {
        let outcome = NativeOpenOutcome::error(ProtectedCarrierError::new(
            ProtectedCarrierReasonCode::RuntimeServiceUnavailable,
            true,
        ));
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some("runtime-service-unavailable")
        );
        assert_eq!(outcome.retryable, Some(true));
    }

    #[test]
    fn artifact_success_projects_only_validated_public_fields() {
        let outcome = NativeArtifactReadOutcome::success(InstalledArtifactBytes {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        });
        assert_eq!(outcome.status, "ok");
        assert_eq!(outcome.bytes.as_deref(), Some(b"artifact".as_slice()));
        assert_eq!(outcome.mime_type.as_deref(), Some("text/plain"));
        assert_eq!(outcome.size_bytes, Some(8));
        assert_eq!(outcome.mime_inferred, Some(false));
        assert!(outcome.reason_code.is_none());
        assert!(outcome.retryable.is_none());
    }

    #[test]
    fn artifact_projection_fails_closed_on_impossible_size() {
        let outcome = NativeArtifactReadOutcome::success(InstalledArtifactBytes {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 7,
            mime_inferred: false,
        });
        assert_eq!(outcome.status, "error");
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some(InstalledArtifactReadReasonCode::RuntimeUntrusted.as_str())
        );
    }
}
