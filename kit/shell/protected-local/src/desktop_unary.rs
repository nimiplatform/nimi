use crate::first_party_profiles_generated::{
    BUNDLED_AVATAR_APP_ID, BUNDLED_AVATAR_NATIVE_PROFILE_MARKER,
    DESKTOP_ACCOUNT_PRODUCT_NATIVE_PROFILE_MARKER, DESKTOP_MACHINE_PRODUCT_NATIVE_PROFILE_MARKER,
};
use std::{collections::BTreeMap, time::Duration};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DesktopUnaryError {
    reason_code: String,
    retryable: bool,
    reason_metadata: BTreeMap<String, String>,
}

impl DesktopUnaryError {
    fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
        Self {
            reason_code: reason_code.into(),
            retryable,
            reason_metadata: BTreeMap::new(),
        }
    }

    fn with_reason_metadata(mut self, reason_metadata: BTreeMap<String, String>) -> Self {
        self.reason_metadata = reason_metadata;
        self
    }

    pub(crate) fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }

    pub(crate) const fn retryable(&self) -> bool {
        self.retryable
    }

    pub(crate) const fn reason_metadata(&self) -> &BTreeMap<String, String> {
        &self.reason_metadata
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopFirstPartyProfile {
    Machine,
    Account,
}

impl DesktopFirstPartyProfile {
    pub(crate) const fn marker(self) -> &'static str {
        match self {
            Self::Machine => DESKTOP_MACHINE_PRODUCT_NATIVE_PROFILE_MARKER,
            Self::Account => DESKTOP_ACCOUNT_PRODUCT_NATIVE_PROFILE_MARKER,
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_first_party(
    channel: tonic::transport::Channel,
    profile: DesktopFirstPartyProfile,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopUnaryError> {
    invoke_inner(
        channel,
        method_id,
        request_bytes,
        timeout,
        Some(profile.marker()),
        false,
    )
    .await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_bundled_avatar(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopUnaryError> {
    invoke_inner(channel, method_id, request_bytes, timeout, None, true).await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn invoke_inner(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
    first_party_profile_marker: Option<&'static str>,
    bundled_avatar: bool,
) -> Result<Vec<u8>, DesktopUnaryError> {
    use prost::bytes::{Buf, BufMut};
    use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
    use tonic::Status;

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

    let mut grpc = crate::grpc_limits::runtime_raw_client(channel);
    grpc.ready()
        .await
        .map_err(|_| DesktopUnaryError::new("runtime-service-unavailable", true))?;
    let mut tonic_request = tonic::Request::new(request_bytes);
    if let Some(profile_marker) = first_party_profile_marker {
        tonic_request.metadata_mut().insert(
            "x-nimi-protected-first-party-profile",
            tonic::metadata::MetadataValue::from_static(profile_marker),
        );
        tonic_request.metadata_mut().insert(
            "x-nimi-app-id",
            tonic::metadata::MetadataValue::from_static("nimi.desktop"),
        );
    } else if bundled_avatar {
        tonic_request.metadata_mut().insert(
            "x-nimi-protected-bundled-profile",
            tonic::metadata::MetadataValue::from_static(BUNDLED_AVATAR_NATIVE_PROFILE_MARKER),
        );
        tonic_request.metadata_mut().insert(
            "x-nimi-app-id",
            tonic::metadata::MetadataValue::from_static(BUNDLED_AVATAR_APP_ID),
        );
    }
    if let Some(timeout) = timeout {
        tonic_request.set_timeout(timeout);
    }
    let response = grpc
        .unary(
            tonic_request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method_id),
            RawBytesCodec,
        )
        .await
        .map_err(|status| {
            if std::env::var_os("NIMI_PROTECTED_LOCAL_DIAGNOSTICS").as_deref()
                == Some(std::ffi::OsStr::new("1"))
            {
                // Static admitted method only; never log request or status message.
                eprintln!(
                    "[protected-local desktop-unary] method={method_id} grpc_status_code={}",
                    status.code() as i32
                );
            }
            runtime_status_error(status, bundled_avatar)
        })?;
    Ok(response.into_inner())
}

// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
pub(crate) fn runtime_status_error(
    status: tonic::Status,
    bundled_avatar: bool,
) -> DesktopUnaryError {
    let retryable = matches!(
        status.code(),
        tonic::Code::Unavailable
            | tonic::Code::DeadlineExceeded
            | tonic::Code::Cancelled
            | tonic::Code::ResourceExhausted
    );
    let reason = if bundled_avatar {
        crate::grpc_status::bundled_avatar_runtime_reason(&status)
    } else {
        crate::grpc_status::runtime_reason(&status)
    };
    match reason {
        Some(reason) => DesktopUnaryError::new(reason, retryable)
            .with_reason_metadata(crate::grpc_status::desktop_runtime_reason_metadata(&status)),
        None => match status.code() {
            // Runtime may cancel one admitted request without losing the
            // verified shared channel. Match the stream carrier's scope.
            tonic::Code::Cancelled => DesktopUnaryError::new("runtime-request-canceled", retryable),
            tonic::Code::Unavailable | tonic::Code::DeadlineExceeded => {
                DesktopUnaryError::new("runtime-service-unavailable", retryable)
            }
            _ => DesktopUnaryError::new(
                crate::grpc_status::RUNTIME_SERVICE_ERROR_UNCLASSIFIED,
                retryable,
            )
            .with_reason_metadata(crate::grpc_status::unclassified_status_metadata(&status)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_unary_cancellation_is_request_scoped() {
        for bundled_avatar in [false, true] {
            let error = runtime_status_error(
                tonic::Status::cancelled("private canceled request"),
                bundled_avatar,
            );
            assert_eq!(error.reason_code(), "runtime-request-canceled");
            assert!(error.retryable());
            assert!(error.reason_metadata().is_empty());
        }
    }

    #[test]
    fn canceled_status_keeps_explicit_runtime_owner_or_origin_reason() {
        use prost::Message;

        #[derive(Clone, PartialEq, Message)]
        struct ErrorInfo {
            #[prost(string, tag = "1")]
            reason: String,
            #[prost(string, tag = "2")]
            domain: String,
        }
        #[derive(Clone, PartialEq, Message)]
        struct StatusDetails {
            #[prost(int32, tag = "1")]
            code: i32,
            #[prost(message, repeated, tag = "3")]
            details: Vec<prost_types::Any>,
        }

        for reason in [
            "LOCAL_APP_OPERATION_UNAVAILABLE",
            "PROTECTED_ORIGIN_ROLE_MISMATCH",
        ] {
            let details = StatusDetails {
                code: tonic::Code::Cancelled as i32,
                details: vec![prost_types::Any {
                    type_url: "type.googleapis.com/google.rpc.ErrorInfo".to_string(),
                    value: ErrorInfo {
                        reason: reason.to_string(),
                        domain: "nimi.runtime.v1".to_string(),
                    }
                    .encode_to_vec(),
                }],
            }
            .encode_to_vec();
            for bundled_avatar in [false, true] {
                let error = runtime_status_error(
                    tonic::Status::with_details(
                        tonic::Code::Cancelled,
                        "private owner failure",
                        details.clone().into(),
                    ),
                    bundled_avatar,
                );
                assert_eq!(error.reason_code(), reason);
                assert!(error.reason_metadata().is_empty());
            }
        }
    }

    #[test]
    fn missing_typed_owner_reason_keeps_transport_fail_closed() {
        for code in [tonic::Code::InvalidArgument, tonic::Code::Internal] {
            let error = runtime_status_error(tonic::Status::new(code, "private failure"), false);
            assert_eq!(error.reason_code(), "runtime-service-error-unclassified");
            assert_eq!(
                error.reason_metadata().get("grpc_status_code"),
                Some(&(code as i32).to_string())
            );
            assert!(!error
                .reason_metadata()
                .values()
                .any(|value| value.contains("private")));
        }
        for code in [tonic::Code::Unavailable, tonic::Code::DeadlineExceeded] {
            let error = runtime_status_error(tonic::Status::new(code, "private failure"), false);
            assert_eq!(error.reason_code(), "runtime-service-unavailable");
            assert!(error.retryable());
        }
    }
}
