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

fn scan_bundle_directory(root: &std::path::Path) -> Result<BundleScan, String> {
    fn walk(
        root: &std::path::Path,
        current: &std::path::Path,
        files: &mut Vec<String>,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(current).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle directory {}: {error}",
                current.display()
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle entry {}: {error}",
                    current.display()
                )
            })?;
            let path = entry.path();
            if is_ignored_local_asset_metadata_path(&path) {
                continue;
            }
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_STAT_FAILED: cannot stat bundle entry {}: {error}",
                    path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(symlink_forbidden_error(&path));
            }
            if metadata.is_dir() {
                walk(root, &path, files)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let relative = path.strip_prefix(root).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_RELATIVE_PATH_FAILED: cannot normalize bundle entry {}: {error}",
                    path.display()
                )
            })?;
            let relative_string = relative_path_string(relative);
            if relative_string == ASSET_MANIFEST_FILE_NAME {
                continue;
            }
            files.push(relative_string);
        }
        Ok(())
    }

    let mut files = Vec::<String>::new();
    walk(root, root, &mut files)?;
    files.sort();
    let entry_candidates = files
        .iter()
        .filter(|item| is_model_file_extension(std::path::Path::new(item.as_str())))
        .filter(|item| !is_mmproj_relative_path(item))
        .cloned()
        .collect::<Vec<_>>();
    let mmproj_candidates = files
        .iter()
        .filter(|item| is_mmproj_relative_path(item))
        .cloned()
        .collect::<Vec<_>>();
    Ok(BundleScan {
        files,
        entry_candidates,
        mmproj_candidates,
    })
}

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

fn ensure_parent_dir(path: &std::path::Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_DIR_FAILED: cannot create directory {}: {error}",
            parent.display()
        )
    })
}

fn copy_bundle_directory(
    source_root: &std::path::Path,
    dest_root: &std::path::Path,
) -> Result<(), String> {
    fn walk_copy(
        source_root: &std::path::Path,
        current: &std::path::Path,
        dest_root: &std::path::Path,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(current).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle directory {}: {error}",
                current.display()
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle entry {}: {error}",
                    current.display()
                )
            })?;
            let source_path = entry.path();
            if is_ignored_local_asset_metadata_path(&source_path) {
                continue;
            }
            let metadata = std::fs::symlink_metadata(&source_path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_STAT_FAILED: cannot stat bundle entry {}: {error}",
                    source_path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(symlink_forbidden_error(&source_path));
            }
            let relative = source_path.strip_prefix(source_root).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_RELATIVE_PATH_FAILED: cannot normalize bundle entry {}: {error}",
                    source_path.display()
                )
            })?;
            let dest_path = dest_root.join(relative);
            if metadata.is_dir() {
                std::fs::create_dir_all(&dest_path).map_err(|error| {
                    format!(
                        "LOCAL_AI_BUNDLE_IMPORT_DIR_FAILED: cannot create bundle directory {}: {error}",
                        dest_path.display()
                    )
                })?;
                walk_copy(source_root, &source_path, dest_root)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            ensure_parent_dir(&dest_path)?;
            std::fs::copy(&source_path, &dest_path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_COPY_FAILED: cannot copy bundle file {} -> {}: {error}",
                    source_path.display(),
                    dest_path.display()
                )
            })?;
        }
        Ok(())
    }

    std::fs::create_dir_all(dest_root).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_DIR_FAILED: cannot create bundle root {}: {error}",
            dest_root.display()
        )
    })?;
    walk_copy(source_root, source_root, dest_root)
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

fn write_manifest_json(path: &std::path::Path, manifest: &JsonValue) -> Result<(), String> {
    let encoded = serde_json::to_vec_pretty(manifest)
        .map_err(|error| format!("LOCAL_AI_BUNDLE_IMPORT_MANIFEST_ENCODE_FAILED: {error}"))?;
    std::fs::write(path, encoded).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_MANIFEST_WRITE_FAILED: cannot write asset manifest {}: {error}",
            path.display()
        )
    })
}

fn scaffold_bundle_manifest(
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

fn import_bundle_manifest_via_runtime(
    manifest_path: &std::path::Path,
    endpoint: Option<&str>,
) -> Result<LocalAiAssetRecord, String> {
    runtime_import_manifest_via_runtime(manifest_path, endpoint, None)
}

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
) -> Result<LocalAiAssetRecord, String> {
    let source_dir = validate_import_source_directory(payload.directory_path.as_str())?;
    let source_manifest_path = source_dir.join(ASSET_MANIFEST_FILE_NAME);
    let source_has_manifest = source_manifest_path.is_file();
    let scan = scan_bundle_directory(&source_dir)?;

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

    if !same_canonical_path(&source_dir, &dest_dir) && dest_dir.exists() {
        std::fs::remove_dir_all(&dest_dir).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_DIR_CLEAN_FAILED: cannot replace existing managed bundle {}: {error}",
                dest_dir.display()
            )
        })?;
    }
    if !same_canonical_path(&source_dir, &dest_dir) {
        copy_bundle_directory(&source_dir, &dest_dir)?;
    }
    write_manifest_json(&manifest_path, &manifest_json)?;
    let validated_path = validate_import_asset_manifest_path(
        manifest_path.to_string_lossy().as_ref(),
        models_root.as_path(),
    )?;
    import_bundle_manifest_via_runtime(validated_path.as_path(), endpoint_override.as_deref())
}

fn asset_manifest_identity_from_record(record: &LocalAiAssetRecord) -> BundleManifestIdentity {
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

fn scaffold_manifest_from_record(
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

fn runtime_local_assets_rescan_bundle_impl(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<LocalAiAssetRecord, String> {
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
    let scan = scan_bundle_directory(&bundle_dir)?;
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
    write_manifest_json(&manifest_path, &manifest_json)?;
    let endpoint = if asset.endpoint.trim().is_empty() {
        None
    } else {
        Some(asset.endpoint.as_str())
    };
    import_bundle_manifest_via_runtime(manifest_path.as_path(), endpoint)
}

#[tauri::command]
pub fn runtime_local_pick_asset_directory(app: AppHandle) -> Result<Option<String>, String> {
    runtime_local_pick_asset_directory_impl(&app)
}

#[tauri::command]
pub fn runtime_local_assets_import_bundle(
    app: AppHandle,
    payload: LocalAiAssetsImportBundlePayload,
) -> Result<LocalAiAssetRecord, String> {
    runtime_local_assets_import_bundle_impl(app, payload)
}

#[tauri::command]
pub fn runtime_local_assets_rescan_bundle(
    app: AppHandle,
    payload: LocalAiAssetIdPayload,
) -> Result<LocalAiAssetRecord, String> {
    runtime_local_assets_rescan_bundle_impl(app, payload)
}

#[cfg(test)]
mod commands_import_bundle_tests {
    use super::*;

    fn temp_dir(label: &str) -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix(format!("nimi-bundle-{label}-").as_str())
            .tempdir()
            .expect("tempdir")
    }

    #[test]
    fn scan_bundle_directory_collects_files_entry_and_mmproj() {
        let dir = temp_dir("scan-ok");
        std::fs::write(dir.path().join("model.gguf"), b"weights").expect("write model");
        std::fs::write(dir.path().join("mmproj-BF16.gguf"), b"mmproj").expect("write mmproj");
        std::fs::create_dir_all(dir.path().join("nested")).expect("create nested");
        std::fs::write(dir.path().join("nested").join("readme.txt"), b"note").expect("write note");

        let scan = scan_bundle_directory(dir.path()).expect("scan");
        assert_eq!(
            scan.files,
            vec![
                "mmproj-BF16.gguf".to_string(),
                "model.gguf".to_string(),
                "nested/readme.txt".to_string()
            ]
        );
        assert_eq!(scan.entry_candidates, vec!["model.gguf".to_string()]);
        assert_eq!(scan.mmproj_candidates, vec!["mmproj-BF16.gguf".to_string()]);
    }

    #[test]
    fn scan_bundle_directory_ignores_metadata_sidecars() {
        let dir = temp_dir("scan-ignore-metadata");
        std::fs::write(dir.path().join("model.gguf"), b"weights").expect("write model");
        std::fs::write(dir.path().join("._model.gguf"), b"metadata").expect("write sidecar");
        std::fs::write(dir.path().join(".DS_Store"), b"finder").expect("write ds_store");
        std::fs::create_dir_all(dir.path().join("__MACOSX")).expect("create __MACOSX");
        std::fs::write(
            dir.path().join("__MACOSX").join("._nested.gguf"),
            b"nested-metadata",
        )
        .expect("write nested sidecar");

        let scan = scan_bundle_directory(dir.path()).expect("scan");
        assert_eq!(scan.files, vec!["model.gguf".to_string()]);
        assert_eq!(scan.entry_candidates, vec!["model.gguf".to_string()]);
        assert!(scan.mmproj_candidates.is_empty());
    }

    #[test]
    fn copy_bundle_directory_skips_metadata_sidecars() {
        let source = temp_dir("copy-ignore-src");
        let dest = temp_dir("copy-ignore-dst");
        std::fs::write(source.path().join("model.gguf"), b"weights").expect("write model");
        std::fs::write(source.path().join("._model.gguf"), b"metadata").expect("write sidecar");
        std::fs::create_dir_all(source.path().join("__MACOSX")).expect("create __MACOSX");
        std::fs::write(
            source.path().join("__MACOSX").join("._nested.gguf"),
            b"nested-metadata",
        )
        .expect("write nested sidecar");

        copy_bundle_directory(source.path(), dest.path()).expect("copy");

        assert!(dest.path().join("model.gguf").exists());
        assert!(!dest.path().join("._model.gguf").exists());
        assert!(!dest.path().join("__MACOSX").exists());
    }

    #[test]
    fn require_single_entry_candidate_rejects_ambiguous_bundle() {
        let scan = BundleScan {
            files: vec!["a.gguf".to_string(), "b.gguf".to_string()],
            entry_candidates: vec!["a.gguf".to_string(), "b.gguf".to_string()],
            mmproj_candidates: Vec::new(),
        };
        let error = require_single_entry_candidate(&scan).expect_err("ambiguous");
        assert!(error.contains("LOCAL_AI_BUNDLE_IMPORT_ENTRY_AMBIGUOUS"));
    }

    #[test]
    fn resolve_scaffolded_mmproj_rejects_multiple_candidates() {
        let scan = BundleScan {
            files: vec![
                "model.gguf".to_string(),
                "mmproj-A.gguf".to_string(),
                "mmproj-B.gguf".to_string(),
            ],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-A.gguf".to_string(), "mmproj-B.gguf".to_string()],
        };
        let error = resolve_scaffolded_mmproj(&scan).expect_err("ambiguous mmproj");
        assert!(error.contains("LOCAL_AI_BUNDLE_IMPORT_MMPROJ_AMBIGUOUS"));
    }

    #[test]
    fn scaffold_bundle_manifest_sets_mmproj_engine_config() {
        let dir = temp_dir("manifest");
        let manifest_path = dir.path().join("asset.manifest.json");
        let scan = BundleScan {
            files: vec!["model.gguf".to_string(), "mmproj-BF16.gguf".to_string()],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-BF16.gguf".to_string()],
        };
        let manifest = scaffold_bundle_manifest(
            &manifest_path,
            "gemma-4",
            &["chat".to_string()],
            "llama",
            "http://127.0.0.1:8077/v1",
            &scan,
        )
        .expect("scaffold");
        let llama = manifest
            .get("engine_config")
            .and_then(|value| value.get("llama"))
            .and_then(|value| value.get("mmproj"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert_eq!(llama, "resolved/nimi/local-import-gemma-4/mmproj-BF16.gguf");
    }

    #[test]
    fn normalize_existing_manifest_updates_files_and_mmproj() {
        let dir = temp_dir("normalize");
        let manifest_path = dir.path().join("asset.manifest.json");
        std::fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "asset_id": "local-import/gemma-4",
                "kind": "chat",
                "logical_model_id": "nimi/gemma-4",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "unknown",
                "source": { "repo": "file:///tmp/asset.manifest.json", "revision": "local" },
                "integrity_mode": "local_unverified",
                "hashes": {}
            })
            .to_string(),
        )
        .expect("write manifest");
        let scan = BundleScan {
            files: vec!["model.gguf".to_string(), "mmproj-BF16.gguf".to_string()],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-BF16.gguf".to_string()],
        };
        let identity = BundleManifestIdentity {
            asset_id: "local-import/gemma-4".to_string(),
            logical_model_id: "nimi/gemma-4".to_string(),
            kind: LocalAiAssetKind::Chat,
            engine: "llama".to_string(),
            entry: "model.gguf".to_string(),
        };
        let normalized = normalize_existing_manifest_object(
            &manifest_path,
            &manifest_path,
            &scan,
            &identity,
            true,
        )
        .expect("normalize");
        assert_eq!(
            normalized
                .get("files")
                .and_then(|value| value.as_array())
                .map(|items| items.len())
                .unwrap_or_default(),
            2
        );
        let mmproj = normalized
            .get("engine_config")
            .and_then(|value| value.get("llama"))
            .and_then(|value| value.get("mmproj"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert_eq!(mmproj, "resolved/nimi/gemma-4/mmproj-BF16.gguf");
    }

    #[test]
    fn scaffold_manifest_from_record_preserves_explicit_mmproj_selection() {
        let dir = temp_dir("scaffold-record-mmproj");
        let manifest_path = dir.path().join("asset.manifest.json");
        let scan = BundleScan {
            files: vec![
                "model.gguf".to_string(),
                "mmproj-A.gguf".to_string(),
                "mmproj-B.gguf".to_string(),
            ],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-A.gguf".to_string(), "mmproj-B.gguf".to_string()],
        };
        let record = LocalAiAssetRecord {
            local_asset_id: "asset-local-1".to_string(),
            asset_id: "local-import/gemma-4".to_string(),
            kind: LocalAiAssetKind::Chat,
            capabilities: vec!["chat".to_string(), "text.generate.vision".to_string()],
            logical_model_id: "nimi/gemma-4".to_string(),
            engine: "llama".to_string(),
            entry: "model.gguf".to_string(),
            files: scan.files.clone(),
            license: "unknown".to_string(),
            source: LocalAiAssetSource {
                repo: "file:///tmp/asset.manifest.json".to_string(),
                revision: "local".to_string(),
            },
            integrity_mode: Some(LocalAiIntegrityMode::LocalUnverified),
            hashes: std::collections::HashMap::new(),
            tags: vec![],
            known_total_size_bytes: None,
            endpoint: "http://127.0.0.1:8077/v1".to_string(),
            status: LocalAiAssetStatus::Installed,
            installed_at: String::new(),
            updated_at: String::new(),
            health_detail: None,
            artifact_roles: vec![],
            preferred_engine: None,
            fallback_engines: vec![],
            engine_config: Some(serde_json::json!({
                "llama": {
                    "mmproj": "resolved/nimi/gemma-4/mmproj-B.gguf",
                    "threads": 8
                }
            })),
            recommendation: None,
            metadata: None,
        };

        let manifest = scaffold_manifest_from_record(&manifest_path, &record, &scan)
            .expect("scaffold manifest");
        let engine_config = manifest
            .get("engine_config")
            .and_then(|value| value.as_object())
            .expect("engine_config object");
        let llama = engine_config
            .get("llama")
            .and_then(|value| value.as_object())
            .expect("llama config object");
        assert_eq!(
            llama.get("mmproj").and_then(|value| value.as_str()),
            Some("resolved/nimi/gemma-4/mmproj-B.gguf")
        );
        assert_eq!(
            llama.get("threads").and_then(|value| value.as_i64()),
            Some(8)
        );
    }
}
