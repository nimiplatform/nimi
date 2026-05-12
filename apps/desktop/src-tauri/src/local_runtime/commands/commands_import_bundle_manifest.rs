use super::*;

pub(super) struct ManifestReplaceGuard {
    manifest_path: std::path::PathBuf,
    backup_path: Option<std::path::PathBuf>,
}

fn encode_manifest_json(manifest: &JsonValue) -> Result<Vec<u8>, String> {
    serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ENCODE_FAILED: {error}"))
}

pub(super) fn write_manifest_json(
    path: &std::path::Path,
    manifest: &JsonValue,
) -> Result<(), String> {
    let encoded = encode_manifest_json(manifest)?;
    write_manifest_bytes_atomic(path, &encoded)
}

fn write_manifest_bytes_atomic(path: &std::path::Path, encoded: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot create manifest parent {}: {error}",
                parent.display()
            )
        })?;
    }
    let temp_path = unique_sibling_path(path, "tmp")?;
    let write_result = (|| {
        std::fs::write(&temp_path, encoded).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot write temporary asset manifest {}: {error}",
                temp_path.display()
            )
        })?;
        std::fs::rename(&temp_path, path).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot commit asset manifest {} -> {}: {error}",
                temp_path.display(),
                path.display()
            )
        })
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result
}

pub(super) fn write_manifest_json_with_rollback(
    path: &std::path::Path,
    manifest: &JsonValue,
) -> Result<ManifestReplaceGuard, String> {
    let encoded = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ENCODE_FAILED: {error}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot create manifest parent {}: {error}",
                parent.display()
            )
        })?;
    }
    let temp_path = unique_sibling_path(path, "tmp")?;
    let backup_path = if path.exists() {
        Some(unique_sibling_path(path, "backup")?)
    } else {
        None
    };
    let write_result = (|| {
        std::fs::write(&temp_path, encoded).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot write temporary asset manifest {}: {error}",
                temp_path.display()
            )
        })?;
        if let Some(backup_path) = backup_path.as_ref() {
            std::fs::rename(path, backup_path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_BACKUP_FAILED: cannot backup asset manifest {} -> {}: {error}",
                    path.display(),
                    backup_path.display()
                )
            })?;
        }
        if let Err(error) = std::fs::rename(&temp_path, path) {
            if let Some(backup_path) = backup_path.as_ref() {
                let _ = std::fs::rename(backup_path, path);
            }
            return Err(format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot commit asset manifest {} -> {}: {error}",
                temp_path.display(),
                path.display()
            ));
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    write_result?;
    Ok(ManifestReplaceGuard {
        manifest_path: path.to_path_buf(),
        backup_path,
    })
}

pub(super) fn rollback_manifest_replace(guard: ManifestReplaceGuard) -> Result<(), String> {
    if guard.manifest_path.exists() {
        std::fs::remove_file(&guard.manifest_path).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ROLLBACK_FAILED: cannot remove manifest {}: {error}",
                guard.manifest_path.display()
            )
        })?;
    }
    if let Some(backup_path) = guard.backup_path {
        if backup_path.exists() {
            std::fs::rename(&backup_path, &guard.manifest_path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ROLLBACK_FAILED: cannot restore manifest {} -> {}: {error}",
                    backup_path.display(),
                    guard.manifest_path.display()
                )
            })?;
        }
    }
    Ok(())
}

pub(super) fn commit_manifest_replace(guard: ManifestReplaceGuard) {
    if let Some(backup_path) = guard.backup_path {
        let _ = std::fs::remove_file(backup_path);
    }
}

pub(super) fn scaffold_bundle_manifest(
    manifest_path: &std::path::Path,
    model_name: &str,
    capabilities: &[String],
    engine: &str,
    endpoint: &str,
    scan: &BundleScan,
) -> Result<JsonValue, String> {
    let normalized_capabilities = normalize_and_validate_capabilities(capabilities)?;
    let kind = kind_from_capabilities(&normalized_capabilities)?;
    let entry = require_single_entry_candidate(scan)?;
    let asset_id = format!("local-import/{model_name}");
    let logical_model_id = default_logical_model_id(asset_id.as_str());
    let normalized_engine = normalize_local_engine(engine, &normalized_capabilities);
    let mmproj_relative = if kind == LocalAiAssetKind::Chat && normalized_engine == "llama" {
        resolve_scaffolded_mmproj(scan)?
    } else {
        None
    };
    let artifact_roles = default_artifact_roles_for_capabilities(&normalized_capabilities);
    let preferred_engine = default_preferred_engine_for_capabilities(&normalized_capabilities);
    let fallback_engines =
        default_fallback_engines_for_engine(normalized_engine.as_str(), &normalized_capabilities);

    let mut manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "asset_id": asset_id,
        "kind": bundle_kind_string(&kind),
        "logical_model_id": logical_model_id,
        "capabilities": normalized_capabilities,
        "engine": normalized_engine,
        "entry": entry,
        "files": scan.files,
        "license": "unknown",
        "source": {
            "repo": bundle_manifest_path_repo(manifest_path),
            "revision": "local"
        },
        "integrity_mode": "local_unverified",
        "hashes": {},
        "artifact_roles": artifact_roles,
        "preferred_engine": preferred_engine,
        "fallback_engines": fallback_engines,
        "endpoint": endpoint
    });
    if let Some(mmproj_relative) = mmproj_relative {
        upsert_manifest_mmproj(
            manifest.as_object_mut().expect("manifest object"),
            logical_model_id.as_str(),
            mmproj_relative.as_str(),
        );
    }
    Ok(manifest)
}

pub(super) fn import_bundle_manifest_via_runtime(
    manifest_path: &std::path::Path,
    endpoint: Option<&str>,
) -> Result<LocalAiAssetRecord, String> {
    runtime_import_manifest_via_runtime(manifest_path, endpoint, None)
}

pub(super) fn asset_manifest_identity_from_record(record: &LocalAiAssetRecord) -> BundleManifestIdentity {
    BundleManifestIdentity {
        asset_id: record.asset_id.clone(),
        logical_model_id: if record.logical_model_id.trim().is_empty()
            && is_runnable_asset_kind(&record.kind)
        {
            default_logical_model_id(record.asset_id.as_str())
        } else {
            record.logical_model_id.clone()
        },
        kind: record.kind.clone(),
        engine: record.engine.clone(),
        entry: record.entry.clone(),
    }
}

pub(super) fn scaffold_manifest_from_record(
    manifest_path: &std::path::Path,
    record: &LocalAiAssetRecord,
    scan: &BundleScan,
) -> Result<JsonValue, String> {
    if !scan.files.iter().any(|item| item == record.entry.as_str()) {
        return Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_ENTRY_MISSING: bundle entry file is missing from disk: {}",
            record.entry
        ));
    }
    if scan.entry_candidates.len() > 1
        && !scan
            .entry_candidates
            .iter()
            .any(|item| item == record.entry.as_str())
    {
        return Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_ENTRY_AMBIGUOUS: multiple runnable model files found ({}). Add asset.manifest.json to choose the bundle entry explicitly.",
            scan.entry_candidates.join(", ")
        ));
    }
    let mut manifest = serde_json::json!({
        "schemaVersion": "1.0.0",
        "asset_id": record.asset_id,
        "kind": bundle_kind_string(&record.kind),
        "logical_model_id": if record.logical_model_id.trim().is_empty() && is_runnable_asset_kind(&record.kind) {
            default_logical_model_id(record.asset_id.as_str())
        } else {
            record.logical_model_id.clone()
        },
        "capabilities": record.capabilities,
        "engine": record.engine,
        "entry": record.entry,
        "files": scan.files,
        "license": record.license,
        "source": {
            "repo": bundle_manifest_path_repo(manifest_path),
            "revision": "local"
        },
        "integrity_mode": "local_unverified",
        "hashes": record.hashes,
        "artifact_roles": record.artifact_roles,
        "preferred_engine": record.preferred_engine,
        "fallback_engines": record.fallback_engines,
        "endpoint": record.endpoint,
        "metadata": record.metadata
    });
    if let Some(engine_config) = record.engine_config.clone() {
        manifest
            .as_object_mut()
            .expect("manifest object")
            .insert("engine_config".to_string(), engine_config);
    }
    if record.kind == LocalAiAssetKind::Chat && record.engine.trim().eq_ignore_ascii_case("llama") {
        let logical_model_id = if record.logical_model_id.trim().is_empty() {
            default_logical_model_id(record.asset_id.as_str())
        } else {
            record.logical_model_id.clone()
        };
        let object = manifest.as_object_mut().expect("manifest object");
        match resolve_manifest_mmproj_relative(object, scan, logical_model_id.as_str())? {
            Some(mmproj_relative) => {
                upsert_manifest_mmproj(object, logical_model_id.as_str(), mmproj_relative.as_str())
            }
            None => remove_manifest_mmproj(object),
        }
    }
    Ok(manifest)
}
