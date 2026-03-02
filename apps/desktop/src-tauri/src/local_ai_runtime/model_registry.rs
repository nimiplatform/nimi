use tauri::AppHandle;

use super::store::{load_state, save_state};
use super::types::{
    now_iso_timestamp, LocalAiModelRecord, LocalAiModelStatus, LocalAiRuntimeState,
};

fn rebuild_capability_index(state: &mut LocalAiRuntimeState) {
    let mut index = std::collections::HashMap::<String, Vec<String>>::new();
    for model in &state.models {
        if model.status == LocalAiModelStatus::Removed {
            continue;
        }
        for capability in &model.capabilities {
            let normalized = capability.trim().to_ascii_lowercase();
            if normalized.is_empty() {
                continue;
            }
            let local_model_id = model.local_model_id.trim().to_string();
            if local_model_id.is_empty() {
                continue;
            }
            let bucket = index.entry(normalized).or_insert_with(Vec::new);
            if !bucket.iter().any(|item| item == &local_model_id) {
                bucket.push(local_model_id.clone());
            }
        }
    }
    state.capability_index = index;
}

fn find_model_index(state: &LocalAiRuntimeState, local_model_id: &str) -> Option<usize> {
    let normalized = local_model_id.trim().to_ascii_lowercase();
    state
        .models
        .iter()
        .position(|item| item.local_model_id.trim().to_ascii_lowercase() == normalized)
}

pub fn list_models(app: &AppHandle) -> Result<Vec<LocalAiModelRecord>, String> {
    let state = load_state(app)?;
    Ok(state.models)
}

pub fn upsert_model(
    app: &AppHandle,
    mut record: LocalAiModelRecord,
) -> Result<LocalAiModelRecord, String> {
    let mut state = load_state(app)?;
    let now = now_iso_timestamp();
    record.updated_at = now;

    if let Some(index) = find_model_index(&state, &record.local_model_id) {
        state.models[index] = record.clone();
    } else {
        state.models.push(record.clone());
    }
    rebuild_capability_index(&mut state);
    save_state(app, &state)?;
    Ok(record)
}

pub fn mark_model_status(
    app: &AppHandle,
    local_model_id: &str,
    status: LocalAiModelStatus,
    detail: Option<String>,
) -> Result<LocalAiModelRecord, String> {
    let mut state = load_state(app)?;
    let index = find_model_index(&state, local_model_id)
        .ok_or_else(|| format!("模型不存在: {local_model_id}"))?;
    let model = &mut state.models[index];
    model.status = status;
    model.updated_at = now_iso_timestamp();
    model.health_detail = detail.filter(|value| !value.trim().is_empty());
    let snapshot = model.clone();
    rebuild_capability_index(&mut state);
    save_state(app, &state)?;
    Ok(snapshot)
}

pub fn remove_model(app: &AppHandle, local_model_id: &str) -> Result<LocalAiModelRecord, String> {
    mark_model_status(
        app,
        local_model_id,
        LocalAiModelStatus::Removed,
        Some("model removed".to_string()),
    )
}

#[cfg(test)]
mod tests {
    use super::{find_model_index, rebuild_capability_index};
    use crate::local_ai_runtime::types::{
        LocalAiModelRecord, LocalAiModelSource, LocalAiModelStatus, LocalAiRuntimeState,
    };
    use std::collections::HashMap;

    fn model_fixture(
        local_model_id: &str,
        capabilities: &[&str],
        status: LocalAiModelStatus,
    ) -> LocalAiModelRecord {
        LocalAiModelRecord {
            local_model_id: local_model_id.to_string(),
            model_id: format!("hf:test/{local_model_id}"),
            capabilities: capabilities.iter().map(|value| value.to_string()).collect(),
            engine: "localai".to_string(),
            entry: "model.gguf".to_string(),
            license: "apache-2.0".to_string(),
            source: LocalAiModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc".to_string())]),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status,
            installed_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            health_detail: None,
        }
    }

    #[test]
    fn rebuild_capability_index_skips_removed_and_deduplicates() {
        let mut state = LocalAiRuntimeState {
            version: 11,
            models: vec![
                model_fixture(
                    "local:model-a",
                    &["chat", "tts"],
                    LocalAiModelStatus::Installed,
                ),
                model_fixture("local:model-b", &["chat"], LocalAiModelStatus::Active),
                model_fixture("local:model-c", &["chat"], LocalAiModelStatus::Removed),
            ],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            audits: Vec::new(),
        };

        rebuild_capability_index(&mut state);

        assert_eq!(
            state.capability_index.get("chat"),
            Some(&vec![
                "local:model-a".to_string(),
                "local:model-b".to_string()
            ]),
        );
        assert_eq!(
            state.capability_index.get("tts"),
            Some(&vec!["local:model-a".to_string()]),
        );
    }

    #[test]
    fn find_model_index_case_insensitive() {
        let state = LocalAiRuntimeState {
            version: 11,
            models: vec![model_fixture(
                "local:model-a",
                &["chat"],
                LocalAiModelStatus::Installed,
            )],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            audits: Vec::new(),
        };
        assert_eq!(find_model_index(&state, "LOCAL:Model-A"), Some(0));
    }

    #[test]
    fn find_model_index_returns_none_for_missing() {
        let state = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            audits: Vec::new(),
        };
        assert_eq!(find_model_index(&state, "local:model-a"), None);
    }

    #[test]
    fn rebuild_capability_index_skips_empty_capabilities_and_ids() {
        let mut state = LocalAiRuntimeState {
            version: 11,
            models: vec![
                model_fixture("", &["chat"], LocalAiModelStatus::Installed),
                model_fixture("local:model-a", &["", "  "], LocalAiModelStatus::Installed),
            ],
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            audits: Vec::new(),
        };
        rebuild_capability_index(&mut state);
        assert!(state.capability_index.is_empty());
    }
}
