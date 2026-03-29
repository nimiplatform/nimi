use serde::{Deserialize, Serialize};

use super::catalog::LocalAiInstallRequest;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiTransferSessionKind {
    Download,
    Import,
}

fn default_transfer_session_kind() -> LocalAiTransferSessionKind {
    LocalAiTransferSessionKind::Download
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LocalAiDownloadState {
    Queued,
    Running,
    Paused,
    Failed,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDownloadProgressEvent {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: Option<String>,
    #[serde(default = "default_transfer_session_kind")]
    pub session_kind: LocalAiTransferSessionKind,
    pub phase: String,
    pub bytes_received: u64,
    pub bytes_total: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
    pub state: LocalAiDownloadState,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
    pub done: bool,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDownloadSessionRecord {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
    #[serde(default = "default_transfer_session_kind")]
    pub session_kind: LocalAiTransferSessionKind,
    pub request: LocalAiInstallRequest,
    pub install_metadata: Option<serde_json::Value>,
    pub phase: String,
    pub state: LocalAiDownloadState,
    pub bytes_received: u64,
    pub bytes_total: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
    pub reason_code: Option<String>,
    pub retryable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDownloadSessionSummary {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
    #[serde(default = "default_transfer_session_kind")]
    pub session_kind: LocalAiTransferSessionKind,
    pub phase: String,
    pub state: LocalAiDownloadState,
    pub bytes_received: u64,
    pub bytes_total: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
    pub reason_code: Option<String>,
    pub retryable: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiDownloadControlPayload {
    pub install_session_id: String,
}
