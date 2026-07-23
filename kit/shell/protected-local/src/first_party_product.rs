use crate::desktop_unary::DesktopFirstPartyProfile;
use crate::first_party_profiles_generated::{
    DesktopAccountProductStreamMethod, DesktopAccountProductUnaryMethod,
    DesktopMachineProductStreamMethod, DesktopMachineProductUnaryMethod,
};
use std::time::Duration;
use tokio::sync::mpsc;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopFirstPartyProductError {
    reason_code: String,
    retryable: bool,
}

impl DesktopFirstPartyProductError {
    pub(crate) fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
        Self {
            reason_code: reason_code.into(),
            retryable,
        }
    }

    pub fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }

    pub const fn retryable(&self) -> bool {
        self.retryable
    }
}

impl From<crate::desktop_unary::DesktopUnaryError> for DesktopFirstPartyProductError {
    fn from(error: crate::desktop_unary::DesktopUnaryError) -> Self {
        Self::new(error.reason_code(), error.retryable())
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

#[derive(Debug)]
pub struct DesktopFirstPartyProductUnaryResponse {
    pub response_bytes: Vec<u8>,
}

pub type DesktopFirstPartyProductStreamReceiver =
    mpsc::Receiver<Result<Vec<u8>, DesktopFirstPartyProductError>>;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_machine_unary(
    channel: tonic::transport::Channel,
    request: DesktopMachineProductUnaryRequest,
) -> Result<DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError> {
    #[cfg(target_os = "windows")]
    if request.method == DesktopMachineProductUnaryMethod::SelectProductControlDataRoot {
        use prost::Message;
        let selection = crate::generated::SelectProductControlDataRootRequest::decode(
            request.request_bytes.as_slice(),
        )
        .map_err(|_| DesktopFirstPartyProductError::new("invalid-payload", false))?;
        let data_root = std::path::PathBuf::from(selection.data_root);
        tokio::task::spawn_blocking(move || crate::prepare_fixed_runtime_data_root(&data_root))
            .await
            .map_err(|_| {
                DesktopFirstPartyProductError::new("runtime-service-repair-required", false)
            })?
            .map_err(|error| {
                let reason = match error.stage() {
                    "validate-selected-root" | "create-selected-root" | "inspect-selected-root" => {
                        "invalid-payload"
                    }
                    _ => "runtime-service-repair-required",
                };
                DesktopFirstPartyProductError::new(reason, false)
            })?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::first_party_profiles_generated::{
        DESKTOP_ACCOUNT_PRODUCT_STREAM_METHODS, DESKTOP_ACCOUNT_PRODUCT_UNARY_METHODS,
        DESKTOP_MACHINE_PRODUCT_STREAM_METHODS, DESKTOP_MACHINE_PRODUCT_UNARY_METHODS,
        DESKTOP_PRODUCT_CONTROL_V1_METHODS, ORDINARY_DESKTOP_RUNTIME_CONSUMER_V1_METHODS,
    };
    use std::collections::HashSet;

    #[test]
    fn generated_profile_families_have_exact_kind_counts_and_no_overlap() {
        assert_eq!(DESKTOP_MACHINE_PRODUCT_UNARY_METHODS.len(), 60);
        assert_eq!(DESKTOP_MACHINE_PRODUCT_STREAM_METHODS.len(), 4);
        assert_eq!(DESKTOP_ACCOUNT_PRODUCT_UNARY_METHODS.len(), 46);
        assert_eq!(DESKTOP_ACCOUNT_PRODUCT_STREAM_METHODS.len(), 3);
        let machine = DESKTOP_MACHINE_PRODUCT_UNARY_METHODS
            .iter()
            .map(|method| method.method_id())
            .chain(
                DESKTOP_MACHINE_PRODUCT_STREAM_METHODS
                    .iter()
                    .map(|method| method.method_id()),
            )
            .collect::<HashSet<_>>();
        let account = DESKTOP_ACCOUNT_PRODUCT_UNARY_METHODS
            .iter()
            .map(|method| method.method_id())
            .chain(
                DESKTOP_ACCOUNT_PRODUCT_STREAM_METHODS
                    .iter()
                    .map(|method| method.method_id()),
            )
            .collect::<HashSet<_>>();
        assert_eq!(
            machine
                .intersection(&account)
                .copied()
                .collect::<HashSet<_>>(),
            HashSet::from(["/nimi.runtime.v1.RuntimeConnectorService/ListConnectors"]),
        );
    }

    #[test]
    fn frozen_product_control_and_ordinary_views_resolve_to_one_canonical_profile() {
        for method in DESKTOP_PRODUCT_CONTROL_V1_METHODS {
            assert!(DesktopMachineProductUnaryMethod::from_method_id(method.method_id()).is_some());
        }
        for method in ORDINARY_DESKTOP_RUNTIME_CONSUMER_V1_METHODS {
            let method_id = method.method_id();
            let memberships =
                usize::from(DesktopMachineProductUnaryMethod::from_method_id(method_id).is_some())
                    + usize::from(
                        DesktopAccountProductUnaryMethod::from_method_id(method_id).is_some(),
                    );
            let expected =
                usize::from(method_id == "/nimi.runtime.v1.RuntimeConnectorService/ListConnectors")
                    + 1;
            assert_eq!(memberships, expected, "{method_id}");
        }
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn selected_data_root_is_decoded_before_transport_or_acl_action() {
        let channel = tonic::transport::Endpoint::from_static("http://[::]:50051").connect_lazy();
        let error = invoke_machine_unary(
            channel,
            DesktopMachineProductUnaryRequest {
                method: DesktopMachineProductUnaryMethod::SelectProductControlDataRoot,
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
