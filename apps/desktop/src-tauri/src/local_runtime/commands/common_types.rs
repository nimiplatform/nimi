#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsInstallPayload {
    pub model_id: String,
    pub repo: String,
    pub revision: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub engine: Option<String>,
    pub entry: Option<String>,
    pub files: Option<Vec<String>>,
    pub license: Option<String>,
    pub hashes: Option<std::collections::HashMap<String, String>>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsCatalogSearchPayload {
    pub query: Option<String>,
    pub capability: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationFeedGetPayload {
    pub capability: Option<String>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsCatalogListVariantsPayload {
    pub repo: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsCatalogResolveInstallPlanPayload {
    pub item_id: Option<String>,
    pub source: Option<String>,
    pub template_id: Option<String>,
    pub model_id: Option<String>,
    pub repo: Option<String>,
    pub revision: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub engine: Option<String>,
    pub entry: Option<String>,
    pub files: Option<Vec<String>>,
    pub license: Option<String>,
    pub hashes: Option<std::collections::HashMap<String, String>>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsImportFilePayload {
    pub file_path: String,
    pub model_name: Option<String>,
    pub capabilities: Vec<String>,
    pub engine: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelIdPayload {
    pub local_model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsHealthPayload {
    pub local_model_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiModelsHealthResult {
    pub models: Vec<LocalAiModelHealth>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAuditTimeRangePayload {
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAuditsListPayload {
    pub limit: Option<usize>,
    pub event_type: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub source: Option<String>,
    pub modality: Option<String>,
    pub local_model_id: Option<String>,
    pub mod_id: Option<String>,
    pub reason_code: Option<String>,
    pub time_range: Option<LocalAiAuditTimeRangePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInferenceAuditPayload {
    pub event_type: String,
    pub mod_id: String,
    pub source: String,
    pub provider: String,
    pub modality: String,
    pub adapter: Option<String>,
    pub model: Option<String>,
    pub local_model_id: Option<String>,
    pub endpoint: Option<String>,
    pub reason_code: Option<String>,
    pub detail: Option<String>,
    pub policy_gate: Option<serde_json::Value>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRuntimeAuditPayload {
    pub event_type: String,
    pub model_id: Option<String>,
    pub local_model_id: Option<String>,
    pub source: Option<String>,
    pub modality: Option<String>,
    pub reason_code: Option<String>,
    pub detail: Option<String>,
    pub payload: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfilesResolvePayload {
    pub mod_id: String,
    pub profile: LocalAiProfileDescriptor,
    pub capability: Option<String>,
    pub device_profile: Option<LocalAiDeviceProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiProfilesApplyPayload {
    pub plan: LocalAiProfileResolutionPlan,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServicesInstallPayload {
    pub service_id: String,
    pub title: Option<String>,
    pub engine: Option<String>,
    pub endpoint: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub local_model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiServiceIdPayload {
    pub service_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiNodesCatalogListPayload {
    pub capability: Option<String>,
    pub service_id: Option<String>,
    pub provider: Option<String>,
}
