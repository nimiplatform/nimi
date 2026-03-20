fn registered_artifact_paths(
    models_root: &std::path::Path,
    state: &LocalAiRuntimeState,
) -> std::collections::HashSet<String> {
    state
        .artifacts
        .iter()
        .filter_map(|artifact| {
            let entry = artifact.entry.trim();
            if entry.is_empty() {
                return None;
            }
            Some(
                artifact_dir(models_root, artifact.artifact_id.as_str())
                    .join(entry)
                    .to_string_lossy()
                    .to_string(),
            )
        })
        .collect()
}

fn typed_folder_model_type(folder_name: &str) -> Option<LocalAiModelType> {
    match folder_name.trim().to_ascii_lowercase().as_str() {
        "chat" => Some(LocalAiModelType::Chat),
        "embedding" => Some(LocalAiModelType::Embedding),
        "image" => Some(LocalAiModelType::Image),
        "video" => Some(LocalAiModelType::Video),
        "tts" => Some(LocalAiModelType::Tts),
        "stt" => Some(LocalAiModelType::Stt),
        "music" => Some(LocalAiModelType::Music),
        _ => None,
    }
}

fn typed_folder_artifact_kind(folder_name: &str) -> Option<LocalAiArtifactKind> {
    match folder_name.trim().to_ascii_lowercase().as_str() {
        "vae" => Some(LocalAiArtifactKind::Vae),
        "ae" => Some(LocalAiArtifactKind::Ae),
        "clip" => Some(LocalAiArtifactKind::Clip),
        "controlnet" => Some(LocalAiArtifactKind::Controlnet),
        "lora" => Some(LocalAiArtifactKind::Lora),
        "llm" => Some(LocalAiArtifactKind::Llm),
        "auxiliary" => Some(LocalAiArtifactKind::Auxiliary),
        _ => None,
    }
}

fn default_engine_for_model_type(model_type: &LocalAiModelType) -> &'static str {
    match model_type {
        LocalAiModelType::Chat | LocalAiModelType::Embedding => "llama",
        LocalAiModelType::Image | LocalAiModelType::Video => "media",
        LocalAiModelType::Tts | LocalAiModelType::Stt => "speech",
        LocalAiModelType::Music => "sidecar",
    }
}

fn default_engine_for_artifact_kind(kind: &LocalAiArtifactKind) -> Option<&'static str> {
    match kind {
        LocalAiArtifactKind::Vae
        | LocalAiArtifactKind::Ae
        | LocalAiArtifactKind::Clip
        | LocalAiArtifactKind::Controlnet
        | LocalAiArtifactKind::Lora => Some("media"),
        LocalAiArtifactKind::Llm => Some("llama"),
        LocalAiArtifactKind::Auxiliary => None,
    }
}

fn model_declaration(model_type: Option<LocalAiModelType>) -> LocalAiAssetDeclaration {
    LocalAiAssetDeclaration {
        asset_class: LocalAiAssetClass::Model,
        engine: model_type
            .as_ref()
            .map(|value| default_engine_for_model_type(value).to_string()),
        model_type,
        artifact_kind: None,
    }
}

fn artifact_declaration(kind: LocalAiArtifactKind) -> LocalAiAssetDeclaration {
    LocalAiAssetDeclaration {
        asset_class: LocalAiAssetClass::Artifact,
        engine: default_engine_for_artifact_kind(&kind).map(|value| value.to_string()),
        model_type: None,
        artifact_kind: Some(kind),
    }
}

fn declaration_from_folder(folder_name: &str) -> Option<LocalAiAssetDeclaration> {
    typed_folder_model_type(folder_name)
        .map(|model_type| model_declaration(Some(model_type)))
        .or_else(|| typed_folder_artifact_kind(folder_name).map(artifact_declaration))
}

fn declaration_from_filename(
    file_name: &str,
    extension: &str,
) -> Option<LocalAiAssetDeclaration> {
    let lower = file_name.trim().to_ascii_lowercase();
    if lower.contains("controlnet") {
        return Some(artifact_declaration(LocalAiArtifactKind::Controlnet));
    }
    if lower.contains("lora") {
        return Some(artifact_declaration(LocalAiArtifactKind::Lora));
    }
    if lower.contains("clip") {
        return Some(artifact_declaration(LocalAiArtifactKind::Clip));
    }
    if lower.contains("autoencoder") || lower.contains("_ae") || lower.contains("-ae") {
        return Some(artifact_declaration(LocalAiArtifactKind::Ae));
    }
    if lower.contains("vae") {
        return Some(artifact_declaration(LocalAiArtifactKind::Vae));
    }
    if lower.contains("whisper") || lower.contains("transcribe") || lower.contains("stt") {
        return Some(model_declaration(Some(LocalAiModelType::Stt)));
    }
    if lower.contains("tts") {
        return Some(model_declaration(Some(LocalAiModelType::Tts)));
    }
    if lower.contains("embed") {
        return Some(model_declaration(Some(LocalAiModelType::Embedding)));
    }
    if lower.contains("music") || lower.contains("musicgen") {
        return Some(model_declaration(Some(LocalAiModelType::Music)));
    }
    match extension.trim().to_ascii_lowercase().as_str() {
        "gguf" | "onnx" | "bin" | "pt" | "pth" => Some(model_declaration(None)),
        _ => None,
    }
}

fn declaration_is_complete(declaration: &LocalAiAssetDeclaration) -> bool {
    match declaration.asset_class {
        LocalAiAssetClass::Model => declaration.model_type.is_some(),
        LocalAiAssetClass::Artifact => {
            declaration.artifact_kind.is_some() && declaration.engine.as_deref().is_some()
        }
    }
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
    let registered_model_paths = registered_model_paths(&models_root, &state);
    let registered_artifact_paths = registered_artifact_paths(&models_root, &state);
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
            if registered_model_paths.contains(&absolute_path) || registered_artifact_paths.contains(&absolute_path) {
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
            if registered_model_paths.contains(&absolute_path) || registered_artifact_paths.contains(&absolute_path) {
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
        .set_title("Select manifest.json or artifact.manifest.json")
        .add_filter("Runtime Manifest", &["json"])
        .pick_file();
    let Some(path) = selected else {
        return Ok(None);
    };
    let file_name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
    let canonical_path = match file_name {
        MODEL_MANIFEST_FILE_NAME => {
            validate_import_manifest_path(path.to_string_lossy().as_ref(), &models_root)?
        }
        ARTIFACT_MANIFEST_FILE_NAME => {
            validate_import_artifact_manifest_path(path.to_string_lossy().as_ref(), &models_root)?
        }
        _ => {
            return Err(
                "LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: only manifest.json or artifact.manifest.json can be imported"
                    .to_string(),
            )
        }
    };
    Ok(Some(canonical_path.to_string_lossy().to_string()))
}
