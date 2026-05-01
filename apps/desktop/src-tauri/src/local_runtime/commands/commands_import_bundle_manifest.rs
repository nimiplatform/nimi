use super::*;

pub(super) fn write_manifest_json(path: &std::path::Path, manifest: &JsonValue) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ENCODE_FAILED: {error}"))?;
    std::fs::write(path, encoded).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot write asset manifest {}: {error}",
            path.display()
        )
    })
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

