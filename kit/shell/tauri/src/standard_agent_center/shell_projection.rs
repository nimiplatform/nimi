use super::*;

pub(crate) fn avatar_material_select_result(
    result: StandardAgentCenterAvatarMaterialSelectResult,
) -> serde_json::Value {
    serde_json::json!({
        "role": result.role,
        "fileName": result.file_name,
        "mediaType": result.media_type,
        "content": result.content,
        "sha256": result.sha256,
        "custodyRef": result.custody_ref,
        "backendKind": avatar_backend_kind_label(result.backend_kind),
    })
}

pub(crate) fn background_material_select_result(
    result: StandardAgentCenterBackgroundMaterialSelectResult,
) -> serde_json::Value {
    serde_json::json!({
        "role": result.role,
        "fileName": result.file_name,
        "mediaType": result.media_type,
        "content": result.content,
        "sha256": result.sha256,
        "custodyRef": result.custody_ref,
    })
}
