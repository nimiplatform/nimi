#[cfg(any(target_os = "windows", target_os = "macos"))]
use crate::{desktop_unary, first_party_profiles_generated::BundledAvatarMethodKind};
use std::{collections::BTreeMap, time::Duration};
use tokio::sync::mpsc;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use tonic::transport::Channel;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAppRuntimeError {
    reason_code: String,
    retryable: bool,
    reason_metadata: BTreeMap<String, String>,
}

impl BundledAppRuntimeError {
    pub(crate) fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
        Self {
            reason_code: reason_code.into(),
            retryable,
            reason_metadata: BTreeMap::new(),
        }
    }

    pub(crate) fn with_reason_metadata(
        mut self,
        reason_metadata: BTreeMap<String, String>,
    ) -> Self {
        self.reason_metadata = reason_metadata;
        self
    }

    pub fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }
    pub const fn retryable(&self) -> bool {
        self.retryable
    }

    pub const fn reason_metadata(&self) -> &BTreeMap<String, String> {
        &self.reason_metadata
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAppRuntimeRequest {
    pub app: crate::BundledApp,
    pub method_id: String,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAppRuntimeClientStreamRequest {
    pub app: crate::BundledApp,
    pub method_id: String,
    pub request_frames: Vec<Vec<u8>>,
    pub timeout: Option<Duration>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAppRuntimeResponse {
    pub response_bytes: Vec<u8>,
}

pub type BundledAppRuntimeStreamReceiver = mpsc::Receiver<Result<Vec<u8>, BundledAppRuntimeError>>;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke(
    channel: Channel,
    request: BundledAppRuntimeRequest,
) -> Result<BundledAppRuntimeResponse, BundledAppRuntimeError> {
    let Some(profile) = request.app.method_profile(request.method_id.trim()) else {
        return Err(BundledAppRuntimeError::new(
            "runtime-service-untrusted",
            false,
        ));
    };
    if profile.kind != BundledAvatarMethodKind::Unary || !timeout_allowed(request.timeout) {
        return Err(BundledAppRuntimeError::new(
            "runtime-service-untrusted",
            false,
        ));
    }
    let response_bytes = desktop_unary::invoke_bundled_app(
        channel,
        request.app,
        profile.method_id,
        request.request_bytes,
        request.timeout,
    )
    .await
    .map_err(|error| {
        BundledAppRuntimeError::new(error.reason_code(), error.retryable())
            .with_reason_metadata(error.reason_metadata().clone())
    })?;
    Ok(BundledAppRuntimeResponse { response_bytes })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn open_stream(
    channel: Channel,
    request: BundledAppRuntimeRequest,
) -> Result<BundledAppRuntimeStreamReceiver, BundledAppRuntimeError> {
    let Some(profile) = request.app.method_profile(request.method_id.trim()) else {
        return Err(BundledAppRuntimeError::new(
            "runtime-service-untrusted",
            false,
        ));
    };
    if profile.kind != BundledAvatarMethodKind::ServerStream || !timeout_allowed(request.timeout) {
        return Err(BundledAppRuntimeError::new(
            "runtime-service-untrusted",
            false,
        ));
    }
    crate::desktop_stream::open_bundled_app(
        channel,
        request.app,
        profile.method_id,
        request.request_bytes,
        request.timeout,
    )
    .await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_client_stream(
    channel: Channel,
    request: BundledAppRuntimeClientStreamRequest,
) -> Result<BundledAppRuntimeResponse, BundledAppRuntimeError> {
    let Some(profile) = request.app.method_profile(request.method_id.trim()) else {
        return Err(BundledAppRuntimeError::new(
            "runtime-service-untrusted",
            false,
        ));
    };
    if profile.method_id != "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset"
        || profile.kind != BundledAvatarMethodKind::ServerStream
        || !timeout_allowed(request.timeout)
    {
        return Err(BundledAppRuntimeError::new(
            "runtime-service-untrusted",
            false,
        ));
    }
    let response_bytes = crate::desktop_client_stream::invoke_bundled_app(
        channel,
        request.app,
        profile.method_id,
        request.request_frames,
        request.timeout,
    )
    .await?;
    Ok(BundledAppRuntimeResponse { response_bytes })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn timeout_allowed(timeout: Option<Duration>) -> bool {
    timeout.is_none_or(|value| !value.is_zero() && value <= Duration::from_secs(300))
}
