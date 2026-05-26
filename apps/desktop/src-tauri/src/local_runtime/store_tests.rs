use super::{load_state_from_path, save_state_to_path};
use crate::local_runtime::types::{
    LocalAiAssetKind, LocalAiAssetRecord, LocalAiAssetSource, LocalAiAssetStatus,
    LocalAiDownloadSessionRecord, LocalAiDownloadState, LocalAiInstallRequest,
    LocalAiIntegrityMode, LocalAiProfileApplyProgressEvent, LocalAiRuntimeState,
    LocalAiTransferSessionKind,
};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("nimi-store-{prefix}-{nanos}"));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("create temp dir");
    path
}

fn model_fixture(local_asset_id: &str) -> LocalAiAssetRecord {
    LocalAiAssetRecord {
        local_asset_id: local_asset_id.to_string(),
        asset_id: format!("hf:test/{local_asset_id}"),
        kind: LocalAiAssetKind::Chat,
        logical_model_id: format!("nimi/{local_asset_id}"),
        capabilities: vec!["chat".to_string()],
        engine: "llama".to_string(),
        entry: "model.gguf".to_string(),
        files: vec!["model.gguf".to_string()],
        license: "apache-2.0".to_string(),
        source: LocalAiAssetSource {
            repo: "hf://test/model".to_string(),
            revision: "main".to_string(),
        },
        integrity_mode: Some(LocalAiIntegrityMode::Verified),
        hashes: HashMap::from([("model.gguf".to_string(), "sha256:abc".to_string())]),
        tags: Vec::new(),
        known_total_size_bytes: Some(1_024),
        endpoint: "http://127.0.0.1:1234/v1".to_string(),
        status: LocalAiAssetStatus::Installed,
        installed_at: "2026-01-01T00:00:00.000Z".to_string(),
        updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        health_detail: None,
        artifact_roles: vec!["llm".to_string(), "tokenizer".to_string()],
        preferred_engine: Some("llama".to_string()),
        fallback_engines: Vec::new(),
        engine_config: None,
        recommendation: None,
        metadata: None,
    }
}

fn asset_fixture(local_asset_id: &str) -> LocalAiAssetRecord {
    LocalAiAssetRecord {
        local_asset_id: local_asset_id.to_string(),
        asset_id: format!("local:test/{local_asset_id}"),
        kind: LocalAiAssetKind::Vae,
        logical_model_id: String::new(),
        capabilities: Vec::new(),
        engine: "media".to_string(),
        entry: "vae.safetensors".to_string(),
        files: vec!["vae.safetensors".to_string()],
        license: "apache-2.0".to_string(),
        source: LocalAiAssetSource {
            repo: "hf://test/asset".to_string(),
            revision: "main".to_string(),
        },
        integrity_mode: Some(LocalAiIntegrityMode::Verified),
        hashes: HashMap::from([("vae.safetensors".to_string(), "sha256:def".to_string())]),
        tags: Vec::new(),
        known_total_size_bytes: None,
        endpoint: String::new(),
        status: LocalAiAssetStatus::Installed,
        installed_at: "2026-01-01T00:00:00.000Z".to_string(),
        updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        health_detail: None,
        artifact_roles: Vec::new(),
        preferred_engine: None,
        fallback_engines: Vec::new(),
        engine_config: None,
        recommendation: None,
        metadata: Some(serde_json::json!({
            "slot": "vae_path",
        })),
    }
}

fn download_fixture(
    install_session_id: &str,
    phase: &str,
    state: LocalAiDownloadState,
    bytes_received: u64,
    updated_at: &str,
) -> LocalAiDownloadSessionRecord {
    LocalAiDownloadSessionRecord {
        install_session_id: install_session_id.to_string(),
        model_id: "hf:test/model".to_string(),
        local_model_id: "hf:test-model".to_string(),
        session_kind: LocalAiTransferSessionKind::Download,
        request: LocalAiInstallRequest {
            model_id: "hf:test/model".to_string(),
            repo: "test/model".to_string(),
            revision: Some("main".to_string()),
            capabilities: Some(vec!["chat".to_string()]),
            engine: Some("llama-cpp".to_string()),
            entry: Some("model.gguf".to_string()),
            files: Some(vec!["model.gguf".to_string()]),
            license: Some("apache-2.0".to_string()),
            hashes: Some(HashMap::from([(
                "model.gguf".to_string(),
                "sha256:abc".to_string(),
            )])),
            endpoint: Some("http://127.0.0.1:1234/v1".to_string()),
            provider_hints: None,
            engine_config: None,
        },
        install_metadata: None,
        phase: phase.to_string(),
        state,
        bytes_received,
        bytes_total: Some(4_710_000_000),
        speed_bytes_per_sec: Some(12_345.0),
        eta_seconds: Some(42.0),
        message: Some("progress".to_string()),
        reason_code: None,
        retryable: true,
        created_at: "2026-01-01T00:00:00.000Z".to_string(),
        updated_at: updated_at.to_string(),
    }
}

fn profile_apply_fixture(index: usize) -> LocalAiProfileApplyProgressEvent {
    LocalAiProfileApplyProgressEvent {
        apply_session_id: format!("apply-{index:03}"),
        plan_id: "plan".to_string(),
        target_id: "mod".to_string(),
        profile_id: "profile".to_string(),
        phase: "complete".to_string(),
        status: "completed".to_string(),
        occurred_at: format!(
            "2026-01-01T{:02}:{:02}:{:02}.000Z",
            index / 3600,
            (index / 60) % 60,
            index % 60
        ),
        message: None,
        error: None,
        reason_code: None,
        rollback_applied: None,
        result: None,
    }
}

#[test]
fn save_and_load_state_roundtrip() {
    let temp = unique_temp_dir("roundtrip");
    let state_path = temp.join("state.json");
    let state = LocalAiRuntimeState {
        version: 11,
        assets: vec![model_fixture("model-a"), model_fixture("model-b")],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: Vec::new(),
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };
    save_state_to_path(&state_path, &state).expect("save state");
    let loaded = load_state_from_path(&state_path).expect("load state");
    assert_eq!(loaded.version, state.version);
    assert_eq!(loaded.assets.len(), 2);
    assert_eq!(loaded.assets[0].local_asset_id, "model-a");
    assert_eq!(loaded.assets[1].local_asset_id, "model-b");
    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn save_state_persists_single_assets_array() {
    let temp = unique_temp_dir("assets-array");
    let state_path = temp.join("state.json");
    let state = LocalAiRuntimeState {
        version: 11,
        assets: vec![model_fixture("model-a"), asset_fixture("asset-a")],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: Vec::new(),
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };

    save_state_to_path(&state_path, &state).expect("save state");
    let raw = fs::read_to_string(&state_path).expect("read state");
    let parsed = serde_json::from_str::<serde_json::Value>(&raw).expect("parse state json");

    assert!(parsed.get("models").is_none());
    assert!(parsed.get("artifacts").is_none());
    let assets = parsed
        .get("assets")
        .and_then(|value| value.as_array())
        .expect("assets array");
    assert_eq!(assets.len(), 2);
    assert_eq!(assets[0]["localAssetId"], "model-a");
    assert_eq!(assets[0]["kind"], "chat");
    assert_eq!(assets[0]["logicalModelId"], "nimi/model-a");
    assert_eq!(assets[1]["localAssetId"], "asset-a");
    assert_eq!(assets[1]["kind"], "vae");

    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn save_state_atomic_leaves_no_temp_file() {
    let temp = unique_temp_dir("atomic");
    let state_path = temp.join("state.json");
    let state = LocalAiRuntimeState::default();
    save_state_to_path(&state_path, &state).expect("save state");
    let temp_file = state_path.with_extension("json.tmp");
    assert!(!temp_file.exists(), "temp file should be cleaned up");
    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn load_state_returns_default_when_file_missing() {
    let temp = unique_temp_dir("missing");
    let state_path = temp.join("nonexistent.json");
    let state = load_state_from_path(&state_path).expect("default state");
    assert_eq!(state.version, LocalAiRuntimeState::default().version);
    assert!(state.assets.is_empty());
    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn load_state_rejects_invalid_json() {
    let temp = unique_temp_dir("invalid");
    let state_path = temp.join("state.json");
    fs::write(&state_path, "not json").expect("write invalid json");
    let result = load_state_from_path(&state_path);
    assert!(result.is_err());
    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn load_state_rejects_legacy_models_artifacts_payload() {
    let temp = unique_temp_dir("legacy-reject");
    let state_path = temp.join("state.json");
    fs::write(
        &state_path,
        serde_json::json!({
            "version": 11,
            "models": [{
                "localModelId": "legacy-model",
                "modelId": "local/z_image_turbo",
                "logicalModelId": "nimi/legacy-model",
                "capabilities": ["image"],
                "engine": "localai",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "apache-2.0",
                "source": {
                    "repo": "hf://test/model",
                    "revision": "main"
                },
                "hashes": {
                    "model.gguf": "sha256:abc"
                },
                "status": "installed",
                "installedAt": "2026-01-01T00:00:00.000Z",
                "updatedAt": "2026-01-01T00:00:00.000Z"
            }],
            "artifacts": []
        })
        .to_string(),
    )
    .expect("write legacy state");

    let error = load_state_from_path(&state_path).expect_err("legacy state should fail");
    assert!(error.contains("LOCAL_AI_LEGACY_RUNTIME_STATE_UNSUPPORTED"));
    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn load_state_accepts_assets_only_payload() {
    let temp = unique_temp_dir("assets-only");
    let state_path = temp.join("state.json");
    fs::write(
        &state_path,
        serde_json::json!({
            "version": 11,
            "assets": [
                {
                    "localAssetId": "model-a",
                    "assetId": "hf:test/model-a",
                    "kind": "chat",
                    "logicalModelId": "nimi/model-a",
                    "capabilities": ["chat"],
                    "engine": "llama",
                    "entry": "model.gguf",
                    "files": ["model.gguf"],
                    "license": "apache-2.0",
                    "source": {
                        "repo": "hf://test/model",
                        "revision": "main"
                    },
                    "integrityMode": "verified",
                    "hashes": {
                        "model.gguf": "sha256:abc"
                    },
                    "tags": [],
                    "knownTotalSizeBytes": 1024,
                    "endpoint": "http://127.0.0.1:1234/v1",
                    "status": "installed",
                    "installedAt": "2026-01-01T00:00:00.000Z",
                    "updatedAt": "2026-01-01T00:00:00.000Z",
                    "artifactRoles": ["llm", "tokenizer"],
                    "preferredEngine": "llama",
                    "fallbackEngines": []
                },
                {
                    "localAssetId": "asset-a",
                    "assetId": "local:test/asset-a",
                    "kind": "vae",
                    "engine": "media",
                    "entry": "vae.safetensors",
                    "files": ["vae.safetensors"],
                    "license": "apache-2.0",
                    "source": {
                        "repo": "hf://test/asset",
                        "revision": "main"
                    },
                    "integrityMode": "verified",
                    "hashes": {
                        "vae.safetensors": "sha256:def"
                    },
                    "status": "installed",
                    "installedAt": "2026-01-01T00:00:00.000Z",
                    "updatedAt": "2026-01-01T00:00:00.000Z",
                    "metadata": {
                        "slot": "vae_path"
                    }
                }
            ]
        })
        .to_string(),
    )
    .expect("write assets-only state");

    let loaded = load_state_from_path(&state_path).expect("load state");

    assert_eq!(loaded.assets.len(), 2);
    assert_eq!(loaded.assets[0].local_asset_id, "model-a");
    assert_eq!(loaded.assets[0].artifact_roles, vec!["llm", "tokenizer"]);
    assert_eq!(loaded.assets[1].local_asset_id, "asset-a");
    assert_eq!(loaded.assets[1].kind, LocalAiAssetKind::Vae);

    let _ = fs::remove_dir_all(&temp);
}

#[test]
fn merge_state_for_save_preserves_downloads_missing_from_incoming_state() {
    let current = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: vec![download_fixture(
            "install-1",
            "verify",
            LocalAiDownloadState::Running,
            4_600_000_000,
            "2026-01-01T00:00:05.000Z",
        )],
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };
    let incoming = LocalAiRuntimeState {
        version: 11,
        assets: vec![model_fixture("model-a")],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: Vec::new(),
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };

    let merged = super::merge_state_for_save(&current, &incoming);

    assert_eq!(merged.assets.len(), 1);
    assert_eq!(merged.downloads.len(), 1);
    assert_eq!(merged.downloads[0].install_session_id, "install-1");
    assert_eq!(merged.downloads[0].phase, "verify");
}

#[test]
fn merge_state_for_save_prefers_newer_download_record() {
    let current = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: vec![download_fixture(
            "install-1",
            "verify",
            LocalAiDownloadState::Running,
            4_600_000_000,
            "2026-01-01T00:00:05.000Z",
        )],
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };
    let incoming = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: vec![download_fixture(
            "install-1",
            "download",
            LocalAiDownloadState::Running,
            1_000_000,
            "2026-01-01T00:00:03.000Z",
        )],
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };

    let merged = super::merge_state_for_save(&current, &incoming);

    assert_eq!(merged.downloads.len(), 1);
    assert_eq!(merged.downloads[0].phase, "verify");
    assert_eq!(merged.downloads[0].bytes_received, 4_600_000_000);
}

#[test]
fn merge_state_for_save_breaks_same_timestamp_ties_with_progress() {
    let current = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: vec![download_fixture(
            "install-1",
            "verify",
            LocalAiDownloadState::Running,
            4_600_000_000,
            "2026-01-01T00:00:05.000Z",
        )],
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };
    let incoming = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: vec![download_fixture(
            "install-1",
            "download",
            LocalAiDownloadState::Running,
            1_000_000,
            "2026-01-01T00:00:05.000Z",
        )],
        profile_apply_sessions: Vec::new(),
        audits: Vec::new(),
    };

    let merged = super::merge_state_for_save(&current, &incoming);

    assert_eq!(merged.downloads.len(), 1);
    assert_eq!(merged.downloads[0].phase, "verify");
    assert_eq!(merged.downloads[0].bytes_received, 4_600_000_000);
}

#[test]
fn merge_state_for_save_caps_profile_apply_sessions_to_recent_records() {
    let current = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: Vec::new(),
        profile_apply_sessions: (0..520).map(profile_apply_fixture).collect(),
        audits: Vec::new(),
    };
    let incoming = LocalAiRuntimeState {
        version: 11,
        assets: vec![],
        capability_index: HashMap::new(),
        capability_matrix: Vec::new(),
        services: Vec::new(),
        downloads: Vec::new(),
        profile_apply_sessions: vec![profile_apply_fixture(520)],
        audits: Vec::new(),
    };

    let merged = super::merge_state_for_save(&current, &incoming);

    assert_eq!(
        merged.profile_apply_sessions.len(),
        super::PROFILE_APPLY_SESSION_RETENTION_LIMIT
    );
    assert_eq!(
        merged
            .profile_apply_sessions
            .first()
            .unwrap()
            .apply_session_id,
        "apply-021"
    );
    assert_eq!(
        merged
            .profile_apply_sessions
            .last()
            .unwrap()
            .apply_session_id,
        "apply-520"
    );
}
