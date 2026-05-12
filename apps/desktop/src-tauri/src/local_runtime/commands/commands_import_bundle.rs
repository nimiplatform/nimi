use serde_json::{Map as JsonMap, Value as JsonValue};

#[derive(Debug, Clone, PartialEq, Eq)]
struct BundleScan {
    files: Vec<String>,
    entry_candidates: Vec<String>,
    mmproj_candidates: Vec<String>,
}

#[derive(Debug, Clone)]
struct BundleManifestIdentity {
    asset_id: String,
    logical_model_id: String,
    kind: LocalAiAssetKind,
    engine: String,
    entry: String,
}

fn json_string_field(object: &JsonMap<String, JsonValue>, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(|value| value.as_str()))
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn relative_path_string(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_mmproj_relative_path(path: &str) -> bool {
    let lower = path.trim().to_ascii_lowercase();
    lower.ends_with(".gguf") && lower.contains("mmproj")
}

fn validate_import_source_directory(raw_path: &str) -> Result<std::path::PathBuf, String> {
    let source_path = std::path::PathBuf::from(raw_path);
    let metadata = std::fs::symlink_metadata(&source_path).map_err(|_| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_NOT_FOUND: directory does not exist or is not a directory: {raw_path}"
        )
    })?;
    if metadata.file_type().is_symlink() {
        return Err(symlink_forbidden_error(&source_path));
    }
    if !metadata.is_dir() {
        return Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_NOT_FOUND: directory does not exist or is not a directory: {raw_path}"
        ));
    }
    source_path
        .canonicalize()
        .map_err(|error| format!("LOCAL_AI_BUNDLE_IMPORT_CANONICALIZE_FAILED: {error}"))
}


include!("commands_import_bundle_fs.rs");

fn kind_from_capabilities(capabilities: &[String]) -> Result<LocalAiAssetKind, String> {
    let normalized = normalize_and_validate_capabilities(capabilities)?;
    if normalized
        .iter()
        .any(|value| value == "video" || value == "video.generate")
    {
        return Ok(LocalAiAssetKind::Video);
    }
    if normalized
        .iter()
        .any(|value| value == "image" || value == "image.generate")
    {
        return Ok(LocalAiAssetKind::Image);
    }
    if normalized
        .iter()
        .any(|value| value == "tts" || value == "audio.synthesize")
    {
        return Ok(LocalAiAssetKind::Tts);
    }
    if normalized
        .iter()
        .any(|value| value == "stt" || value == "audio.transcribe")
    {
        return Ok(LocalAiAssetKind::Stt);
    }
    if normalized.iter().any(|value| value == "embedding") {
        return Ok(LocalAiAssetKind::Embedding);
    }
    if normalized.iter().any(|value| value == "chat") {
        return Ok(LocalAiAssetKind::Chat);
    }
    Err(
        "LOCAL_AI_BUNDLE_IMPORT_KIND_UNSUPPORTED: capabilities do not map to a supported asset kind"
            .to_string(),
    )
}

fn bundle_kind_string(kind: &LocalAiAssetKind) -> &'static str {
    match kind {
        LocalAiAssetKind::Chat => "chat",
        LocalAiAssetKind::Image => "image",
        LocalAiAssetKind::Video => "video",
        LocalAiAssetKind::Tts => "tts",
        LocalAiAssetKind::Stt => "stt",
        LocalAiAssetKind::Embedding => "embedding",
        LocalAiAssetKind::Vae => "vae",
        LocalAiAssetKind::Clip => "clip",
        LocalAiAssetKind::Controlnet => "controlnet",
        LocalAiAssetKind::Lora => "lora",
        LocalAiAssetKind::Auxiliary => "auxiliary",
    }
}

fn parse_bundle_kind(value: &str) -> Result<LocalAiAssetKind, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "chat" | "llm" => Ok(LocalAiAssetKind::Chat),
        "image" => Ok(LocalAiAssetKind::Image),
        "video" => Ok(LocalAiAssetKind::Video),
        "tts" => Ok(LocalAiAssetKind::Tts),
        "stt" => Ok(LocalAiAssetKind::Stt),
        "embedding" => Ok(LocalAiAssetKind::Embedding),
        "vae" => Ok(LocalAiAssetKind::Vae),
        "clip" => Ok(LocalAiAssetKind::Clip),
        "controlnet" => Ok(LocalAiAssetKind::Controlnet),
        "lora" => Ok(LocalAiAssetKind::Lora),
        "auxiliary" | "aux" => Ok(LocalAiAssetKind::Auxiliary),
        other => Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_KIND_INVALID: unsupported asset kind: {other}"
        )),
    }
}

fn bundle_manifest_path_repo(manifest_path: &std::path::Path) -> String {
    format!("file://{}", manifest_path.to_string_lossy())
}

fn require_single_entry_candidate(scan: &BundleScan) -> Result<String, String> {
    match scan.entry_candidates.as_slice() {
        [] => Err(
            "LOCAL_AI_BUNDLE_IMPORT_ENTRY_MISSING: no runnable model entry found in bundle directory. Add asset.manifest.json to import this bundle explicitly."
                .to_string(),
        ),
        [entry] => Ok(entry.clone()),
        _ => Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_ENTRY_AMBIGUOUS: multiple runnable model files found ({}). Add asset.manifest.json to choose the bundle entry explicitly.",
            scan.entry_candidates.join(", ")
        )),
    }
}

fn resolve_scaffolded_mmproj(scan: &BundleScan) -> Result<Option<String>, String> {
    match scan.mmproj_candidates.as_slice() {
        [] => Ok(None),
        [candidate] => Ok(Some(candidate.clone())),
        _ => Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_MMPROJ_AMBIGUOUS: multiple mmproj files found ({}). Add asset.manifest.json to choose the multimodal projector explicitly.",
            scan.mmproj_candidates.join(", ")
        )),
    }
}

fn parse_manifest_identity(path: &std::path::Path) -> Result<BundleManifestIdentity, String> {
    let raw = std::fs::read_to_string(path).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_READ_FAILED: cannot read asset manifest {}: {error}",
            path.display()
        )
    })?;
    let value: JsonValue = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_PARSE_FAILED: cannot parse asset manifest {}: {error}",
            path.display()
        )
    })?;
    let object = value.as_object().ok_or_else(|| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_INVALID: asset manifest must be a JSON object: {}",
            path.display()
        )
    })?;
    let asset_id = json_string_field(object, &["asset_id", "assetId"]);
    if asset_id.is_empty() {
        return Err(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ASSET_ID_MISSING: asset manifest asset_id is required"
                .to_string(),
        );
    }
    let kind_raw = json_string_field(object, &["kind"]);
    let kind = parse_bundle_kind(kind_raw.as_str())?;
    let engine = json_string_field(object, &["engine"]);
    let entry = json_string_field(object, &["entry"]);
    if entry.is_empty() {
        return Err(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ENTRY_MISSING: asset manifest entry is required"
                .to_string(),
        );
    }
    let logical_model_id = {
        let current = json_string_field(object, &["logical_model_id", "logicalModelId"]);
        if current.is_empty() && is_runnable_asset_kind(&kind) {
            default_logical_model_id(asset_id.as_str())
        } else {
            current
        }
    };
    Ok(BundleManifestIdentity {
        asset_id,
        logical_model_id,
        kind,
        engine,
        entry,
    })
}

fn same_canonical_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(l), Ok(r)) => l == r,
        _ => false,
    }
}

fn resolve_manifest_mmproj_relative(
    object: &JsonMap<String, JsonValue>,
    scan: &BundleScan,
    logical_model_id: &str,
) -> Result<Option<String>, String> {
    let existing_mmproj = object
        .get("engine_config")
        .and_then(|value| value.as_object())
        .and_then(|engine_config| engine_config.get("llama"))
        .and_then(|value| value.as_object())
        .and_then(|llama| llama.get("mmproj"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if scan.mmproj_candidates.len() > 1 && existing_mmproj.is_none() {
        return Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_MMPROJ_AMBIGUOUS: multiple mmproj files found ({}). Update asset.manifest.json to choose the multimodal projector explicitly.",
            scan.mmproj_candidates.join(", ")
        ));
    }

    if let Some(existing) = existing_mmproj {
        let root_prefix = relative_path_string(
            crate::local_runtime::types::resolved_model_relative_dir(logical_model_id).as_path(),
        );
        let normalized = existing.trim_start_matches("./").trim_start_matches('/');
        let target_relative = normalized
            .strip_prefix(format!("{root_prefix}/").as_str())
            .unwrap_or(normalized)
            .to_string();
        if !scan.files.iter().any(|item| item == &target_relative) {
            return Err(format!(
                "LOCAL_AI_BUNDLE_IMPORT_MMPROJ_MISSING: configured mmproj file is missing from disk: {existing}"
            ));
        }
        return Ok(Some(target_relative));
    }

    if scan.mmproj_candidates.len() == 1 {
        return Ok(Some(scan.mmproj_candidates[0].clone()));
    }
    Ok(None)
}

fn upsert_manifest_mmproj(
    object: &mut JsonMap<String, JsonValue>,
    logical_model_id: &str,
    mmproj_relative_path: &str,
) {
    let models_relative =
        crate::local_runtime::types::resolved_model_relative_dir(logical_model_id)
            .join(mmproj_relative_path);
    let mut engine_config = object
        .get("engine_config")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let mut llama = engine_config
        .get("llama")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    llama.insert(
        "mmproj".to_string(),
        JsonValue::String(relative_path_string(models_relative.as_path())),
    );
    engine_config.insert("llama".to_string(), JsonValue::Object(llama));
    object.insert(
        "engine_config".to_string(),
        JsonValue::Object(engine_config),
    );
}

fn remove_manifest_mmproj(object: &mut JsonMap<String, JsonValue>) {
    if let Some(engine_config) = object
        .get_mut("engine_config")
        .and_then(|value| value.as_object_mut())
    {
        if let Some(llama) = engine_config
            .get_mut("llama")
            .and_then(|value| value.as_object_mut())
        {
            llama.remove("mmproj");
            if llama.is_empty() {
                engine_config.remove("llama");
            }
        }
        if engine_config.is_empty() {
            object.remove("engine_config");
        }
    }
}

fn normalize_existing_manifest_object(
    source_manifest_path: &std::path::Path,
    managed_manifest_path: &std::path::Path,
    scan: &BundleScan,
    explicit_identity: &BundleManifestIdentity,
    allow_mmproj_inference: bool,
) -> Result<JsonValue, String> {
    let raw = std::fs::read_to_string(source_manifest_path).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_READ_FAILED: cannot read asset manifest {}: {error}",
            source_manifest_path.display()
        )
    })?;
    let mut manifest: JsonValue = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_PARSE_FAILED: cannot parse asset manifest {}: {error}",
            source_manifest_path.display()
        )
    })?;
    let object = manifest.as_object_mut().ok_or_else(|| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_INVALID: asset manifest must be a JSON object: {}",
            source_manifest_path.display()
        )
    })?;
    let entry = explicit_identity.entry.trim();
    if entry.is_empty() {
        return Err(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ENTRY_MISSING: asset manifest entry is required"
                .to_string(),
        );
    }
    if !scan.files.iter().any(|item| item == entry) {
        return Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_ENTRY_MISSING: bundle entry file is missing from disk: {entry}"
        ));
    }

    object.insert(
        "files".to_string(),
        JsonValue::Array(scan.files.iter().cloned().map(JsonValue::String).collect()),
    );
    object.insert(
        "source".to_string(),
        serde_json::json!({
            "repo": bundle_manifest_path_repo(managed_manifest_path),
            "revision": "local"
        }),
    );

    if allow_mmproj_inference
        && explicit_identity.kind == LocalAiAssetKind::Chat
        && explicit_identity
            .engine
            .trim()
            .eq_ignore_ascii_case("llama")
    {
        match resolve_manifest_mmproj_relative(
            object,
            scan,
            explicit_identity.logical_model_id.as_str(),
        )? {
            Some(relative) => upsert_manifest_mmproj(
                object,
                explicit_identity.logical_model_id.as_str(),
                relative.as_str(),
            ),
            None => remove_manifest_mmproj(object),
        }
    }

    Ok(manifest)
}

mod commands_import_bundle_manifest;
use commands_import_bundle_manifest::{
    asset_manifest_identity_from_record, commit_manifest_replace, import_bundle_manifest_via_runtime,
    rollback_manifest_replace, scaffold_bundle_manifest, scaffold_manifest_from_record,
    write_manifest_json, write_manifest_json_with_rollback,
};

fn runtime_local_pick_asset_directory_impl(app: &AppHandle) -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir().unwrap_or_else(|| runtime_models_dir(app).unwrap_or_default());
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Select asset bundle directory to import")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

fn runtime_local_assets_import_bundle_impl(
    app: AppHandle,
    payload: LocalAiAssetsImportBundlePayload,
    cancel_token: &download_manager::BackgroundImportCancelToken,
) -> Result<LocalAiAssetRecord, String> {
    cancel_token.throw_if_cancelled()?;
    let source_dir = validate_import_source_directory(payload.directory_path.as_str())?;
    let source_manifest_path = source_dir.join(ASSET_MANIFEST_FILE_NAME);
    let source_has_manifest = source_manifest_path.is_file();
    let scan = scan_bundle_directory(&source_dir, Some(cancel_token))?;

    cancel_token.throw_if_cancelled()?;
    let models_root = runtime_models_dir(&app)?;
    let endpoint_override = match payload
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(endpoint) => Some(validate_loopback_endpoint(endpoint)?),
        None => None,
    };

    let (dest_dir, manifest_json, manifest_path) = if source_has_manifest {
        let identity = parse_manifest_identity(&source_manifest_path)?;
        let dest_dir = if is_runnable_asset_kind(&identity.kind) {
            resolved_model_dir(models_root.as_path(), identity.logical_model_id.as_str())
        } else {
            models_root
                .join("resolved")
                .join(slugify_local_model_id(identity.asset_id.as_str()))
        };
        let manifest_path = dest_dir.join(ASSET_MANIFEST_FILE_NAME);
        let manifest_json = normalize_existing_manifest_object(
            &source_manifest_path,
            &manifest_path,
            &scan,
            &identity,
            true,
        )?;
        (dest_dir, manifest_json, manifest_path)
    } else {
        let model_name = payload
            .model_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string())
            .or_else(|| {
                source_dir
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
            .ok_or_else(|| {
                "LOCAL_AI_BUNDLE_IMPORT_MODEL_NAME_REQUIRED: modelName is required for scaffolded bundle import"
                    .to_string()
            })?;
        let logical_model_id =
            default_logical_model_id(format!("local-import/{model_name}").as_str());
        let dest_dir = resolved_model_dir(models_root.as_path(), logical_model_id.as_str());
        let manifest_path = dest_dir.join(ASSET_MANIFEST_FILE_NAME);
        let manifest_json = scaffold_bundle_manifest(
            &manifest_path,
            model_name.as_str(),
            &payload.capabilities,
            payload.engine.as_deref().unwrap_or("llama"),
            endpoint_override
                .as_deref()
                .unwrap_or(default_runtime_endpoint_for(payload.engine.as_deref()).as_str()),
            &scan,
        )?;
        (dest_dir, manifest_json, manifest_path)
    };

    let source_is_dest = same_canonical_path(&source_dir, &dest_dir);
    cancel_token.throw_if_cancelled()?;
    if !source_is_dest {
        let staging_dir = unique_sibling_path(&dest_dir, "staging")?;
        let staged_result = (|| {
            remove_dir_if_exists(
                &staging_dir,
                "LOCAL_AI_BUNDLE_IMPORT_STAGING_CLEAN_FAILED",
            )?;
            copy_bundle_directory(&source_dir, &staging_dir, Some(cancel_token))?;
            cancel_token.throw_if_cancelled()?;
            write_manifest_json(&staging_dir.join(ASSET_MANIFEST_FILE_NAME), &manifest_json)?;
            cancel_token.throw_if_cancelled()
        })();
        if let Err(error) = staged_result {
            let _ = remove_dir_if_exists(
                &staging_dir,
                "LOCAL_AI_BUNDLE_IMPORT_STAGING_CLEAN_FAILED",
            );
            return Err(error);
        }

        let backup_dir = replace_directory_with_rollback(&staging_dir, &dest_dir)?;
        let import_result = (|| {
            cancel_token.throw_if_cancelled()?;
            let validated_path = validate_import_asset_manifest_path(
                manifest_path.to_string_lossy().as_ref(),
                models_root.as_path(),
            )?;
            cancel_token.throw_if_cancelled()?;
            import_bundle_manifest_via_runtime(validated_path.as_path(), endpoint_override.as_deref())
        })();
        return match import_result {
            Ok(asset) => {
                cleanup_directory_backup(backup_dir.as_deref());
                Ok(asset)
            }
            Err(error) => {
                let _ = rollback_directory_replace(&dest_dir, backup_dir.as_deref());
                Err(error)
            }
        };
    }

    let manifest_guard = write_manifest_json_with_rollback(&manifest_path, &manifest_json)?;
    cancel_token.throw_if_cancelled()?;
    let import_result = (|| {
        let validated_path = validate_import_asset_manifest_path(
            manifest_path.to_string_lossy().as_ref(),
            models_root.as_path(),
        )?;
        cancel_token.throw_if_cancelled()?;
        import_bundle_manifest_via_runtime(validated_path.as_path(), endpoint_override.as_deref())
    })();
    match import_result {
        Ok(asset) => {
            commit_manifest_replace(manifest_guard);
            Ok(asset)
        }
        Err(error) => {
            let _ = rollback_manifest_replace(manifest_guard);
            Err(error)
        }
    }
}

fn runtime_local_assets_rescan_bundle_impl(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
    cancel_token: &download_manager::BackgroundImportCancelToken,
) -> Result<LocalAiAssetRecord, String> {
    cancel_token.throw_if_cancelled()?;
    let state = load_state(&app)?;
    let asset = state
        .assets
        .iter()
        .find(|item| item.local_asset_id == payload.local_asset_id)
        .cloned()
        .ok_or_else(|| {
            format!(
                "LOCAL_AI_BUNDLE_RESCAN_ASSET_NOT_FOUND: local asset not found: {}",
                payload.local_asset_id
            )
        })?;
    let models_root = runtime_models_dir(&app)?;
    let bundle_dir = runtime_managed_asset_dir(models_root.as_path(), &asset);
    if !bundle_dir.is_dir() {
        return Err(format!(
            "LOCAL_AI_BUNDLE_RESCAN_DIR_MISSING: managed bundle directory does not exist: {}",
            bundle_dir.display()
        ));
    }
    let manifest_path = runtime_managed_asset_manifest_path(models_root.as_path(), &asset);
    let scan = scan_bundle_directory(&bundle_dir, Some(cancel_token))?;
    let manifest_json = if manifest_path.is_file() {
        normalize_existing_manifest_object(
            &manifest_path,
            &manifest_path,
            &scan,
            &asset_manifest_identity_from_record(&asset),
            true,
        )?
    } else {
        scaffold_manifest_from_record(&manifest_path, &asset, &scan)?
    };
    cancel_token.throw_if_cancelled()?;
    let endpoint = if asset.endpoint.trim().is_empty() {
        None
    } else {
        Some(asset.endpoint.as_str())
    };
    let manifest_guard = write_manifest_json_with_rollback(&manifest_path, &manifest_json)?;
    let import_result = (|| {
        cancel_token.throw_if_cancelled()?;
        import_bundle_manifest_via_runtime(manifest_path.as_path(), endpoint)
    })();
    match import_result {
        Ok(asset) => {
            commit_manifest_replace(manifest_guard);
            Ok(asset)
        }
        Err(error) => {
            let _ = rollback_manifest_replace(manifest_guard);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn runtime_local_pick_asset_directory(app: AppHandle) -> Result<Option<String>, String> {
    runtime_local_pick_asset_directory_impl(&app)
}

#[tauri::command]
pub fn runtime_local_assets_import_bundle(
    app: AppHandle,
    payload: LocalAiAssetsImportBundlePayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let model_id = payload
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("bundle:{value}"))
        .or_else(|| {
            std::path::Path::new(payload.directory_path.as_str())
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| format!("bundle:{value}"))
        })
        .unwrap_or_else(|| "bundle:import".to_string());
    let local_model_id = format!("pending:{}", slugify_local_model_id(model_id.as_str()));
    let accepted = download_manager::enqueue_background_import_task(
        &app,
        model_id.as_str(),
        local_model_id.as_str(),
        "bundle",
        "queued bundle import",
        move |app, install_session_id, _model_id, _local_model_id, cancel_token| {
            if cancel_token.throw_if_cancelled().is_err() {
                return;
            }
            match runtime_local_assets_import_bundle_impl(app.clone(), payload, &cancel_token) {
                Ok(asset) => download_manager::complete_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    asset.asset_id.as_str(),
                    asset.local_asset_id.as_str(),
                    "bundle import completed",
                ),
                Err(error) => download_manager::fail_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    error,
                    false,
                ),
            }
        },
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}

#[tauri::command]
pub fn runtime_local_assets_rescan_bundle(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<LocalAiInstallAcceptedResponse, String> {
    let model_id = format!("rescan:{}", payload.local_asset_id.trim());
    let local_model_id = payload.local_asset_id.trim().to_string();
    let accepted = download_manager::enqueue_background_import_task(
        &app,
        model_id.as_str(),
        local_model_id.as_str(),
        "rescan",
        "queued bundle rescan",
        move |app, install_session_id, _model_id, _local_model_id, cancel_token| {
            if cancel_token.throw_if_cancelled().is_err() {
                return;
            }
            match runtime_local_assets_rescan_bundle_impl(app.clone(), payload, &cancel_token) {
                Ok(asset) => download_manager::complete_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    asset.asset_id.as_str(),
                    asset.local_asset_id.as_str(),
                    "bundle rescan completed",
                ),
                Err(error) => download_manager::fail_background_import_task(
                    &app,
                    install_session_id.as_str(),
                    error,
                    false,
                ),
            }
        },
    )?;
    Ok(LocalAiInstallAcceptedResponse {
        install_session_id: accepted.install_session_id,
        model_id: accepted.model_id,
        local_model_id: accepted.local_model_id,
    })
}

#[cfg(test)]
mod commands_import_bundle_tests;
