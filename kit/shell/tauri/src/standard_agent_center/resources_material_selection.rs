use super::*;

const MAX_PRESENTATION_MATERIAL_BYTES: u64 = 64 * 1024 * 1024;

pub(super) fn standard_agent_center_avatar_material_select_blocking(
    payload: StandardAgentCenterAvatarMaterialSelectPayload,
    selected_path: PathBuf,
) -> AgentCenterHostResult<StandardAgentCenterAvatarMaterialSelectResult> {
    let source = selected_regular_file(selected_path)?;
    let extension = extension_for(&source.to_string_lossy());
    let media_type = match payload.backend_kind {
        StandardAgentCenterAvatarBackendKind::Live2d if extension == "zip" => "application/zip",
        StandardAgentCenterAvatarBackendKind::Vrm if extension == "vrm" => "model/gltf-binary",
        StandardAgentCenterAvatarBackendKind::Live2d => {
            return Err(AgentCenterHostError::InvalidPayload(
                "Live2D material must be a selected .zip package.".to_string(),
            ));
        }
        StandardAgentCenterAvatarBackendKind::Vrm => {
            return Err(AgentCenterHostError::InvalidPayload(
                "VRM material must be a selected .vrm file.".to_string(),
            ));
        }
    };
    let content = read_bounded_material(&source, MAX_PRESENTATION_MATERIAL_BYTES, "Avatar")?;
    let file_name = selected_file_name(&source)?;
    let sha256 = material_digest(&content);
    crate::agent_center_avatar_asset::materialize_agent_center_avatar_asset(
        avatar_backend_kind_label(payload.backend_kind),
        &file_name,
        &content,
        &sha256,
    )
    .map_err(AgentCenterHostError::HostInternal)?;
    Ok(StandardAgentCenterAvatarMaterialSelectResult {
        role: "avatar".to_string(),
        file_name,
        media_type: media_type.to_string(),
        sha256,
        custody_ref: custody_ref(&content),
        content,
        backend_kind: payload.backend_kind,
    })
}

pub(super) fn standard_agent_center_background_material_select_blocking(
    _payload: StandardAgentCenterBackgroundMaterialSelectPayload,
    selected_path: PathBuf,
) -> AgentCenterHostResult<StandardAgentCenterBackgroundMaterialSelectResult> {
    let source = selected_regular_file(selected_path)?;
    let media_type =
        background_mime_for_path(&source).map_err(AgentCenterHostError::InvalidPayload)?;
    let content = read_bounded_material(&source, MAX_BACKGROUND_BYTES, "Background")?;
    background_dimensions(&content, &media_type).map_err(AgentCenterHostError::InvalidPayload)?;
    Ok(StandardAgentCenterBackgroundMaterialSelectResult {
        role: "background".to_string(),
        file_name: selected_file_name(&source)?,
        media_type,
        sha256: material_digest(&content),
        custody_ref: custody_ref(&content),
        content,
    })
}

fn selected_regular_file(selected_path: PathBuf) -> AgentCenterHostResult<PathBuf> {
    let source = fs::canonicalize(&selected_path).map_err(|_| {
        AgentCenterHostError::InvalidPath(
            "selected appearance material could not be resolved".to_string(),
        )
    })?;
    let metadata = fs::symlink_metadata(&source).map_err(|error| {
        AgentCenterHostError::HostInternal(format!(
            "failed to read selected appearance material metadata: {error}"
        ))
    })?;
    if metadata.file_type().is_symlink() {
        return Err(AgentCenterHostError::InvalidPath(
            "selected appearance material must not be a symlink".to_string(),
        ));
    }
    if !metadata.is_file() {
        return Err(AgentCenterHostError::InvalidPayload(
            "selected appearance material must be a file".to_string(),
        ));
    }
    Ok(source)
}

fn read_bounded_material(
    path: &Path,
    max_bytes: u64,
    label: &str,
) -> AgentCenterHostResult<Vec<u8>> {
    let metadata = fs::metadata(path).map_err(|error| {
        AgentCenterHostError::HostInternal(format!(
            "failed to inspect selected {label} material: {error}"
        ))
    })?;
    if metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(AgentCenterHostError::InvalidPayload(format!(
            "{label} material is outside the bounded Runtime intake size."
        )));
    }
    fs::read(path).map_err(|error| {
        AgentCenterHostError::HostInternal(format!(
            "failed to read selected {label} material: {error}"
        ))
    })
}

fn material_digest(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

fn custody_ref(content: &[u8]) -> String {
    let digest = material_digest(content);
    format!("agent-center-import-custody:{}", &digest[..24])
}

fn selected_file_name(path: &Path) -> AgentCenterHostResult<String> {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AgentCenterHostError::InvalidPath(
                "selected appearance material file name is unavailable".to_string(),
            )
        })
}

fn extension_for(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn background_mime_for_path(path: &Path) -> Result<String, String> {
    match extension_for(&path.to_string_lossy()).as_str() {
        "png" => Ok("image/png".to_string()),
        "jpg" | "jpeg" => Ok("image/jpeg".to_string()),
        "webp" => Ok("image/webp".to_string()),
        "svg" => Err("SVG backgrounds are not admitted.".to_string()),
        _ => Err("Background source must be a png, jpeg, or webp image.".to_string()),
    }
}

fn background_dimensions(bytes: &[u8], mime: &str) -> Result<(u32, u32), String> {
    validate_image_container(bytes, mime)?;
    let format = match mime {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err("Background MIME is not admitted for decoding.".to_string()),
    };
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_BACKGROUND_PIXELS);
    limits.max_image_height = Some(MAX_BACKGROUND_PIXELS);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|error| format!("Background image could not be fully decoded: {error}"))?;
    let dimensions = (decoded.width(), decoded.height());
    if dimensions.0 == 0 || dimensions.1 == 0 {
        return Err("Background image dimensions are outside the fixed pixel cap.".to_string());
    }
    Ok(dimensions)
}

fn validate_image_container(bytes: &[u8], mime: &str) -> Result<(), String> {
    let complete = match mime {
        "image/png" => complete_png_container(bytes),
        "image/jpeg" => {
            bytes.len() >= 4 && bytes.starts_with(&[0xff, 0xd8]) && bytes.ends_with(&[0xff, 0xd9])
        }
        "image/webp" => {
            bytes.len() >= 20
                && &bytes[0..4] == b"RIFF"
                && &bytes[8..12] == b"WEBP"
                && usize::try_from(read_u32_le(bytes, 4).unwrap_or(u32::MAX))
                    .unwrap_or(usize::MAX)
                    .saturating_add(8)
                    == bytes.len()
        }
        _ => false,
    };
    if complete {
        Ok(())
    } else {
        Err("Background image container is incomplete or malformed.".to_string())
    }
}

fn complete_png_container(bytes: &[u8]) -> bool {
    if bytes.len() < 45 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return false;
    }
    let mut offset = 8_usize;
    let mut index = 0_usize;
    let mut saw_image_data = false;
    while offset < bytes.len() {
        if offset + 12 > bytes.len() {
            return false;
        }
        let length =
            u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap_or_default()) as usize;
        let type_start = offset + 4;
        let Some(data_end) = type_start
            .checked_add(4)
            .and_then(|value| value.checked_add(length))
        else {
            return false;
        };
        let Some(chunk_end) = data_end.checked_add(4) else {
            return false;
        };
        if chunk_end > bytes.len() {
            return false;
        }
        let chunk_type = &bytes[type_start..type_start + 4];
        if index == 0 && (chunk_type != b"IHDR" || length != 13) {
            return false;
        }
        let declared_crc =
            u32::from_be_bytes(bytes[data_end..chunk_end].try_into().unwrap_or_default());
        if declared_crc != crc32(&bytes[type_start..data_end]) {
            return false;
        }
        if chunk_type == b"IDAT" {
            saw_image_data = true;
        }
        if chunk_type == b"IEND" {
            return length == 0 && saw_image_data && chunk_end == bytes.len();
        }
        offset = chunk_end;
        index += 1;
    }
    false
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    bytes
        .get(offset..offset + 4)
        .and_then(|value| value.try_into().ok())
        .map(u32::from_le_bytes)
        .ok_or_else(|| "binary container field is truncated.".to_string())
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffff_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320_u32 & 0_u32.wrapping_sub(crc & 1));
        }
    }
    crc ^ 0xffff_ffff_u32
}
