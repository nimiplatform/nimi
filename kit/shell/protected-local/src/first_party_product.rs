use crate::desktop_unary::DesktopFirstPartyProfile;
use crate::first_party_profiles_generated::{
    DesktopAccountProductStreamMethod, DesktopAccountProductUnaryMethod,
    DesktopMachineProductStreamMethod, DesktopMachineProductUnaryMethod,
};
use std::{collections::BTreeMap, time::Duration};
use tokio::sync::mpsc;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopFirstPartyProductError {
    reason_code: String,
    retryable: bool,
    reason_metadata: BTreeMap<String, String>,
}

impl DesktopFirstPartyProductError {
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

impl From<crate::desktop_unary::DesktopUnaryError> for DesktopFirstPartyProductError {
    fn from(error: crate::desktop_unary::DesktopUnaryError) -> Self {
        Self::new(error.reason_code(), error.retryable())
            .with_reason_metadata(error.reason_metadata().clone())
    }
}

pub struct DesktopMachineProductUnaryRequest {
    pub method: DesktopMachineProductUnaryMethod,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

pub struct DesktopAccountProductUnaryRequest {
    pub method: DesktopAccountProductUnaryMethod,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

pub struct DesktopMachineProductStreamRequest {
    pub method: DesktopMachineProductStreamMethod,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

pub struct DesktopAccountProductStreamRequest {
    pub method: DesktopAccountProductStreamMethod,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

pub struct DesktopAccountProductClientStreamRequest {
    pub method: DesktopAccountProductStreamMethod,
    pub request_frames: Vec<Vec<u8>>,
    pub timeout: Option<Duration>,
}

#[derive(Debug)]
pub struct DesktopFirstPartyProductUnaryResponse {
    pub response_bytes: Vec<u8>,
}

pub type DesktopFirstPartyProductStreamReceiver =
    mpsc::Receiver<Result<Vec<u8>, DesktopFirstPartyProductError>>;

#[cfg(any(target_os = "windows", target_os = "macos"))]
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-cold-010a
pub(crate) async fn invoke_machine_unary(
    channel: tonic::transport::Channel,
    request: DesktopMachineProductUnaryRequest,
) -> Result<DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if request.method == DesktopMachineProductUnaryMethod::SelectProductControlDataRoot
        || (cfg!(target_os = "macos")
            && request.method == DesktopMachineProductUnaryMethod::ReplaceProductControlDataRoot)
    {
        use prost::Message;
        let data_root =
            if request.method == DesktopMachineProductUnaryMethod::SelectProductControlDataRoot {
                crate::generated::SelectProductControlDataRootRequest::decode(
                    request.request_bytes.as_slice(),
                )
                .map(|selection| selection.data_root)
            } else {
                crate::generated::ReplaceProductControlDataRootRequest::decode(
                    request.request_bytes.as_slice(),
                )
                .map(|replacement| replacement.target_root)
            }
            .map_err(|_| DesktopFirstPartyProductError::new("invalid-payload", false))?;
        let data_root = std::path::PathBuf::from(data_root);
        #[cfg(target_os = "macos")]
        let should_prepare = request.method
            != DesktopMachineProductUnaryMethod::ReplaceProductControlDataRoot
            || replacement_target_needs_access(&channel, &data_root, request.timeout).await?;
        #[cfg(not(target_os = "macos"))]
        let should_prepare = true;
        if should_prepare {
            tokio::task::spawn_blocking(move || crate::prepare_fixed_runtime_data_root(&data_root))
                .await
                .map_err(|_| {
                    DesktopFirstPartyProductError::new("runtime-service-repair-required", false)
                })?
                .map_err(|error| {
                    let reason = match error.stage() {
                        "validate-selected-root"
                        | "create-selected-root"
                        | "inspect-selected-root"
                        | "prepare-existing-data-access" => "invalid-payload",
                        _ => "runtime-service-repair-required",
                    };
                    DesktopFirstPartyProductError::new(reason, false)
                })?;
        }
    }
    invoke_unary(
        channel,
        DesktopFirstPartyProfile::Machine,
        request.method.method_id(),
        request.request_bytes,
        request.timeout,
    )
    .await
}

#[cfg(target_os = "macos")]
async fn replacement_target_needs_access(
    channel: &tonic::transport::Channel,
    target: &std::path::Path,
    timeout: Option<Duration>,
) -> Result<bool, DesktopFirstPartyProductError> {
    use prost::Message;
    let target =
        crate::macos_data_root::normalized_absolute_non_root(target, "validate-selected-root")
            .map_err(|_| DesktopFirstPartyProductError::new("invalid-payload", false))?;
    // Runtime supplies the canonical active path. Permission preparation must
    // not traverse that tree; Runtime still decides no-op/overlap and performs
    // the actual replacement through the original protected request.
    let response = invoke_unary(
        channel.clone(),
        DesktopFirstPartyProfile::Machine,
        DesktopMachineProductUnaryMethod::GetProductControlSelectedDataRoot.method_id(),
        Vec::new(),
        timeout,
    )
    .await?;
    let response =
        crate::generated::ProductControlProjectionJson::decode(response.response_bytes.as_slice())
            .map_err(|_| DesktopFirstPartyProductError::new("runtime-service-untrusted", false))?;
    let projection: serde_json::Value = serde_json::from_str(&response.json)
        .map_err(|_| DesktopFirstPartyProductError::new("runtime-service-untrusted", false))?;
    replacement_target_is_disjoint(&target, &projection)
}

#[cfg(target_os = "macos")]
fn replacement_target_is_disjoint(
    target: &std::path::Path,
    projection: &serde_json::Value,
) -> Result<bool, DesktopFirstPartyProductError> {
    let Some(value) = projection.get("dataRoot") else {
        return Err(DesktopFirstPartyProductError::new(
            "runtime-service-untrusted",
            false,
        ));
    };
    if value.is_null() {
        return Ok(false);
    }
    let current = value
        .get("path")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| DesktopFirstPartyProductError::new("runtime-service-untrusted", false))?;
    let current = crate::macos_data_root::normalized_absolute_non_root(
        std::path::Path::new(current),
        "validate-current-root",
    )
    .map_err(|_| DesktopFirstPartyProductError::new("runtime-service-untrusted", false))?;
    Ok(current != target && !current.starts_with(target) && !target.starts_with(&current))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_account_unary(
    channel: tonic::transport::Channel,
    request: DesktopAccountProductUnaryRequest,
) -> Result<DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError> {
    invoke_unary(
        channel,
        DesktopFirstPartyProfile::Account,
        request.method.method_id(),
        request.request_bytes,
        request.timeout,
    )
    .await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn invoke_unary(
    channel: tonic::transport::Channel,
    profile: DesktopFirstPartyProfile,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError> {
    let response_bytes = crate::desktop_unary::invoke_first_party(
        channel,
        profile,
        method_id,
        request_bytes,
        timeout,
    )
    .await
    .map_err(DesktopFirstPartyProductError::from)?;
    Ok(DesktopFirstPartyProductUnaryResponse { response_bytes })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn open_machine_stream(
    channel: tonic::transport::Channel,
    request: DesktopMachineProductStreamRequest,
) -> Result<DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductError> {
    crate::desktop_stream::open_first_party(
        channel,
        DesktopFirstPartyProfile::Machine,
        request.method.method_id(),
        request.request_bytes,
        request.timeout,
    )
    .await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn open_account_stream(
    channel: tonic::transport::Channel,
    request: DesktopAccountProductStreamRequest,
) -> Result<DesktopFirstPartyProductStreamReceiver, DesktopFirstPartyProductError> {
    crate::desktop_stream::open_first_party(
        channel,
        DesktopFirstPartyProfile::Account,
        request.method.method_id(),
        request.request_bytes,
        request.timeout,
    )
    .await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_account_client_stream(
    channel: tonic::transport::Channel,
    request: DesktopAccountProductClientStreamRequest,
) -> Result<DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError> {
    if request.method != DesktopAccountProductStreamMethod::WriteLocalAppAsset {
        return Err(DesktopFirstPartyProductError::new(
            "runtime-service-untrusted",
            false,
        ));
    }
    let response_bytes = crate::desktop_client_stream::invoke_first_party(
        channel,
        DesktopFirstPartyProfile::Account,
        request.method.method_id(),
        request.request_frames,
        request.timeout,
    )
    .await?;
    Ok(DesktopFirstPartyProductUnaryResponse { response_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn replacement_permission_preparation_uses_selected_data_root_projection() {
        // GetProductControlSelectedDataRoot returns the productDataRootRecord
        // object, including its path; it does not return a bare path string.
        let projection = serde_json::json!({
            "path": "/Users/owner/.nimi/nimi.json",
            "exists": true,
            "state": "ready_for_use",
            "dataRoot": {
                "path": "/Users/owner/Nimi",
                "status": "ready",
                "rootActivationId": "activation-current",
                "selectedAt": "2026-09-08T00:00:00Z",
                "verifiedAt": "2026-09-08T00:00:00Z",
                "selectedAtUnixMs": 1788825600000_i64,
                "verifiedAtUnixMs": 1788825600000_i64
            },
            "error": null
        });
        for (target, expected) in [
            ("/Users/owner/Nimi-other", true),
            ("/Users/owner/Nimi", false),
            ("/Users/owner/Nimi/models", false),
            ("/Users/owner", false),
        ] {
            assert_eq!(
                replacement_target_is_disjoint(std::path::Path::new(target), &projection)
                    .expect("the current Runtime projection must be admitted"),
                expected
            );
        }
        let target = std::path::Path::new("/Users/owner/Nimi-other");
        assert!(
            !replacement_target_is_disjoint(target, &serde_json::json!({ "dataRoot": null }))
                .expect("Runtime must decide replacement without a selected root")
        );
        for malformed in [
            serde_json::json!({ "dataRoot": "/Users/owner/Nimi" }),
            serde_json::json!({ "dataRoot": {} }),
        ] {
            assert_eq!(
                replacement_target_is_disjoint(target, &malformed)
                    .expect_err("a malformed projection must remain rejected")
                    .reason_code(),
                "runtime-service-untrusted"
            );
        }
    }

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    #[tokio::test]
    async fn selected_data_root_is_decoded_before_transport_or_acl_action() {
        let channel = tonic::transport::Endpoint::from_static("http://[::]:50051").connect_lazy();
        let mut methods = vec![DesktopMachineProductUnaryMethod::SelectProductControlDataRoot];
        #[cfg(target_os = "macos")]
        methods.push(DesktopMachineProductUnaryMethod::ReplaceProductControlDataRoot);
        for method in methods {
            let error = invoke_machine_unary(
                channel.clone(),
                DesktopMachineProductUnaryRequest {
                    method,
                    request_bytes: vec![0xff],
                    timeout: None,
                },
            )
            .await
            .expect_err("malformed selected-root request must fail");
            assert_eq!(error.reason_code(), "invalid-payload");
            assert!(!error.retryable());
        }
    }
}
