use super::{LocalAppOperationError, untrusted};
use crate::generated::SpeechInputCapabilities;
use serde_json::{json, Value};
// @nimi-authority: rule.nimi.runtime.ai-provider.r112
pub(super) fn project(input: SpeechInputCapabilities) -> Result<Value, LocalAppOperationError> {
    if input.max_reference_bytes == 0
        || input.max_reference_duration_seconds == 0
        || input.supports_performance_audio != (input.max_performance_text_bytes > 0) { return Err(untrusted()); }
    Ok(json!({"supportsIdentityAudio":input.supports_identity_audio,"supportsPerformanceAudio":input.supports_performance_audio,
        "maxReferenceBytes":input.max_reference_bytes,"maxReferenceDurationSeconds":input.max_reference_duration_seconds,"maxPerformanceTextBytes":input.max_performance_text_bytes}))
}
