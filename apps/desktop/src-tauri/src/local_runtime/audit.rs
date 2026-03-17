use super::types::{now_iso_timestamp, LocalAiAuditEvent, LocalAiRuntimeState};

pub const EVENT_MODEL_DOWNLOAD_STARTED: &str = "model_download_started";
pub const EVENT_MODEL_DOWNLOAD_COMPLETED: &str = "model_download_completed";
pub const EVENT_MODEL_DOWNLOAD_FAILED: &str = "model_download_failed";
pub const EVENT_MODEL_DOWNLOAD_PAUSED: &str = "model_download_paused";
pub const EVENT_MODEL_DOWNLOAD_RESUMED: &str = "model_download_resumed";
pub const EVENT_MODEL_DOWNLOAD_CANCELLED: &str = "model_download_cancelled";
pub const EVENT_MODEL_DOWNLOAD_INTERRUPTED: &str = "model_download_interrupted";
pub const EVENT_MODEL_IMPORT_VALIDATED: &str = "model_import_validated";
pub const EVENT_MODEL_IMPORT_FAILED: &str = "model_import_failed";
pub const EVENT_ENGINE_STARTED: &str = "engine_started";
pub const EVENT_ENGINE_STOPPED: &str = "engine_stopped";
pub const EVENT_ENGINE_CRASHED: &str = "engine_crashed";
pub const EVENT_MODEL_CATALOG_SEARCH_INVOKED: &str = "model_catalog_search_invoked";
pub const EVENT_MODEL_CATALOG_SEARCH_FAILED: &str = "model_catalog_search_failed";
pub const EVENT_RECOMMENDATION_RESOLVE_INVOKED: &str = "recommendation_resolve_invoked";
pub const EVENT_RECOMMENDATION_RESOLVE_COMPLETED: &str = "recommendation_resolve_completed";
pub const EVENT_RECOMMENDATION_RESOLVE_FAILED: &str = "recommendation_resolve_failed";
pub const EVENT_ENGINE_PACK_DOWNLOAD_STARTED: &str = "engine_pack_download_started";
pub const EVENT_ENGINE_PACK_DOWNLOAD_COMPLETED: &str = "engine_pack_download_completed";
pub const EVENT_ENGINE_PACK_DOWNLOAD_FAILED: &str = "engine_pack_download_failed";
pub const EVENT_RUNTIME_MODEL_READY_AFTER_INSTALL: &str = "runtime_model_ready_after_install";
pub const EVENT_DEPENDENCY_RESOLVE_INVOKED: &str = "dependency_resolve_invoked";
pub const EVENT_DEPENDENCY_RESOLVE_FAILED: &str = "dependency_resolve_failed";
pub const EVENT_DEPENDENCY_APPLY_STARTED: &str = "dependency_apply_started";
pub const EVENT_DEPENDENCY_APPLY_COMPLETED: &str = "dependency_apply_completed";
pub const EVENT_DEPENDENCY_APPLY_FAILED: &str = "dependency_apply_failed";
pub const EVENT_PROFILE_RESOLVE_INVOKED: &str = "profile_resolve_invoked";
pub const EVENT_PROFILE_RESOLVE_FAILED: &str = "profile_resolve_failed";
pub const EVENT_PROFILE_APPLY_STARTED: &str = "profile_apply_started";
pub const EVENT_PROFILE_APPLY_COMPLETED: &str = "profile_apply_completed";
pub const EVENT_PROFILE_APPLY_FAILED: &str = "profile_apply_failed";
pub const EVENT_SERVICE_INSTALL_STARTED: &str = "service_install_started";
pub const EVENT_SERVICE_INSTALL_COMPLETED: &str = "service_install_completed";
pub const EVENT_SERVICE_INSTALL_FAILED: &str = "service_install_failed";
pub const EVENT_NODE_CATALOG_LISTED: &str = "node_catalog_listed";
pub const EVENT_INFERENCE_INVOKED: &str = "inference_invoked";
pub const EVENT_INFERENCE_FAILED: &str = "inference_failed";
pub const EVENT_FALLBACK_TO_CLOUD: &str = "fallback_to_cloud";
pub const EVENT_MODEL_FILE_IMPORT_STARTED: &str = "model_file_import_started";

const MAX_AUDIT_EVENTS: usize = 5000;

pub fn append_audit_event(
    state: &mut LocalAiRuntimeState,
    event_type: &str,
    model_id: Option<&str>,
    local_model_id: Option<&str>,
    payload: Option<serde_json::Value>,
) {
    let next_id = format!("audit-{}-{}", now_iso_timestamp(), state.audits.len() + 1);
    state.audits.push(LocalAiAuditEvent {
        id: next_id,
        event_type: event_type.trim().to_string(),
        occurred_at: now_iso_timestamp(),
        model_id: model_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        local_model_id: local_model_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        payload,
    });
    if state.audits.len() > MAX_AUDIT_EVENTS {
        let extra = state.audits.len() - MAX_AUDIT_EVENTS;
        state.audits.drain(0..extra);
    }
}

#[cfg(test)]
mod tests {
    use super::{append_audit_event, MAX_AUDIT_EVENTS};
    use crate::local_runtime::types::LocalAiRuntimeState;

    #[test]
    fn append_audit_event_keeps_ring_buffer_size() {
        let mut state = LocalAiRuntimeState::default();
        for index in 0..(MAX_AUDIT_EVENTS + 20) {
            append_audit_event(
                &mut state,
                "model_download_started",
                Some("hf:test/model"),
                Some("local:test-model"),
                Some(serde_json::json!({ "index": index })),
            );
        }
        assert_eq!(state.audits.len(), MAX_AUDIT_EVENTS);
        let first_payload_index = state.audits[0]
            .payload
            .as_ref()
            .and_then(|value| value.get("index"))
            .and_then(|value| value.as_u64())
            .unwrap_or_default();
        assert_eq!(first_payload_index, 20);
    }

    #[test]
    fn append_audit_event_uses_iso_timestamp_and_id_prefix() {
        let mut state = LocalAiRuntimeState::default();
        append_audit_event(
            &mut state,
            "engine_started",
            Some("hf:test/model"),
            Some("local:test-model"),
            None,
        );
        let first = &state.audits[0];
        assert!(first.id.starts_with("audit-"));
        assert!(first.occurred_at.contains('T'));
        assert!(first.occurred_at.ends_with('Z'));
    }
}
