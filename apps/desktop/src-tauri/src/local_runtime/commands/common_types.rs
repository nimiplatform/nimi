#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiRecommendationFeedGetPayload {
    pub capability: Option<String>,
    pub page_size: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetIdPayload {
    pub local_asset_id: String,
}
