const ASSET_MANIFEST_FILE_NAME: &str = "asset.manifest.json";
const KNOWN_MODEL_EXTENSIONS: &[&str] = &["gguf", "safetensors", "bin", "pt", "onnx", "pth"];

fn is_model_file_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| KNOWN_MODEL_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn registered_runnable_asset_paths(
    models_root: &std::path::Path,
    state: &LocalAiRuntimeState,
) -> std::collections::HashSet<String> {
    state
        .assets
        .iter()
        .filter_map(|record| {
            if !is_runnable_asset_kind(&record.kind) {
                return None;
            }
            let logical_model_id = if record.logical_model_id.trim().is_empty() {
                default_logical_model_id(record.asset_id.as_str())
            } else {
                record.logical_model_id.clone()
            };
            if record.entry.trim().is_empty() {
                return None;
            }
            Some(
                resolved_model_dir(models_root, logical_model_id.as_str())
                    .join(record.entry.as_str())
                    .to_string_lossy()
                    .to_string(),
            )
        })
        .collect()
}

fn is_managed_models_subdir(path: &std::path::Path) -> bool {
    path.join(ASSET_MANIFEST_FILE_NAME).exists()
}

fn is_reserved_models_root_child(path: &std::path::Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some("resolved" | "quarantine")
    )
}

fn registered_passive_asset_paths(
    models_root: &std::path::Path,
    state: &LocalAiRuntimeState,
) -> std::collections::HashSet<String> {
    state
        .assets
        .iter()
        .filter_map(|asset| {
            if is_runnable_asset_kind(&asset.kind) {
                return None;
            }
            let entry = asset.entry.trim();
            if entry.is_empty() {
                return None;
            }
            Some(
                runtime_managed_asset_dir(models_root, asset)
                    .join(entry)
                    .to_string_lossy()
                    .to_string(),
            )
        })
        .collect()
}

fn typed_folder_asset_kind(folder_name: &str) -> Option<LocalAiAssetKind> {
    match folder_name.trim().to_ascii_lowercase().as_str() {
        "chat" => Some(LocalAiAssetKind::Chat),
        "image" => Some(LocalAiAssetKind::Image),
        "video" => Some(LocalAiAssetKind::Video),
        "tts" => Some(LocalAiAssetKind::Tts),
        "stt" => Some(LocalAiAssetKind::Stt),
        "embedding" => Some(LocalAiAssetKind::Embedding),
        "vae" => Some(LocalAiAssetKind::Vae),
        "ae" => Some(LocalAiAssetKind::Vae),
        "clip" => Some(LocalAiAssetKind::Clip),
        "controlnet" => Some(LocalAiAssetKind::Controlnet),
        "lora" => Some(LocalAiAssetKind::Lora),
        "auxiliary" => Some(LocalAiAssetKind::Auxiliary),
        _ => None,
    }
}

fn default_engine_for_asset_kind(kind: &LocalAiAssetKind) -> Option<&'static str> {
    match kind {
        LocalAiAssetKind::Chat | LocalAiAssetKind::Embedding => Some("llama"),
        LocalAiAssetKind::Image | LocalAiAssetKind::Video => Some("media"),
        LocalAiAssetKind::Tts | LocalAiAssetKind::Stt => Some("speech"),
        LocalAiAssetKind::Vae
        | LocalAiAssetKind::Clip
        | LocalAiAssetKind::Controlnet
        | LocalAiAssetKind::Lora => Some("media"),
        LocalAiAssetKind::Auxiliary => None,
    }
}

fn asset_declaration(kind: LocalAiAssetKind) -> LocalAiAssetDeclaration {
    LocalAiAssetDeclaration {
        asset_kind: Some(kind.clone()),
        engine: default_engine_for_asset_kind(&kind).map(|value| value.to_string()),
    }
}

fn declaration_from_folder(folder_name: &str) -> Option<LocalAiAssetDeclaration> {
    typed_folder_asset_kind(folder_name).map(asset_declaration)
}

fn declaration_from_filename(
    file_name: &str,
    extension: &str,
) -> Option<LocalAiAssetDeclaration> {
    let lower = file_name.trim().to_ascii_lowercase();
    if lower.contains("controlnet") {
        return Some(asset_declaration(LocalAiAssetKind::Controlnet));
    }
    if lower.contains("lora") {
        return Some(asset_declaration(LocalAiAssetKind::Lora));
    }
    if lower.contains("clip") {
        return Some(asset_declaration(LocalAiAssetKind::Clip));
    }
    if lower.contains("autoencoder") || lower.contains("_ae") || lower.contains("-ae") {
        return Some(asset_declaration(LocalAiAssetKind::Vae));
    }
    if lower.contains("vae") {
        return Some(asset_declaration(LocalAiAssetKind::Vae));
    }
    if lower.contains("whisper") || lower.contains("transcribe") || lower.contains("stt") {
        return Some(asset_declaration(LocalAiAssetKind::Stt));
    }
    if lower.contains("tts") {
        return Some(asset_declaration(LocalAiAssetKind::Tts));
    }
    if lower.contains("embedding") || lower.contains("embed") {
        return Some(asset_declaration(LocalAiAssetKind::Embedding));
    }
    match extension.trim().to_ascii_lowercase().as_str() {
        "gguf" | "onnx" | "bin" | "pt" | "pth" => Some(asset_declaration(LocalAiAssetKind::Chat)),
        _ => None,
    }
}

fn declaration_is_complete(declaration: &LocalAiAssetDeclaration) -> bool {
    declaration.asset_kind.is_some()
        && declaration
            .asset_kind
            .as_ref()
            .map(|kind| *kind != LocalAiAssetKind::Auxiliary || declaration.engine.as_deref().is_some())
            .unwrap_or(false)
}

fn make_unregistered_asset_descriptor(
    path: &std::path::Path,
    folder_name: Option<&str>,
) -> Option<LocalAiUnregisteredAssetDescriptor> {
    if !path.is_file() || !is_model_file_extension(path) {
        return None;
    }
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("unknown")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let folder_hint = folder_name.and_then(declaration_from_folder);
    let (declaration, suggestion_source, confidence) = if let Some(declaration) = folder_hint {
        (
            Some(declaration),
            LocalAiSuggestionSource::Folder,
            LocalAiSuggestionConfidence::High,
        )
    } else if let Some(declaration) = declaration_from_filename(filename.as_str(), extension.as_str()) {
        (
            Some(declaration),
            LocalAiSuggestionSource::Filename,
            LocalAiSuggestionConfidence::Low,
        )
    } else {
        (
            None,
            LocalAiSuggestionSource::Unknown,
            LocalAiSuggestionConfidence::Low,
        )
    };
    let auto_importable = declaration
        .as_ref()
        .map(declaration_is_complete)
        .unwrap_or(false)
        && confidence == LocalAiSuggestionConfidence::High;
    Some(LocalAiUnregisteredAssetDescriptor {
        filename,
        path: path.to_string_lossy().to_string(),
        size_bytes: std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0),
        declaration,
        suggestion_source,
        confidence,
        auto_importable,
        requires_manual_review: !auto_importable,
        folder_name: folder_name.map(|value| value.to_string()),
    })
}

fn scan_unregistered_assets(app: &AppHandle) -> Result<Vec<LocalAiUnregisteredAssetDescriptor>, String> {
    let models_root = runtime_models_dir(app)?;
    let state = load_state(app)?;
    let registered_runnable_asset_paths = registered_runnable_asset_paths(&models_root, &state);
    let registered_passive_asset_paths = registered_passive_asset_paths(&models_root, &state);
    let mut assets = Vec::<LocalAiUnregisteredAssetDescriptor>::new();
    let entries = std::fs::read_dir(&models_root).map_err(|error| {
        format!("LOCAL_AI_UNREGISTERED_SCAN_READ_DIR_FAILED: cannot read models directory: {error}")
    })?;

    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if path.is_file() {
            let absolute_path = path.to_string_lossy().to_string();
            if registered_runnable_asset_paths.contains(&absolute_path)
                || registered_passive_asset_paths.contains(&absolute_path)
            {
                continue;
            }
            if let Some(item) = make_unregistered_asset_descriptor(&path, None) {
                assets.push(item);
            }
            continue;
        }
        if !path.is_dir()
            || is_reserved_models_root_child(&path)
            || is_managed_models_subdir(&path)
        {
            continue;
        }
        let folder_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
        let sub_entries = match std::fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for sub_entry in sub_entries {
            let Ok(sub_entry) = sub_entry else {
                continue;
            };
            let sub_path = sub_entry.path();
            let absolute_path = sub_path.to_string_lossy().to_string();
            if registered_runnable_asset_paths.contains(&absolute_path)
                || registered_passive_asset_paths.contains(&absolute_path)
            {
                continue;
            }
            if let Some(item) = make_unregistered_asset_descriptor(&sub_path, Some(folder_name)) {
                assets.push(item);
            }
        }
    }

    assets.sort_by(|left, right| {
        left.filename
            .cmp(&right.filename)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(assets)
}

#[tauri::command]
pub fn runtime_local_assets_scan_unregistered(
    app: AppHandle,
) -> Result<Vec<LocalAiUnregisteredAssetDescriptor>, String> {
    scan_unregistered_assets(&app)
}

#[tauri::command]
pub fn runtime_local_pick_asset_manifest_path(app: AppHandle) -> Result<Option<String>, String> {
    let models_root = runtime_models_dir(&app)?;
    let selected = rfd::FileDialog::new()
        .set_directory(&models_root)
        .set_title("Select asset.manifest.json")
        .add_filter("Asset Manifest", &["asset.manifest.json"])
        .pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
    if file_name != ASSET_MANIFEST_FILE_NAME {
        return Err(
            "LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: only asset.manifest.json can be imported"
                .to_string(),
        );
    }
    let canonical_path = validate_import_asset_manifest_path(path.to_string_lossy().as_ref(), &models_root)?;
    Ok(Some(canonical_path.to_string_lossy().to_string()))
}
