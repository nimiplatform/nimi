use tauri::AppHandle;

use super::device_profile::collect_device_profile;
use super::recommendation::{
    build_catalog_recommendation, build_recommendation_candidate, RecommendationCandidate,
};
use super::store::{load_state, runtime_models_dir, save_state};
use super::types::{
    default_logical_model_id, normalize_local_inventory_id, now_iso_timestamp, resolved_model_dir,
    LocalAiModelRecord, LocalAiModelStatus, LocalAiRuntimeState,
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
            let bucket = index.entry(normalized).or_default();
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

fn find_model_identity_index(
    state: &LocalAiRuntimeState,
    model_id: &str,
    engine: &str,
) -> Option<usize> {
    let model_id = normalize_local_inventory_id(model_id);
    let engine = engine.trim();
    state.models.iter().position(|item| {
        normalize_local_inventory_id(item.model_id.as_str()) == model_id
            && item.engine.trim().eq_ignore_ascii_case(engine)
    })
}

fn normalize_record_files(record: &LocalAiModelRecord) -> Vec<String> {
    let mut files = record
        .files
        .iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if files.is_empty() {
        let entry = record.entry.trim();
        if !entry.is_empty() {
            files.push(entry.to_string());
        }
    }
    files.sort();
    files.dedup();
    files
}

fn build_recommendation_candidate_for_record(
    record: &LocalAiModelRecord,
    models_root: Option<&std::path::Path>,
) -> Option<RecommendationCandidate> {
    let files = normalize_record_files(record);
    let has_complete_record_metadata = !record.files.is_empty();
    let logical_model_id = if record.logical_model_id.trim().is_empty() {
        default_logical_model_id(record.model_id.as_str())
    } else {
        record.logical_model_id.clone()
    };
    let model_dir = models_root.map(|root| resolved_model_dir(root, logical_model_id.as_str()));
    let file_size = |relative_path: &str| -> Option<u64> {
        let root = model_dir.as_ref()?;
        std::fs::metadata(root.join(relative_path))
            .ok()
            .map(|meta| meta.len())
    };

    let main_size_bytes = if has_complete_record_metadata {
        file_size(record.entry.as_str())
    } else {
        None
    };
    let known_total_size_bytes = record
        .known_total_size_bytes
        .filter(|value| *value > 0)
        .or_else(|| {
            if has_complete_record_metadata {
                let mut total = 0_u64;
                let mut seen_any = false;
                for file in &files {
                    let size = file_size(file.as_str())?;
                    total = total.saturating_add(size);
                    seen_any = true;
                }
                if seen_any {
                    Some(total)
                } else {
                    None
                }
            } else {
                file_size(record.entry.as_str())
            }
        });
    let fallback_entries = if has_complete_record_metadata {
        files
            .iter()
            .filter(|file| *file != &record.entry)
            .cloned()
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    build_recommendation_candidate(
        record.model_id.as_str(),
        record.source.repo.as_str(),
        record.model_id.as_str(),
        record.capabilities.as_slice(),
        record.engine.as_str(),
        Some(record.entry.as_str()),
        main_size_bytes,
        known_total_size_bytes,
        fallback_entries,
        record.tags.as_slice(),
    )
}

pub fn list_models(app: &AppHandle) -> Result<Vec<LocalAiModelRecord>, String> {
    let state = load_state(app)?;
    let profile = collect_device_profile(app);
    let models_root = runtime_models_dir(app).ok();
    Ok(state
        .models
        .into_iter()
        .map(|mut record| {
            record.recommendation =
                build_recommendation_candidate_for_record(&record, models_root.as_deref())
                    .and_then(|candidate| build_catalog_recommendation(&candidate, &profile));
            record
        })
        .collect())
}

pub fn upsert_model(
    app: &AppHandle,
    mut record: LocalAiModelRecord,
) -> Result<LocalAiModelRecord, String> {
    let mut state = load_state(app)?;
    let now = now_iso_timestamp();
    record.model_id = normalize_local_inventory_id(record.model_id.as_str());
    record.updated_at = now;

    if let Some(index) = find_model_index(&state, &record.local_model_id) {
        state.models[index] = record.clone();
    } else if let Some(index) = find_model_identity_index(&state, &record.model_id, &record.engine)
    {
        record.local_model_id = state.models[index].local_model_id.clone();
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
    use super::{
        build_recommendation_candidate_for_record, find_model_index, rebuild_capability_index,
    };
    use crate::local_runtime::recommendation::build_catalog_recommendation;
    use crate::local_runtime::types::{
        LocalAiDeviceProfile, LocalAiGpuProfile, LocalAiMemoryModel, LocalAiModelRecord,
        LocalAiModelSource, LocalAiModelStatus, LocalAiNpuProfile, LocalAiPythonProfile,
        LocalAiRuntimeState,
    };
    use std::collections::HashMap;
    use std::fs;

    fn model_fixture(
        local_model_id: &str,
        capabilities: &[&str],
        status: LocalAiModelStatus,
    ) -> LocalAiModelRecord {
        LocalAiModelRecord {
            local_model_id: local_model_id.to_string(),
            model_id: format!("hf:test/{local_model_id}"),
            logical_model_id: format!("nimi/{local_model_id}"),
            capabilities: capabilities.iter().map(|value| value.to_string()).collect(),
            engine: "llama".to_string(),
            entry: "model.gguf".to_string(),
            files: vec!["model.gguf".to_string()],
            license: "apache-2.0".to_string(),
            source: LocalAiModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc".to_string())]),
            tags: Vec::new(),
            known_total_size_bytes: Some(4_294_967_296),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status,
            installed_at: "2026-01-01T00:00:00.000Z".to_string(),
            updated_at: "2026-01-01T00:00:00.000Z".to_string(),
            health_detail: None,
            artifact_roles: vec!["llm".to_string(), "tokenizer".to_string()],
            preferred_engine: Some("llama".to_string()),
            fallback_engines: Vec::new(),
            engine_config: None,
            recommendation: None,
        }
    }

    fn profile_fixture() -> LocalAiDeviceProfile {
        LocalAiDeviceProfile {
            os: "linux".to_string(),
            arch: "amd64".to_string(),
            total_ram_bytes: 32 * 1024 * 1024 * 1024,
            available_ram_bytes: 24 * 1024 * 1024 * 1024,
            gpu: LocalAiGpuProfile {
                available: true,
                vendor: Some("nvidia".to_string()),
                model: Some("RTX".to_string()),
                total_vram_bytes: Some(12 * 1024 * 1024 * 1024),
                available_vram_bytes: Some(10 * 1024 * 1024 * 1024),
                memory_model: LocalAiMemoryModel::Discrete,
            },
            python: LocalAiPythonProfile {
                available: true,
                version: Some("3.11.0".to_string()),
            },
            npu: LocalAiNpuProfile {
                available: false,
                ready: false,
                vendor: None,
                runtime: None,
                detail: None,
            },
            disk_free_bytes: 0,
            ports: Vec::new(),
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
            artifacts: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
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
            artifacts: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
            audits: Vec::new(),
        };
        assert_eq!(find_model_index(&state, "LOCAL:Model-A"), Some(0));
    }

    #[test]
    fn find_model_index_returns_none_for_missing() {
        let state = LocalAiRuntimeState {
            version: 11,
            models: vec![],
            artifacts: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
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
            artifacts: Vec::new(),
            capability_index: HashMap::new(),
            capability_matrix: Vec::new(),
            services: Vec::new(),
            downloads: Vec::new(),
            audits: Vec::new(),
        };
        rebuild_capability_index(&mut state);
        assert!(state.capability_index.is_empty());
    }

    #[test]
    fn recommendation_candidate_for_complete_record_matches_install_inputs() {
        let temp = tempfile::tempdir().expect("tempdir");
        let record = model_fixture("local:z-image", &["image"], LocalAiModelStatus::Installed);
        let model_dir = crate::local_runtime::types::resolved_model_dir(
            temp.path(),
            record.logical_model_id.as_str(),
        );
        fs::create_dir_all(&model_dir).expect("create model dir");
        fs::write(model_dir.join("model.gguf"), vec![0_u8; 1024]).expect("write model");

        let candidate = build_recommendation_candidate_for_record(&record, Some(temp.path()))
            .expect("candidate");
        let recommendation =
            build_catalog_recommendation(&candidate, &profile_fixture()).expect("recommendation");

        assert_eq!(candidate.main_size_bytes, Some(1024));
        assert_eq!(candidate.known_total_size_bytes, Some(4_294_967_296));
        assert_eq!(candidate.fallback_entries, Vec::<String>::new());
        assert!(recommendation.confidence.is_some());
    }

    #[test]
    fn legacy_record_candidate_degrades_without_files_metadata() {
        let temp = tempfile::tempdir().expect("tempdir");
        let mut record = model_fixture(
            "local:z-image-legacy",
            &["image"],
            LocalAiModelStatus::Installed,
        );
        record.files = Vec::new();
        record.tags = Vec::new();
        record.known_total_size_bytes = None;
        let model_dir = crate::local_runtime::types::resolved_model_dir(
            temp.path(),
            record.logical_model_id.as_str(),
        );
        fs::create_dir_all(&model_dir).expect("create model dir");
        fs::write(model_dir.join("model.gguf"), vec![0_u8; 1024]).expect("write model");

        let candidate = build_recommendation_candidate_for_record(&record, Some(temp.path()))
            .expect("candidate");

        assert_eq!(candidate.main_size_bytes, None);
        assert_eq!(candidate.known_total_size_bytes, Some(1024));
        assert_eq!(candidate.fallback_entries, Vec::<String>::new());
    }
}
