#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAiAssetIdPayload {
    pub local_asset_id: String,
}
