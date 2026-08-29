use napi_derive::napi;
use nimi_shell_protected_local::{
    BundledAvatarRuntimeClientStreamRequest, DesktopAccountProductClientStreamRequest,
    DesktopAccountProductStreamMethod,
};

use super::{
    clear_desktop_control_on_transport_reason, current_or_open_desktop_control, NativeBytesOutcome,
    NativeFirstPartyProductClientStreamInput,
};

const WRITE_LOCAL_APP_ASSET_METHOD: &str = "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppAsset";

#[napi(js_name = "desktopAccountProductClientStream")]
pub async fn desktop_account_product_client_stream(
    input: NativeFirstPartyProductClientStreamInput,
) -> NativeBytesOutcome {
    let Some(method) = DesktopAccountProductStreamMethod::from_method_id(input.method_id.trim())
    else {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    };
    if method.method_id() != WRITE_LOCAL_APP_ASSET_METHOD {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    }
    let Some((frames, timeout)) = validated_input(input) else {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    };
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeBytesOutcome::host_error(error),
    };
    match control
        .invoke_account_product_client_stream(DesktopAccountProductClientStreamRequest {
            method,
            request_frames: frames,
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::error_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            )
        }
    }
}

#[napi(js_name = "desktopBundledAvatarClientStream")]
pub async fn desktop_bundled_avatar_client_stream(
    input: NativeFirstPartyProductClientStreamInput,
) -> NativeBytesOutcome {
    if input.method_id.trim() != WRITE_LOCAL_APP_ASSET_METHOD {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    }
    let Some((frames, timeout)) = validated_input(input) else {
        return NativeBytesOutcome::error("runtime-service-untrusted", false);
    };
    let control = match current_or_open_desktop_control().await {
        Ok(control) => control,
        Err(error) => return NativeBytesOutcome::host_error(error),
    };
    match control
        .invoke_bundled_avatar_client_stream(BundledAvatarRuntimeClientStreamRequest {
            method_id: WRITE_LOCAL_APP_ASSET_METHOD.to_string(),
            request_frames: frames,
            timeout,
        })
        .await
    {
        Ok(response) => NativeBytesOutcome::success(response.response_bytes),
        Err(error) => {
            clear_desktop_control_on_transport_reason(&control, error.reason_code()).await;
            NativeBytesOutcome::error_with_metadata(
                error.reason_code(),
                error.retryable(),
                error.reason_metadata(),
            )
        }
    }
}

fn validated_input(
    input: NativeFirstPartyProductClientStreamInput,
) -> Option<(Vec<Vec<u8>>, Option<std::time::Duration>)> {
    let timeout = input
        .timeout_ms
        .map(u64::from)
        .map(std::time::Duration::from_millis);
    if timeout.is_some_and(|value| value.is_zero() || value > std::time::Duration::from_secs(300))
        || input.request_frames.len() < 2
        || input.request_frames.len() > 65
    {
        return None;
    }
    let frames = input
        .request_frames
        .into_iter()
        .map(|frame| frame.to_vec())
        .collect::<Vec<_>>();
    let total = frames
        .iter()
        .try_fold(0usize, |total, frame| total.checked_add(frame.len()))?;
    if frames.iter().any(Vec::is_empty) || total > 65 * 1024 * 1024 {
        return None;
    }
    Some((frames, timeout))
}
