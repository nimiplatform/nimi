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
struct RemoteModelEntry {
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
struct RemoteLeaderboardResponse {
    schema_version: String,
    generated_at: String,
    capability: String,
    page: usize,
    page_size: usize,
    total: usize,
    #[serde(default)]
    items: Vec<RemoteModelEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ModelIndexCacheRecord {
    fetched_at: String,
    #[serde(default)]
    feeds: HashMap<String, RemoteLeaderboardResponse>,
}
