use napi::bindgen_prelude::Buffer;
use napi_derive::napi;
use serde_json::Value as JsonValue;

#[napi(object)]
pub struct NativeJsonOutcome {
    pub status: String,
    pub value: Option<JsonValue>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
}

#[napi(object)]
pub struct NativeBytesOutcome {
    pub status: String,
    pub value: Option<Buffer>,
    pub reason_code: Option<String>,
    pub retryable: Option<bool>,
}

#[napi(object)]
pub struct NativeDesktopProductControlInput {
    pub method_id: String,
    pub request_bytes: Buffer,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct NativeDesktopRuntimeConsumerInput {
    pub method_id: String,
    pub request_bytes: Buffer,
    pub timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct NativeDesktopAccountBeginLoginInput {
    pub redirect_uri: String,
    pub callback_origin: String,
    pub requested_scopes: Vec<String>,
    pub ttl_seconds: i32,
}

#[napi(object)]
pub struct NativeDesktopAccountCompleteLoginInput {
    pub login_attempt_id: String,
    pub code: String,
    pub state: String,
    pub nonce: String,
    pub redirect_uri: String,
    pub callback_origin: String,
}

#[napi(object)]
pub struct NativeDesktopAccountRealmUnaryInput {
    pub method_id: String,
    pub request_json: String,
    pub timeout_ms: i32,
    pub idempotency_key: Option<String>,
}

#[napi(object)]
pub struct NativeDesktopAccountActionInput {
    pub reason: String,
}

#[napi(object)]
pub struct NativeDeveloperModeSetInput {
    pub enabled: bool,
}

#[napi(object)]
pub struct NativeLocalDevelopmentEvaluateInput {
    pub expected_app_id: String,
    pub project_root: String,
    pub shell: String,
    pub supervisor_run_id: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentDecisionInput {
    pub evaluation_id: String,
    pub decision: String,
    pub risk_disclosure_acknowledged: bool,
}

#[napi(object)]
pub struct NativeLocalDevelopmentReactivationInput {
    pub authorization_id: String,
    pub risk_disclosure_acknowledged: bool,
}

#[napi(object)]
pub struct NativeLocalDevelopmentAuthorizationInput {
    pub authorization_id: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentLaunchInput {
    pub authorization_id: String,
    pub supervisor_run_id: String,
    pub shell: String,
    pub host_executable_path: String,
    pub renderer_origin: String,
    pub host_arguments: Vec<String>,
    pub working_directory: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentRunInput {
    pub supervisor_run_id: String,
}

#[napi(object)]
pub struct NativeLocalDevelopmentEndRunInput {
    pub authorization_id: String,
    pub supervisor_run_id: String,
}

#[napi(object)]
pub struct NativePermissionStatusInput {
    pub permission_id: String,
}

#[napi(object)]
pub struct NativePermissionRequestInput {
    pub permission_id: String,
    pub reason: String,
}

#[napi(object)]
pub struct NativeStorageReadInput {
    pub relative_path: String,
}

#[napi(object)]
pub struct NativeStorageWriteInput {
    pub relative_path: String,
    pub value: JsonValue,
}

#[napi(object)]
pub struct NativeStorageRemoveInput {
    pub relative_path: String,
}
