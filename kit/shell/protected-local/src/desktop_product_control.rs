use std::time::Duration;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopProductControlMethod {
    CollectDeviceProfile,
    ResolveLocalEnvironmentPlan,
    ListLocalEnvironmentDependencyJobs,
    StartLocalEnvironmentDependencyJob,
    CancelLocalEnvironmentDependencyJob,
    RetryLocalEnvironmentDependencyJob,
    RepairLocalEnvironmentDependency,
    ResolveRuntimeBaselineReadiness,
    MintRuntimeBaselineReadiness,
    ResolveFirstRunExecutionEvidence,
    MintFirstRunExecutionEvidence,
    GetProductControlRecord,
    GetProductControlSelectedDataRoot,
    EnsureProductControlRecordCreated,
    SelectProductControlDataRoot,
    SetProductControlFirstRunInstallLevel,
    CompleteProductControlFirstRunDeviceEnvironmentScan,
    AdmitProductControlReadyForUse,
    RecordProductControlAccountDefaultProfileEvidence,
    RecordProductControlFirstRunLocalAiReadyEvidence,
    ReconcileProductControlFirstRunSetupState,
}

impl DesktopProductControlMethod {
    pub fn from_method_id(method_id: &str) -> Option<Self> {
        Some(match method_id {
            "/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile" => Self::CollectDeviceProfile,
            "/nimi.runtime.v1.RuntimeLocalService/ResolveLocalEnvironmentPlan" => Self::ResolveLocalEnvironmentPlan,
            "/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs" => Self::ListLocalEnvironmentDependencyJobs,
            "/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob" => Self::StartLocalEnvironmentDependencyJob,
            "/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob" => Self::CancelLocalEnvironmentDependencyJob,
            "/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob" => Self::RetryLocalEnvironmentDependencyJob,
            "/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency" => Self::RepairLocalEnvironmentDependency,
            "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness" => Self::ResolveRuntimeBaselineReadiness,
            "/nimi.runtime.v1.RuntimeLocalService/MintRuntimeBaselineReadiness" => Self::MintRuntimeBaselineReadiness,
            "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence" => Self::ResolveFirstRunExecutionEvidence,
            "/nimi.runtime.v1.RuntimeLocalService/MintFirstRunExecutionEvidence" => Self::MintFirstRunExecutionEvidence,
            "/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord" => Self::GetProductControlRecord,
            "/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot" => Self::GetProductControlSelectedDataRoot,
            "/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated" => Self::EnsureProductControlRecordCreated,
            "/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot" => Self::SelectProductControlDataRoot,
            "/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel" => Self::SetProductControlFirstRunInstallLevel,
            "/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan" => Self::CompleteProductControlFirstRunDeviceEnvironmentScan,
            "/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse" => Self::AdmitProductControlReadyForUse,
            "/nimi.runtime.v1.RuntimeLocalService/RecordProductControlAccountDefaultProfileEvidence" => Self::RecordProductControlAccountDefaultProfileEvidence,
            "/nimi.runtime.v1.RuntimeLocalService/RecordProductControlFirstRunLocalAiReadyEvidence" => Self::RecordProductControlFirstRunLocalAiReadyEvidence,
            "/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState" => Self::ReconcileProductControlFirstRunSetupState,
            _ => return None,
        })
    }

    pub const fn method_id(self) -> &'static str {
        match self {
            Self::CollectDeviceProfile => "/nimi.runtime.v1.RuntimeLocalService/CollectDeviceProfile",
            Self::ResolveLocalEnvironmentPlan => "/nimi.runtime.v1.RuntimeLocalService/ResolveLocalEnvironmentPlan",
            Self::ListLocalEnvironmentDependencyJobs => "/nimi.runtime.v1.RuntimeLocalService/ListLocalEnvironmentDependencyJobs",
            Self::StartLocalEnvironmentDependencyJob => "/nimi.runtime.v1.RuntimeLocalService/StartLocalEnvironmentDependencyJob",
            Self::CancelLocalEnvironmentDependencyJob => "/nimi.runtime.v1.RuntimeLocalService/CancelLocalEnvironmentDependencyJob",
            Self::RetryLocalEnvironmentDependencyJob => "/nimi.runtime.v1.RuntimeLocalService/RetryLocalEnvironmentDependencyJob",
            Self::RepairLocalEnvironmentDependency => "/nimi.runtime.v1.RuntimeLocalService/RepairLocalEnvironmentDependency",
            Self::ResolveRuntimeBaselineReadiness => "/nimi.runtime.v1.RuntimeLocalService/ResolveRuntimeBaselineReadiness",
            Self::MintRuntimeBaselineReadiness => "/nimi.runtime.v1.RuntimeLocalService/MintRuntimeBaselineReadiness",
            Self::ResolveFirstRunExecutionEvidence => "/nimi.runtime.v1.RuntimeLocalService/ResolveFirstRunExecutionEvidence",
            Self::MintFirstRunExecutionEvidence => "/nimi.runtime.v1.RuntimeLocalService/MintFirstRunExecutionEvidence",
            Self::GetProductControlRecord => "/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord",
            Self::GetProductControlSelectedDataRoot => "/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot",
            Self::EnsureProductControlRecordCreated => "/nimi.runtime.v1.RuntimeLocalService/EnsureProductControlRecordCreated",
            Self::SelectProductControlDataRoot => "/nimi.runtime.v1.RuntimeLocalService/SelectProductControlDataRoot",
            Self::SetProductControlFirstRunInstallLevel => "/nimi.runtime.v1.RuntimeLocalService/SetProductControlFirstRunInstallLevel",
            Self::CompleteProductControlFirstRunDeviceEnvironmentScan => "/nimi.runtime.v1.RuntimeLocalService/CompleteProductControlFirstRunDeviceEnvironmentScan",
            Self::AdmitProductControlReadyForUse => "/nimi.runtime.v1.RuntimeLocalService/AdmitProductControlReadyForUse",
            Self::RecordProductControlAccountDefaultProfileEvidence => "/nimi.runtime.v1.RuntimeLocalService/RecordProductControlAccountDefaultProfileEvidence",
            Self::RecordProductControlFirstRunLocalAiReadyEvidence => "/nimi.runtime.v1.RuntimeLocalService/RecordProductControlFirstRunLocalAiReadyEvidence",
            Self::ReconcileProductControlFirstRunSetupState => "/nimi.runtime.v1.RuntimeLocalService/ReconcileProductControlFirstRunSetupState",
        }
    }
}

pub struct DesktopProductControlRequest {
    pub method: DesktopProductControlMethod,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

pub struct DesktopProductControlResponse {
    pub response_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DesktopProductControlError {
    reason_code: String,
    retryable: bool,
}

impl DesktopProductControlError {
    pub fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
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

#[cfg(target_os = "windows")]
pub(crate) async fn invoke(
    channel: tonic::transport::Channel,
    request: DesktopProductControlRequest,
) -> Result<DesktopProductControlResponse, DesktopProductControlError> {
    use prost::bytes::{Buf, BufMut};
    use prost::Message;
    use tonic::client::Grpc;
    use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
    use tonic::Status;

    if request.method == DesktopProductControlMethod::SelectProductControlDataRoot {
        let selection = crate::generated::SelectProductControlDataRootRequest::decode(
            request.request_bytes.as_slice(),
        )
        .map_err(|_| DesktopProductControlError::new("invalid-payload", false))?;
        let data_root = std::path::PathBuf::from(selection.data_root);
        tokio::task::spawn_blocking(move || crate::prepare_fixed_runtime_data_root(&data_root))
            .await
            .map_err(|_| DesktopProductControlError::new("runtime-service-repair-required", false))?
            .map_err(|error| {
                let reason = match error.stage() {
                    "validate-selected-root" | "create-selected-root" | "inspect-selected-root" => {
                        "invalid-payload"
                    }
                    _ => "runtime-service-repair-required",
                };
                DesktopProductControlError::new(reason, false)
            })?;
    }

    #[derive(Debug, Default, Clone, Copy)]
    struct RawBytesCodec;
    #[derive(Debug, Default, Clone, Copy)]
    struct RawBytesEncoder;
    #[derive(Debug, Default, Clone, Copy)]
    struct RawBytesDecoder;

    impl Codec for RawBytesCodec {
        type Encode = Vec<u8>;
        type Decode = Vec<u8>;
        type Encoder = RawBytesEncoder;
        type Decoder = RawBytesDecoder;

        fn encoder(&mut self) -> Self::Encoder {
            RawBytesEncoder
        }
        fn decoder(&mut self) -> Self::Decoder {
            RawBytesDecoder
        }
    }

    impl Encoder for RawBytesEncoder {
        type Item = Vec<u8>;
        type Error = Status;

        fn encode(
            &mut self,
            item: Self::Item,
            destination: &mut EncodeBuf<'_>,
        ) -> Result<(), Self::Error> {
            destination.put_slice(item.as_slice());
            Ok(())
        }
    }

    impl Decoder for RawBytesDecoder {
        type Item = Vec<u8>;
        type Error = Status;

        fn decode(
            &mut self,
            source: &mut DecodeBuf<'_>,
        ) -> Result<Option<Self::Item>, Self::Error> {
            let mut value = vec![0_u8; source.remaining()];
            source.copy_to_slice(value.as_mut_slice());
            Ok(Some(value))
        }
    }

    let mut grpc = Grpc::new(channel).max_decoding_message_size(32 * 1024 * 1024);
    grpc.ready()
        .await
        .map_err(|_| DesktopProductControlError::new("runtime-service-unavailable", true))?;
    let mut tonic_request = tonic::Request::new(request.request_bytes);
    if let Some(timeout) = request.timeout {
        tonic_request.set_timeout(timeout);
    }
    let response = grpc
        .unary(
            tonic_request,
            tonic::codegen::http::uri::PathAndQuery::from_static(request.method.method_id()),
            RawBytesCodec,
        )
        .await
        .map_err(|status| {
            let retryable = matches!(
                status.code(),
                tonic::Code::Unavailable
                    | tonic::Code::DeadlineExceeded
                    | tonic::Code::Cancelled
                    | tonic::Code::ResourceExhausted
            );
            let reason =
                crate::grpc_status::runtime_reason(&status).unwrap_or_else(|| {
                    match status.code() {
                        tonic::Code::Unavailable
                        | tonic::Code::DeadlineExceeded
                        | tonic::Code::Cancelled => "runtime-service-unavailable".to_string(),
                        _ => "runtime-service-untrusted".to_string(),
                    }
                });
            DesktopProductControlError::new(reason, retryable)
        })?;
    Ok(DesktopProductControlResponse {
        response_bytes: response.into_inner(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_product_control_method_set_round_trips() {
        let methods = [
            DesktopProductControlMethod::CollectDeviceProfile,
            DesktopProductControlMethod::ResolveLocalEnvironmentPlan,
            DesktopProductControlMethod::ListLocalEnvironmentDependencyJobs,
            DesktopProductControlMethod::StartLocalEnvironmentDependencyJob,
            DesktopProductControlMethod::CancelLocalEnvironmentDependencyJob,
            DesktopProductControlMethod::RetryLocalEnvironmentDependencyJob,
            DesktopProductControlMethod::RepairLocalEnvironmentDependency,
            DesktopProductControlMethod::ResolveRuntimeBaselineReadiness,
            DesktopProductControlMethod::MintRuntimeBaselineReadiness,
            DesktopProductControlMethod::ResolveFirstRunExecutionEvidence,
            DesktopProductControlMethod::MintFirstRunExecutionEvidence,
            DesktopProductControlMethod::GetProductControlRecord,
            DesktopProductControlMethod::GetProductControlSelectedDataRoot,
            DesktopProductControlMethod::EnsureProductControlRecordCreated,
            DesktopProductControlMethod::SelectProductControlDataRoot,
            DesktopProductControlMethod::SetProductControlFirstRunInstallLevel,
            DesktopProductControlMethod::CompleteProductControlFirstRunDeviceEnvironmentScan,
            DesktopProductControlMethod::AdmitProductControlReadyForUse,
            DesktopProductControlMethod::RecordProductControlAccountDefaultProfileEvidence,
            DesktopProductControlMethod::RecordProductControlFirstRunLocalAiReadyEvidence,
            DesktopProductControlMethod::ReconcileProductControlFirstRunSetupState,
        ];
        for method in methods {
            assert_eq!(
                DesktopProductControlMethod::from_method_id(method.method_id()),
                Some(method)
            );
        }
        assert!(DesktopProductControlMethod::from_method_id(
            "/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets"
        )
        .is_none());
        assert!(DesktopProductControlMethod::from_method_id(
            "/nimi.runtime.v1.RuntimeAccountService/BeginLogin"
        )
        .is_none());
    }

    #[cfg(target_os = "windows")]
    #[tokio::test]
    async fn selected_data_root_wire_is_decoded_before_any_transport_or_acl_action() {
        let channel = tonic::transport::Endpoint::from_static("http://[::]:50051").connect_lazy();
        let error = match invoke(
            channel,
            DesktopProductControlRequest {
                method: DesktopProductControlMethod::SelectProductControlDataRoot,
                request_bytes: vec![0xff],
                timeout: None,
            },
        )
        .await
        {
            Ok(_) => panic!("malformed selected-root request must fail"),
            Err(error) => error,
        };
        assert_eq!(error.reason_code(), "invalid-payload");
        assert!(!error.retryable());
    }
}
