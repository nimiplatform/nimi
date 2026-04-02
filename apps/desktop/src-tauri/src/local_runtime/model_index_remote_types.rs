#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteModelFile {
    path: String,
    size_bytes: u64,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteInstallEntry {
    entry_id: String,
    format: String,
    entry: String,
    #[serde(default)]
    files: Vec<RemoteModelFile>,
    total_size_bytes: u64,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RemoteModelEntry {
    repo: String,
    revision: String,
    title: String,
    description: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    formats: Vec<String>,
    downloads: Option<u64>,
    likes: Option<u64>,
    last_modified: Option<String>,
    #[serde(default)]
    entries: Vec<RemoteInstallEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RemoteLeaderboardResponse {
    pub(super) schema_version: String,
    pub(super) generated_at: String,
    pub(super) capability: String,
    pub(super) page: usize,
    pub(super) page_size: usize,
    pub(super) total: usize,
    #[serde(default)]
    pub(super) items: Vec<RemoteModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelIndexCacheRecord {
    pub(super) fetched_at: String,
    #[serde(default)]
    pub(super) feeds: HashMap<String, RemoteLeaderboardResponse>,
}
