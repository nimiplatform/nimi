use base64::Engine as _;

use crate::runtime_bridge::generated as runtime_bridge_generated;
use crate::runtime_bridge::RuntimeBridgeUnaryPayload;

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeInstallVerifiedAssetRequest {
    #[prost(string, tag = "1")]
    template_id: String,
    #[prost(string, tag = "2")]
    endpoint: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeInstallVerifiedAssetResponse {
    #[prost(message, optional, tag = "1")]
    asset: Option<runtime_bridge_generated::LocalAssetRecord>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeImportLocalAssetRequest {
    #[prost(string, tag = "1")]
    manifest_path: String,
    #[prost(string, tag = "2")]
    endpoint: String,
    #[prost(message, optional, tag = "3")]
    engine_config: Option<prost_types::Struct>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeImportLocalAssetResponse {
    #[prost(message, optional, tag = "1")]
    asset: Option<runtime_bridge_generated::LocalAssetRecord>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeScaffoldOrphanAssetRequest {
    #[prost(string, tag = "1")]
    path: String,
    #[prost(enumeration = "runtime_bridge_generated::LocalAssetKind", tag = "2")]
    kind: i32,
    #[prost(string, tag = "3")]
    engine: String,
    #[prost(string, repeated, tag = "4")]
    capabilities: Vec<String>,
    #[prost(string, tag = "5")]
    endpoint: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeScaffoldOrphanAssetResponse {
    #[prost(message, optional, tag = "1")]
    asset: Option<runtime_bridge_generated::LocalAssetRecord>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeRemoveLocalAssetRequest {
    #[prost(string, tag = "1")]
    local_asset_id: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeRemoveLocalAssetResponse {
    #[prost(message, optional, tag = "1")]
    asset: Option<runtime_bridge_generated::LocalAssetRecord>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeStartLocalAssetRequest {
    #[prost(string, tag = "1")]
    local_asset_id: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeStartLocalAssetResponse {
    #[prost(message, optional, tag = "1")]
    asset: Option<runtime_bridge_generated::LocalAssetRecord>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeStopLocalAssetRequest {
    #[prost(string, tag = "1")]
    local_asset_id: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeStopLocalAssetResponse {
    #[prost(message, optional, tag = "1")]
    asset: Option<runtime_bridge_generated::LocalAssetRecord>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeCheckLocalAssetHealthRequest {
    #[prost(string, tag = "1")]
    local_asset_id: String,
}

#[derive(Clone, PartialEq, ::prost::Message)]
struct RuntimeCheckLocalAssetHealthResponse {
    #[prost(message, repeated, tag = "1")]
    assets: Vec<runtime_bridge_generated::LocalAssetHealth>,
}

fn runtime_bridge_local_service_unary<Request, Response>(
    method_id: &str,
    request: &Request,
) -> Result<Response, String>
where
    Request: prost::Message,
    Response: prost::Message + Default,
{
    let request_bytes = request.encode_to_vec();
    let payload = RuntimeBridgeUnaryPayload {
        method_id: method_id.to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD.encode(request_bytes),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: None,
    };
    let result = tauri::async_runtime::block_on(crate::runtime_bridge::runtime_bridge_unary(payload))?;
    let response_bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64.trim())
        .map_err(|_| "RUNTIME_LOCAL_SERVICE_RESPONSE_DECODE_FAILED: invalid base64 response".to_string())?;
    Response::decode(response_bytes.as_slice())
        .map_err(|error| format!("RUNTIME_LOCAL_SERVICE_RESPONSE_PROTO_DECODE_FAILED: {error}"))
}

fn json_to_prost_value(value: &serde_json::Value) -> prost_types::Value {
    let kind = match value {
        serde_json::Value::Null => prost_types::value::Kind::NullValue(0),
        serde_json::Value::Bool(value) => prost_types::value::Kind::BoolValue(*value),
        serde_json::Value::Number(value) => {
            prost_types::value::Kind::NumberValue(value.as_f64().unwrap_or_default())
        }
        serde_json::Value::String(value) => prost_types::value::Kind::StringValue(value.clone()),
        serde_json::Value::Array(items) => prost_types::value::Kind::ListValue(prost_types::ListValue {
            values: items.iter().map(json_to_prost_value).collect(),
        }),
        serde_json::Value::Object(entries) => prost_types::value::Kind::StructValue(prost_types::Struct {
            fields: entries
                .iter()
                .map(|(key, value)| (key.clone(), json_to_prost_value(value)))
                .collect(),
        }),
    };
    prost_types::Value { kind: Some(kind) }
}

fn prost_to_json_value(value: prost_types::Value) -> serde_json::Value {
    match value.kind {
        Some(prost_types::value::Kind::NullValue(_)) | None => serde_json::Value::Null,
        Some(prost_types::value::Kind::BoolValue(value)) => serde_json::Value::Bool(value),
        Some(prost_types::value::Kind::NumberValue(value)) => serde_json::json!(value),
        Some(prost_types::value::Kind::StringValue(value)) => serde_json::Value::String(value),
        Some(prost_types::value::Kind::StructValue(value)) => prost_struct_to_json(value),
        Some(prost_types::value::Kind::ListValue(value)) => serde_json::Value::Array(
            value.values.into_iter().map(prost_to_json_value).collect(),
        ),
    }
}

fn prost_struct_to_json(value: prost_types::Struct) -> serde_json::Value {
    serde_json::Value::Object(
        value
            .fields
            .into_iter()
            .map(|(key, value)| (key, prost_to_json_value(value)))
            .collect(),
    )
}

fn bridge_engine_config(value: Option<&serde_json::Value>) -> Result<Option<prost_types::Struct>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let serde_json::Value::Object(entries) = value else {
        return Err("LOCAL_AI_ENGINE_CONFIG_INVALID: engineConfig must be a JSON object".to_string());
    };
    Ok(Some(prost_types::Struct {
        fields: entries
            .iter()
            .map(|(key, value)| (key.clone(), json_to_prost_value(value)))
            .collect(),
    }))
}

fn bridge_json_value(value: Option<prost_types::Struct>) -> Option<serde_json::Value> {
    value.map(prost_struct_to_json)
}

fn bridge_asset_kind(
    value: i32,
) -> Result<LocalAiAssetKind, String> {
    match runtime_bridge_generated::LocalAssetKind::try_from(value) {
        Ok(runtime_bridge_generated::LocalAssetKind::Chat) => Ok(LocalAiAssetKind::Chat),
        Ok(runtime_bridge_generated::LocalAssetKind::Image) => Ok(LocalAiAssetKind::Image),
        Ok(runtime_bridge_generated::LocalAssetKind::Video) => Ok(LocalAiAssetKind::Video),
        Ok(runtime_bridge_generated::LocalAssetKind::Tts) => Ok(LocalAiAssetKind::Tts),
        Ok(runtime_bridge_generated::LocalAssetKind::Stt) => Ok(LocalAiAssetKind::Stt),
        Ok(runtime_bridge_generated::LocalAssetKind::Embedding) => Ok(LocalAiAssetKind::Embedding),
        Ok(runtime_bridge_generated::LocalAssetKind::Vae) => Ok(LocalAiAssetKind::Vae),
        Ok(runtime_bridge_generated::LocalAssetKind::Clip) => Ok(LocalAiAssetKind::Clip),
        Ok(runtime_bridge_generated::LocalAssetKind::Lora) => Ok(LocalAiAssetKind::Lora),
        Ok(runtime_bridge_generated::LocalAssetKind::Controlnet) => Ok(LocalAiAssetKind::Controlnet),
        Ok(runtime_bridge_generated::LocalAssetKind::Auxiliary) => Ok(LocalAiAssetKind::Auxiliary),
        _ => Err(format!("RUNTIME_LOCAL_SERVICE_ASSET_KIND_INVALID: value={value}")),
    }
}

fn runtime_bridge_asset_kind(value: &LocalAiAssetKind) -> runtime_bridge_generated::LocalAssetKind {
    match value {
        LocalAiAssetKind::Chat => runtime_bridge_generated::LocalAssetKind::Chat,
        LocalAiAssetKind::Image => runtime_bridge_generated::LocalAssetKind::Image,
        LocalAiAssetKind::Video => runtime_bridge_generated::LocalAssetKind::Video,
        LocalAiAssetKind::Tts => runtime_bridge_generated::LocalAssetKind::Tts,
        LocalAiAssetKind::Stt => runtime_bridge_generated::LocalAssetKind::Stt,
        LocalAiAssetKind::Embedding => runtime_bridge_generated::LocalAssetKind::Embedding,
        LocalAiAssetKind::Vae => runtime_bridge_generated::LocalAssetKind::Vae,
        LocalAiAssetKind::Clip => runtime_bridge_generated::LocalAssetKind::Clip,
        LocalAiAssetKind::Lora => runtime_bridge_generated::LocalAssetKind::Lora,
        LocalAiAssetKind::Controlnet => runtime_bridge_generated::LocalAssetKind::Controlnet,
        LocalAiAssetKind::Auxiliary => runtime_bridge_generated::LocalAssetKind::Auxiliary,
    }
}

fn bridge_asset_status(
    value: i32,
) -> Result<LocalAiAssetStatus, String> {
    match runtime_bridge_generated::LocalAssetStatus::try_from(value) {
        Ok(runtime_bridge_generated::LocalAssetStatus::Installed) => Ok(LocalAiAssetStatus::Installed),
        Ok(runtime_bridge_generated::LocalAssetStatus::Active) => Ok(LocalAiAssetStatus::Active),
        Ok(runtime_bridge_generated::LocalAssetStatus::Unhealthy) => Ok(LocalAiAssetStatus::Unhealthy),
        Ok(runtime_bridge_generated::LocalAssetStatus::Removed) => Ok(LocalAiAssetStatus::Removed),
        _ => Err(format!("RUNTIME_LOCAL_SERVICE_ASSET_STATUS_INVALID: value={value}")),
    }
}

fn bridge_runtime_asset_record(
    asset: runtime_bridge_generated::LocalAssetRecord,
) -> Result<LocalAiAssetRecord, String> {
    let source = asset.source.unwrap_or(runtime_bridge_generated::LocalAssetSource {
        repo: String::new(),
        revision: String::new(),
    });
    let source = LocalAiAssetSource {
        repo: source.repo,
        revision: source.revision,
    };
    let integrity_mode = if source.repo.trim().is_empty() && source.revision.trim().is_empty() {
        None
    } else {
        Some(infer_asset_integrity_mode_from_source(&source))
    };
    let health_detail = if asset.health_detail.trim().is_empty() {
        None
    } else {
        Some(asset.health_detail)
    };
    let preferred_engine = if asset.preferred_engine.trim().is_empty() {
        None
    } else {
        Some(asset.preferred_engine)
    };

    Ok(LocalAiAssetRecord {
        local_asset_id: asset.local_asset_id,
        asset_id: asset.asset_id,
        kind: bridge_asset_kind(asset.kind)?,
        logical_model_id: asset.logical_model_id,
        capabilities: asset.capabilities,
        engine: asset.engine,
        entry: asset.entry,
        files: asset.files,
        license: asset.license,
        source,
        integrity_mode,
        hashes: asset.hashes,
        tags: Vec::new(),
        known_total_size_bytes: None,
        endpoint: asset.endpoint,
        status: bridge_asset_status(asset.status)?,
        installed_at: asset.installed_at,
        updated_at: asset.updated_at,
        health_detail,
        artifact_roles: asset.artifact_roles,
        preferred_engine,
        fallback_engines: asset.fallback_engines,
        engine_config: bridge_json_value(asset.engine_config),
        recommendation: None,
        metadata: bridge_json_value(asset.metadata),
    })
}

fn bridge_runtime_asset_health(
    asset: runtime_bridge_generated::LocalAssetHealth,
) -> Result<LocalAiAssetHealth, String> {
    Ok(LocalAiAssetHealth {
        local_asset_id: asset.local_asset_id,
        status: bridge_asset_status(asset.status)?,
        detail: asset.detail,
        endpoint: asset.endpoint,
    })
}

pub(crate) fn runtime_install_verified_asset_via_runtime(
    template_id: &str,
    endpoint: Option<&str>,
) -> Result<LocalAiAssetRecord, String> {
    let response: RuntimeInstallVerifiedAssetResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/InstallVerifiedAsset",
        &RuntimeInstallVerifiedAssetRequest {
            template_id: template_id.trim().to_string(),
            endpoint: endpoint.unwrap_or_default().trim().to_string(),
        },
    )?;
    let asset = response
        .asset
        .ok_or_else(|| "RUNTIME_LOCAL_SERVICE_ASSET_MISSING: InstallVerifiedAsset returned no asset".to_string())?;
    bridge_runtime_asset_record(asset)
}

pub(crate) fn runtime_import_manifest_via_runtime(
    manifest_path: &std::path::Path,
    endpoint: Option<&str>,
    engine_config: Option<&serde_json::Value>,
) -> Result<LocalAiAssetRecord, String> {
    let response: RuntimeImportLocalAssetResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/ImportLocalAsset",
        &RuntimeImportLocalAssetRequest {
            manifest_path: manifest_path.to_string_lossy().to_string(),
            endpoint: endpoint.unwrap_or_default().trim().to_string(),
            engine_config: bridge_engine_config(engine_config)?,
        },
    )?;
    let asset = response
        .asset
        .ok_or_else(|| "RUNTIME_LOCAL_SERVICE_ASSET_MISSING: ImportLocalAsset returned no asset".to_string())?;
    bridge_runtime_asset_record(asset)
}

pub(crate) fn runtime_scaffold_orphan_asset_via_runtime(
    path: &std::path::Path,
    kind: &LocalAiAssetKind,
    capabilities: &[String],
    engine: Option<&str>,
    endpoint: Option<&str>,
) -> Result<LocalAiAssetRecord, String> {
    let response: RuntimeScaffoldOrphanAssetResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/ScaffoldOrphanAsset",
        &RuntimeScaffoldOrphanAssetRequest {
            path: path.to_string_lossy().to_string(),
            kind: runtime_bridge_asset_kind(kind) as i32,
            engine: engine.unwrap_or_default().trim().to_string(),
            capabilities: capabilities.to_vec(),
            endpoint: endpoint.unwrap_or_default().trim().to_string(),
        },
    )?;
    let asset = response
        .asset
        .ok_or_else(|| "RUNTIME_LOCAL_SERVICE_ASSET_MISSING: ScaffoldOrphanAsset returned no asset".to_string())?;
    bridge_runtime_asset_record(asset)
}

pub(crate) fn runtime_remove_asset_via_runtime(local_asset_id: &str) -> Result<LocalAiAssetRecord, String> {
    let response: RuntimeRemoveLocalAssetResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/RemoveLocalAsset",
        &RuntimeRemoveLocalAssetRequest {
            local_asset_id: local_asset_id.trim().to_string(),
        },
    )?;
    let asset = response
        .asset
        .ok_or_else(|| "RUNTIME_LOCAL_SERVICE_ASSET_MISSING: RemoveLocalAsset returned no asset".to_string())?;
    bridge_runtime_asset_record(asset)
}

pub(crate) fn runtime_start_asset_via_runtime(local_asset_id: &str) -> Result<LocalAiAssetRecord, String> {
    let response: RuntimeStartLocalAssetResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/StartLocalAsset",
        &RuntimeStartLocalAssetRequest {
            local_asset_id: local_asset_id.trim().to_string(),
        },
    )?;
    let asset = response
        .asset
        .ok_or_else(|| "RUNTIME_LOCAL_SERVICE_ASSET_MISSING: StartLocalAsset returned no asset".to_string())?;
    bridge_runtime_asset_record(asset)
}

pub(crate) fn runtime_stop_asset_via_runtime(local_asset_id: &str) -> Result<LocalAiAssetRecord, String> {
    let response: RuntimeStopLocalAssetResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/StopLocalAsset",
        &RuntimeStopLocalAssetRequest {
            local_asset_id: local_asset_id.trim().to_string(),
        },
    )?;
    let asset = response
        .asset
        .ok_or_else(|| "RUNTIME_LOCAL_SERVICE_ASSET_MISSING: StopLocalAsset returned no asset".to_string())?;
    bridge_runtime_asset_record(asset)
}

pub(crate) fn runtime_health_assets_via_runtime(
    local_asset_id: Option<&str>,
) -> Result<Vec<LocalAiAssetHealth>, String> {
    let response: RuntimeCheckLocalAssetHealthResponse = runtime_bridge_local_service_unary(
        "/nimi.runtime.v1.RuntimeLocalService/CheckLocalAssetHealth",
        &RuntimeCheckLocalAssetHealthRequest {
            local_asset_id: local_asset_id.unwrap_or_default().trim().to_string(),
        },
    )?;
    response
        .assets
        .into_iter()
        .map(bridge_runtime_asset_health)
        .collect()
}
