use tauri::AppHandle;

use super::audit::{
    append_audit_event, EVENT_ENGINE_CRASHED, EVENT_ENGINE_PACK_DOWNLOAD_COMPLETED,
    EVENT_ENGINE_PACK_DOWNLOAD_FAILED, EVENT_ENGINE_PACK_DOWNLOAD_STARTED, EVENT_ENGINE_STARTED,
    EVENT_ENGINE_STOPPED,
};
use super::engine_host::{check_engine_health, restart_engine, start_engine, stop_engine};
use super::engine_pack::ensure_llama_cpp_binary;
use super::import_validator::normalize_and_validate_capabilities;
use super::store::{load_state, runtime_models_dir, runtime_root_dir, save_state};
use super::types::{
    now_iso_timestamp, LocalAiModelHealth, LocalAiModelRecord, LocalAiModelStatus,
    LocalAiRuntimeState,
};

fn find_model_index(models: &[LocalAiModelRecord], local_model_id: &str) -> Option<usize> {
    let normalized = local_model_id.trim().to_ascii_lowercase();
    models
        .iter()
        .position(|item| item.local_model_id.trim().to_ascii_lowercase() == normalized)
}

fn should_mark_engine_crashed(
    previous_status: &LocalAiModelStatus,
    checked_status: &LocalAiModelStatus,
) -> bool {
    *previous_status == LocalAiModelStatus::Active
        && *checked_status == LocalAiModelStatus::Unhealthy
}

fn is_llama_cpp_engine(engine: &str) -> bool {
    engine.trim().eq_ignore_ascii_case("llama-cpp")
}

fn extract_error_code(error: &str) -> &str {
    error
        .split(':')
        .next()
        .unwrap_or("LOCAL_AI_MODEL_PREFLIGHT_FAILED")
}

fn preflight_model_start(model: &LocalAiModelRecord) -> Result<(), String> {
    if model.status == LocalAiModelStatus::Removed {
        return Err("LOCAL_AI_MODEL_REMOVED: removed 模型禁止启动".to_string());
    }
    if model.hashes.is_empty() {
        return Err("LOCAL_AI_MODEL_HASHES_EMPTY: hashes 为空，模型未通过完整性校验".to_string());
    }
    let capabilities = normalize_and_validate_capabilities(&model.capabilities)?;
    if capabilities.is_empty() {
        return Err("LOCAL_AI_MODEL_CAPABILITY_EMPTY: capabilities 为空，模型不可执行".to_string());
    }
    Ok(())
}

fn configure_engine_environment(app: &AppHandle) -> Result<(), String> {
    let runtime_root = runtime_root_dir(app)?;
    let models_root = runtime_models_dir(app)?;
    std::env::set_var(
        "NIMI_LOCAL_AI_RUNTIME_ROOT",
        runtime_root.to_string_lossy().to_string(),
    );
    std::env::set_var(
        "NIMI_LOCAL_AI_MODELS_DIR",
        models_root.to_string_lossy().to_string(),
    );
    Ok(())
}

fn ensure_llama_engine_pack_with_audit(
    state: &mut LocalAiRuntimeState,
    model: &LocalAiModelRecord,
) -> Result<(), String> {
    if !is_llama_cpp_engine(model.engine.as_str()) {
        return Ok(());
    }

    let override_path = std::env::var("NIMI_LLAMA_CPP_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    if !override_path.is_empty() && std::path::Path::new(override_path.as_str()).exists() {
        return Ok(());
    }

    append_audit_event(
        state,
        EVENT_ENGINE_PACK_DOWNLOAD_STARTED,
        Some(model.model_id.as_str()),
        Some(model.local_model_id.as_str()),
        Some(serde_json::json!({
            "engine": model.engine,
            "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        })),
    );

    match ensure_llama_cpp_binary() {
        Ok(bootstrap) => {
            std::env::set_var("NIMI_LLAMA_CPP_BIN", bootstrap.binary_path.clone());
            append_audit_event(
                state,
                EVENT_ENGINE_PACK_DOWNLOAD_COMPLETED,
                Some(model.model_id.as_str()),
                Some(model.local_model_id.as_str()),
                Some(serde_json::json!({
                    "engine": model.engine,
                    "binaryPath": bootstrap.binary_path,
                    "downloaded": bootstrap.downloaded,
                    "sourceUrl": bootstrap.source_url,
                })),
            );
            Ok(())
        }
        Err(error) => {
            append_audit_event(
                state,
                EVENT_ENGINE_PACK_DOWNLOAD_FAILED,
                Some(model.model_id.as_str()),
                Some(model.local_model_id.as_str()),
                Some(serde_json::json!({
                    "engine": model.engine,
                    "reasonCode": extract_error_code(error.as_str()),
                    "error": error,
                })),
            );
            Err(error)
        }
    }
}

pub fn start_model(app: &AppHandle, local_model_id: &str) -> Result<LocalAiModelRecord, String> {
    configure_engine_environment(app)?;
    let mut state = load_state(app)?;
    let index = find_model_index(&state.models, local_model_id)
        .ok_or_else(|| format!("LOCAL_AI_MODEL_NOT_FOUND: 模型不存在: {local_model_id}"))?;

    let mut preflight_error = preflight_model_start(&state.models[index]).err();
    if preflight_error.is_none() {
        let model_snapshot = state.models[index].clone();
        if let Err(error) = ensure_llama_engine_pack_with_audit(&mut state, &model_snapshot) {
            preflight_error = Some(error);
        }
    }

    let (snapshot, event_type, event_payload) = {
        let model = &mut state.models[index];
        let health = match preflight_error {
            Some(error) => super::engine_host::EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiModelStatus::Unhealthy,
            },
            None => start_engine(model),
        };
        if health.healthy {
            model.status = LocalAiModelStatus::Active;
        } else {
            model.status = LocalAiModelStatus::Unhealthy;
        }
        model.health_detail = Some(health.detail.clone());
        model.updated_at = now_iso_timestamp();
        let snapshot = model.clone();
        let event_type = if health.healthy {
            EVENT_ENGINE_STARTED
        } else {
            EVENT_ENGINE_CRASHED
        };
        let payload = serde_json::json!({
            "engine": snapshot.engine,
            "detail": health.detail,
            "reasonCode": extract_error_code(health.detail.as_str()),
        });
        (snapshot, event_type, payload)
    };
    append_audit_event(
        &mut state,
        event_type,
        Some(snapshot.model_id.as_str()),
        Some(snapshot.local_model_id.as_str()),
        Some(event_payload),
    );
    save_state(app, &state)?;
    Ok(snapshot)
}

pub fn stop_model(app: &AppHandle, local_model_id: &str) -> Result<LocalAiModelRecord, String> {
    configure_engine_environment(app)?;
    let mut state = load_state(app)?;
    let index = find_model_index(&state.models, local_model_id)
        .ok_or_else(|| format!("LOCAL_AI_MODEL_NOT_FOUND: 模型不存在: {local_model_id}"))?;
    let (snapshot, event_payload) = {
        let model = &mut state.models[index];
        let health = stop_engine(model);
        if health.healthy {
            model.status = LocalAiModelStatus::Installed;
        } else {
            model.status = LocalAiModelStatus::Unhealthy;
        }
        model.health_detail = Some(health.detail.clone());
        model.updated_at = now_iso_timestamp();
        let snapshot = model.clone();
        let payload = serde_json::json!({
            "engine": snapshot.engine,
            "detail": health.detail,
        });
        (snapshot, payload)
    };
    append_audit_event(
        &mut state,
        EVENT_ENGINE_STOPPED,
        Some(snapshot.model_id.as_str()),
        Some(snapshot.local_model_id.as_str()),
        Some(event_payload),
    );
    save_state(app, &state)?;
    Ok(snapshot)
}

pub fn health(
    app: &AppHandle,
    local_model_id: Option<&str>,
) -> Result<Vec<LocalAiModelHealth>, String> {
    configure_engine_environment(app)?;
    let mut state = load_state(app)?;
    let mut output = Vec::<LocalAiModelHealth>::new();
    let mut pending_audits: Vec<(&'static str, String, String, serde_json::Value)> = Vec::new();

    for model in &mut state.models {
        if let Some(filter_id) = local_model_id {
            let normalized_filter = filter_id.trim().to_ascii_lowercase();
            if model.local_model_id.trim().to_ascii_lowercase() != normalized_filter {
                continue;
            }
        }
        if model.status == LocalAiModelStatus::Removed {
            continue;
        }
        let previous_status = model.status.clone();
        let checked = check_engine_health(model);

        let mut final_status = checked.status.clone();
        let mut final_detail = checked.detail.clone();

        let is_llama_cpp = is_llama_cpp_engine(&model.engine);
        let crashed = should_mark_engine_crashed(&previous_status, &checked.status);

        if crashed {
            pending_audits.push((
                EVENT_ENGINE_CRASHED,
                model.model_id.clone(),
                model.local_model_id.clone(),
                serde_json::json!({
                    "engine": model.engine,
                    "detail": checked.detail,
                    "reasonCode": extract_error_code(checked.detail.as_str()),
                }),
            ));
            if is_llama_cpp {
                let restarted = restart_engine(model);
                if restarted.healthy {
                    final_status = restarted.status;
                    final_detail =
                        format!("{}; auto-restart: {}", checked.detail, restarted.detail);
                    pending_audits.push((
                        EVENT_ENGINE_STARTED,
                        model.model_id.clone(),
                        model.local_model_id.clone(),
                        serde_json::json!({
                            "engine": model.engine,
                            "detail": restarted.detail,
                            "autoRestart": true,
                            "reasonCode": extract_error_code(restarted.detail.as_str()),
                        }),
                    ));
                }
            }
        }

        model.status = final_status.clone();
        model.health_detail = Some(final_detail.clone());
        model.updated_at = now_iso_timestamp();
        output.push(LocalAiModelHealth {
            local_model_id: model.local_model_id.clone(),
            status: final_status,
            detail: final_detail,
            endpoint: model.endpoint.clone(),
        });
    }

    for (event_type, model_id, local_model_id, payload) in pending_audits {
        append_audit_event(
            &mut state,
            event_type,
            Some(model_id.as_str()),
            Some(local_model_id.as_str()),
            Some(payload),
        );
    }

    save_state(app, &state)?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{is_llama_cpp_engine, preflight_model_start, should_mark_engine_crashed};
    use crate::local_runtime::types::LocalAiModelStatus;
    use crate::local_runtime::types::{LocalAiModelRecord, LocalAiModelSource};
    use std::collections::HashMap;

    fn model_fixture() -> LocalAiModelRecord {
        LocalAiModelRecord {
            local_model_id: "local:test-model".to_string(),
            model_id: "hf:test/model".to_string(),
            capabilities: vec!["chat".to_string()],
            engine: "localai".to_string(),
            entry: "model.gguf".to_string(),
            license: "apache-2.0".to_string(),
            source: LocalAiModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc".to_string())]),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status: LocalAiModelStatus::Installed,
            installed_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            health_detail: None,
            engine_config: None,
        }
    }

    #[test]
    fn crash_detection_only_marks_active_to_unhealthy_transition() {
        assert!(should_mark_engine_crashed(
            &LocalAiModelStatus::Active,
            &LocalAiModelStatus::Unhealthy
        ));
        assert!(!should_mark_engine_crashed(
            &LocalAiModelStatus::Installed,
            &LocalAiModelStatus::Unhealthy
        ));
        assert!(!should_mark_engine_crashed(
            &LocalAiModelStatus::Active,
            &LocalAiModelStatus::Active
        ));
    }

    #[test]
    fn llama_engine_match_is_case_insensitive() {
        assert!(is_llama_cpp_engine("llama-cpp"));
        assert!(is_llama_cpp_engine("LLAMA-CPP"));
        assert!(!is_llama_cpp_engine("localai"));
    }

    #[test]
    fn preflight_rejects_removed_or_unverified_models() {
        let mut removed = model_fixture();
        removed.status = LocalAiModelStatus::Removed;
        assert!(preflight_model_start(&removed).is_err());

        let mut missing_hash = model_fixture();
        missing_hash.hashes.clear();
        assert!(preflight_model_start(&missing_hash).is_err());

        let mut bad_capability = model_fixture();
        bad_capability.capabilities = vec!["voice".to_string()];
        assert!(preflight_model_start(&bad_capability).is_err());
    }
}
