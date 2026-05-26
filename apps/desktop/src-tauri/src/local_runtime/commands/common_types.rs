#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiInstallAcceptedResponse {
    pub install_session_id: String,
    pub model_id: String,
    pub local_model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetsInstallPayload {
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
pub struct LocalAiAssetsImportBundlePayload {
    pub directory_path: String,
    pub model_name: Option<String>,
    pub capabilities: Vec<String>,
    pub engine: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetIdPayload {
    pub local_asset_id: String,
}
