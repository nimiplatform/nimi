const MODEL_MANIFEST_FILE_NAME: &str = "manifest.json";
const ARTIFACT_MANIFEST_FILE_NAME: &str = "artifact.manifest.json";
const SUPPORTED_ARTIFACT_KINDS: &[&str] = &[
    "vae",
    "ae",
    "llm",
    "clip",
    "controlnet",
    "lora",
    "auxiliary",
];

#[derive(Clone)]
struct OrphanBinaryCandidate {
    filename: String,
    path: String,
    size_bytes: u64,
}

fn registered_model_paths(
    models_root: &std::path::Path,
    state: &LocalAiRuntimeState,
) -> std::collections::HashSet<String> {
    state
        .models
        .iter()
        .filter_map(|m| {
            let logical_model_id = if m.logical_model_id.trim().is_empty() {
                default_logical_model_id(m.model_id.as_str())
            } else {
                m.logical_model_id.clone()
            };
            let entry = &m.entry;
            if entry.is_empty() {
                return None;
            }
            Some(
                resolved_model_dir(models_root, logical_model_id.as_str())
                    .join(entry)
                    .to_string_lossy()
                    .to_string(),
            )
        })
        .collect()
}

fn is_managed_models_subdir(path: &std::path::Path) -> bool {
    path.join(MODEL_MANIFEST_FILE_NAME).exists() || path.join(ARTIFACT_MANIFEST_FILE_NAME).exists()
}

fn is_reserved_models_root_child(path: &std::path::Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some("resolved" | "artifacts")
    )
}

fn scan_orphan_binary_candidates(
    models_root: &std::path::Path,
    registered_paths: &std::collections::HashSet<String>,
    read_dir_error_code: &str,
) -> Result<Vec<OrphanBinaryCandidate>, String> {
    let mut orphans = Vec::<OrphanBinaryCandidate>::new();
    let entries = std::fs::read_dir(models_root).map_err(|e| {
        format!("{read_dir_error_code}: cannot read models directory: {e}")
    })?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let path = entry.path();

        if path.is_file() && is_model_file_extension(&path) {
            let abs_path_str = path.to_string_lossy().to_string();
            if registered_paths.contains(&abs_path_str) {
                continue;
            }
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let size_bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            orphans.push(OrphanBinaryCandidate {
                filename,
                path: abs_path_str,
                size_bytes,
            });
        } else if path.is_dir() {
            if is_reserved_models_root_child(&path) || is_managed_models_subdir(&path) {
                continue;
            }
            let sub_entries = match std::fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for sub_entry in sub_entries {
                let sub_entry = match sub_entry {
                    Ok(entry) => entry,
                    Err(_) => continue,
                };
                let sub_path = sub_entry.path();
                if sub_path.is_file() && is_model_file_extension(&sub_path) {
                    let abs_path_str = sub_path.to_string_lossy().to_string();
                    if registered_paths.contains(&abs_path_str) {
                        continue;
                    }
                    let filename = sub_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let size_bytes =
                        std::fs::metadata(&sub_path).map(|m| m.len()).unwrap_or(0);
                    orphans.push(OrphanBinaryCandidate {
                        filename,
                        path: abs_path_str,
                        size_bytes,
                    });
                }
            }
        }
    }
    orphans.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(orphans)
}

fn scan_orphan_artifact_files(app: &AppHandle) -> Result<Vec<OrphanArtifactFile>, String> {
    let models_root = runtime_models_dir(app)?;
    let state = load_state(app)?;
    let registered_paths = registered_model_paths(&models_root, &state);
    scan_orphan_binary_candidates(
        &models_root,
        &registered_paths,
        "LOCAL_AI_ARTIFACT_ORPHAN_SCAN_READ_DIR_FAILED",
    )
    .map(|items| {
        items
            .into_iter()
            .map(|item| OrphanArtifactFile {
                filename: item.filename,
                path: item.path,
                size_bytes: item.size_bytes,
            })
            .collect()
    })
}

fn normalize_artifact_kind(raw: &str) -> Result<String, String> {
    let normalized = raw.trim().to_ascii_lowercase();
    if SUPPORTED_ARTIFACT_KINDS.contains(&normalized.as_str()) {
        return Ok(normalized);
    }
    Err(format!(
        "LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID: unsupported kind {raw:?}"
    ))
}

fn source_is_already_in_target_dir(
    source_path: &std::path::Path,
    target_dir: &std::path::Path,
) -> bool {
    let Ok(source_canonical) = source_path.canonicalize() else {
        return false;
    };
    let Ok(target_canonical) = target_dir.canonicalize() else {
        return false;
    };
    source_canonical
        .parent()
        .map(|parent| parent == target_canonical)
        .unwrap_or(false)
}

fn resolve_orphan_artifact_slug(
    models_root: &std::path::Path,
    base_slug: &str,
    source_path: &std::path::Path,
) -> Result<String, String> {
    for index in 0..1024usize {
        let candidate = if index == 0 {
            base_slug.to_string()
        } else {
            format!("{base_slug}-{}", index + 1)
        };
        let candidate_dir = artifact_dir(models_root, &format!("local-import/{candidate}"));
        if !candidate_dir.exists() || source_is_already_in_target_dir(source_path, &candidate_dir) {
            return Ok(candidate);
        }
    }
    Err("LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS: no available artifact directory".to_string())
}

fn scaffold_orphan_artifact_file(
    models_root: &std::path::Path,
    source_path: &std::path::Path,
    kind: &str,
    engine_override: Option<&str>,
) -> Result<LocalAiScaffoldArtifactResult, String> {
    if !source_path.is_file() {
        return Err(format!(
            "LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND: file does not exist: {}",
            source_path.display()
        ));
    }

    let normalized_kind = normalize_artifact_kind(kind)?;
    let file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact")
        .to_string();
    let artifact_name = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact")
        .to_string();
    let base_slug = slugify_local_model_id(&format!(
        "local-import/{}-{}",
        artifact_name, normalized_kind
    ));
    let artifact_slug = resolve_orphan_artifact_slug(models_root, &base_slug, source_path)?;
    let artifact_id = format!("local-import/{artifact_slug}");
    let target_dir = artifact_dir(models_root, artifact_id.as_str());
    std::fs::create_dir_all(&target_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ARTIFACT_ORPHAN_DIR_FAILED: cannot create artifact directory: {error}"
        )
    })?;
    let dest_file = target_dir.join(&file_name);

    let _file_size = std::fs::metadata(source_path)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let in_place = source_is_already_in_target_dir(source_path, &target_dir)
        && dest_file.exists()
        && dest_file
            .canonicalize()
            .ok()
            .zip(source_path.canonicalize().ok())
            .map(|(left, right)| left == right)
            .unwrap_or(false);
    if !in_place && dest_file.exists() {
        return Err(format!(
            "LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS: target file already exists: {}",
            dest_file.display()
        ));
    }

    if !in_place {
        match std::fs::rename(source_path, &dest_file) {
            Ok(_) => {}
            Err(_) => {
                let source_file = std::fs::File::open(source_path).map_err(|error| {
                    format!(
                        "LOCAL_AI_ARTIFACT_ORPHAN_READ_FAILED: cannot open source file: {error}"
                    )
                })?;
                copy_file_with_progress(source_file, &dest_file, |_| {}).map_err(|error| {
                    format!(
                        "LOCAL_AI_ARTIFACT_ORPHAN_MOVE_FAILED: cannot stage artifact file: {error}"
                    )
                })?;
                std::fs::remove_file(source_path).map_err(|error| {
                    let _ = std::fs::remove_file(&dest_file);
                    format!(
                        "LOCAL_AI_ARTIFACT_ORPHAN_SOURCE_CLEANUP_FAILED: cannot remove source file after copy: {error}"
                    )
                })?;
            }
        }
    }

    let artifact_engine = match normalized_kind.as_str() {
        "vae" | "ae" | "clip" | "controlnet" | "lora" => "media",
        "llm" => "llama",
        _ => "",
    };
    let resolved_engine = engine_override
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            if artifact_engine.is_empty() {
                None
            } else {
                Some(artifact_engine.to_string())
            }
        })
        .ok_or_else(|| {
            "LOCAL_AI_ARTIFACT_ORPHAN_ENGINE_REQUIRED: engine is required for this artifact kind"
                .to_string()
        })?;

    let manifest_path = target_dir.join(ARTIFACT_MANIFEST_FILE_NAME);
    let manifest = serde_json::json!({
        "artifactId": artifact_id,
        "kind": normalized_kind,
        "engine": resolved_engine,
        "entry": file_name,
        "files": [file_name],
        "license": "unknown",
        "source": {
            "repo": artifact_id,
            "revision": "local"
        },
        "integrity_mode": "local_unverified",
        "hashes": {},
    });
    let serialized = serde_json::to_string_pretty(&manifest).map_err(|error| {
        format!("LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_SERIALIZE_FAILED: {error}")
    })?;
    std::fs::write(&manifest_path, serialized).map_err(|error| {
        format!("LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_WRITE_FAILED: {error}")
    })?;

    Ok(LocalAiScaffoldArtifactResult {
        manifest_path: manifest_path.to_string_lossy().to_string(),
        artifact_id,
        kind: normalized_kind,
    })
}

#[tauri::command]
pub fn runtime_local_artifacts_scan_orphans(
    app: AppHandle,
) -> Result<Vec<OrphanArtifactFile>, String> {
    scan_orphan_artifact_files(&app)
}

#[tauri::command]
pub async fn runtime_local_artifacts_scaffold_orphan(
    app: AppHandle,
    payload: LocalAiScaffoldArtifactPayload,
) -> Result<LocalAiScaffoldArtifactResult, String> {
    let models_root = runtime_models_dir(&app)?;
    let source_path = std::path::PathBuf::from(&payload.path);
    let kind = payload.kind;
    let engine = payload.engine;
    tauri::async_runtime::spawn_blocking(move || {
        scaffold_orphan_artifact_file(&models_root, &source_path, kind.as_str(), engine.as_deref())
    })
    .await
    .map_err(|error| format!("LOCAL_AI_ARTIFACT_ORPHAN_TASK_FAILED: {error}"))?
}

#[cfg(test)]
mod orphan_tests {
    use super::{
        registered_model_paths, scan_orphan_binary_candidates, scaffold_orphan_artifact_file,
    };
    use crate::local_runtime::types::{
        LocalAiIntegrityMode, LocalAiModelRecord, LocalAiModelSource, LocalAiModelStatus,
        LocalAiRuntimeState,
    };
    use std::collections::HashMap;
    use std::fs;

    fn model_fixture(model_id: &str, entry: &str) -> LocalAiModelRecord {
        LocalAiModelRecord {
            local_model_id: format!("local-{model_id}"),
            model_id: model_id.to_string(),
            logical_model_id: format!("nimi/{model_id}"),
            capabilities: vec!["chat".to_string()],
            engine: "llama".to_string(),
            entry: entry.to_string(),
            files: vec![entry.to_string()],
            license: "apache-2.0".to_string(),
            source: LocalAiModelSource {
                repo: "hf://fixture/model".to_string(),
                revision: "main".to_string(),
            },
            integrity_mode: Some(LocalAiIntegrityMode::Verified),
            hashes: HashMap::from([(entry.to_string(), "sha256:fixture".to_string())]),
            tags: Vec::new(),
            known_total_size_bytes: Some(1_024),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status: LocalAiModelStatus::Installed,
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

    #[test]
    fn scan_orphan_binary_candidates_skips_manifest_managed_directories() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let models_root = tmp.path();
        let loose = models_root.join("loose.safetensors");
        fs::write(&loose, b"loose").expect("write loose");

        let managed_model_dir = models_root.join("resolved").join("nimi").join("managed-model");
        fs::create_dir_all(&managed_model_dir).expect("create managed model dir");
        fs::write(managed_model_dir.join("manifest.json"), "{}").expect("write model manifest");
        fs::write(managed_model_dir.join("managed.gguf"), b"model").expect("write managed model");

        let managed_artifact_dir = models_root.join("managed-artifact");
        fs::create_dir_all(&managed_artifact_dir).expect("create managed artifact dir");
        fs::write(managed_artifact_dir.join("artifact.manifest.json"), "{}").expect("write artifact manifest");
        fs::write(managed_artifact_dir.join("managed.safetensors"), b"artifact")
            .expect("write managed artifact");

        let unmanaged_dir = models_root.join("unmanaged");
        fs::create_dir_all(&unmanaged_dir).expect("create unmanaged dir");
        fs::write(unmanaged_dir.join("raw.bin"), b"raw").expect("write unmanaged raw");

        let registered_model = model_fixture("local/test-model", "registered.gguf");
        let registered_dir = crate::local_runtime::types::resolved_model_dir(
            models_root,
            registered_model.logical_model_id.as_str(),
        );
        fs::create_dir_all(&registered_dir).expect("create registered dir");
        let registered_path = registered_dir.join("registered.gguf");
        fs::write(&registered_path, b"registered").expect("write registered file");

        let state = LocalAiRuntimeState {
            models: vec![registered_model],
            ..LocalAiRuntimeState::default()
        };
        let registered_paths = registered_model_paths(models_root, &state);
        let scanned = scan_orphan_binary_candidates(
            models_root,
            &registered_paths,
            "LOCAL_AI_TEST_ORPHAN_SCAN_FAILED",
        )
        .expect("scan candidates");

        let filenames = scanned
            .iter()
            .map(|item| item.filename.as_str())
            .collect::<Vec<_>>();
        assert_eq!(filenames, vec!["loose.safetensors", "raw.bin"]);
    }

    #[test]
    fn scaffold_orphan_artifact_file_writes_manifest_and_moves_source() {
        let models_root = tempfile::tempdir().expect("models tempdir");
        let source_root = tempfile::tempdir().expect("source tempdir");
        let source_path = source_root.path().join("companion.safetensors");
        fs::write(&source_path, b"artifact-bytes").expect("write source artifact");

        let result = scaffold_orphan_artifact_file(models_root.path(), &source_path, "vae", None)
            .expect("scaffold artifact");
        assert_eq!(result.kind, "vae");
        assert!(result.artifact_id.starts_with("local-import/"));
        assert!(
            result
                .manifest_path
                .starts_with(models_root.path().to_string_lossy().as_ref())
        );
        assert!(!source_path.exists(), "source file should be moved or cleaned");

        let manifest_raw = fs::read_to_string(&result.manifest_path).expect("read manifest");
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest_raw).expect("parse manifest");
        assert_eq!(manifest["artifactId"], result.artifact_id);
        assert_eq!(manifest["kind"], "vae");
        assert_eq!(manifest["engine"], "media");
        assert_eq!(manifest["entry"], "companion.safetensors");
        assert_eq!(
            manifest["files"],
            serde_json::json!(["companion.safetensors"])
        );
        assert_eq!(
            manifest["source"],
            serde_json::json!({
                "repo": result.artifact_id,
                "revision": "local",
            })
        );
        assert_eq!(manifest["integrity_mode"], "local_unverified");
        assert_eq!(manifest["hashes"], serde_json::json!({}));

        let manifest_path = std::path::PathBuf::from(&result.manifest_path);
        let target_file = manifest_path
            .parent()
            .expect("manifest parent")
            .join("companion.safetensors");
        assert!(target_file.exists(), "artifact payload should be staged with manifest");
    }
}
