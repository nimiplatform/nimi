use serde::{Deserialize, Serialize};
use serde_json::Value;

#[path = "probe_bilibili.rs"]
mod probe_bilibili;
#[path = "probe_client.rs"]
mod probe_client;
#[path = "probe_geocode.rs"]
mod probe_geocode;
#[path = "probe_runner.rs"]
mod probe_runner;
#[cfg(test)]
#[path = "probe_tests.rs"]
mod tests;

pub use probe_bilibili::{
    extract_bvid_hint, load_bilibili_creator_video_feed,
};
pub use probe_geocode::{build_geocode_query, geocode_address};
pub use probe_runner::{path_display, run_probe};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeMetadata {
    pub bvid: String,
    pub aid: String,
    pub cid: String,
    pub title: String,
    pub owner_mid: String,
    pub owner_name: String,
    pub duration_sec: f64,
    pub description: String,
    pub tags: Vec<String>,
    pub canonical_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeExtractionCoverage {
    pub state: String,
    pub processed_segment_count: i64,
    pub processed_duration_sec: f64,
    pub total_duration_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSavedFiles {
    pub metadata_json: String,
    pub transcript_text: String,
    pub extraction_raw_text: String,
    pub extraction_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeCommentClue {
    pub comment_id: String,
    pub author_name: String,
    pub message: String,
    pub like_count: i64,
    pub published_at: String,
    pub matched_venue_names: Vec<String>,
    pub address_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub metadata: ProbeMetadata,
    pub audio_source_url: String,
    pub selected_stt_model: String,
    pub selected_text_model: String,
    pub raw_comment_count: i64,
    pub comment_clues: Vec<ProbeCommentClue>,
    pub extraction_coverage: ProbeExtractionCoverage,
    pub transcript: String,
    pub extraction_raw: String,
    pub extraction_json: Option<Value>,
    pub output_dir: String,
    pub saved_files: ProbeSavedFiles,
}

#[derive(Debug, Clone)]
pub struct GeocodeOutcome {
    pub provider: String,
    pub status: String,
    pub query: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorVideoCandidate {
    pub bvid: String,
    pub title: String,
    pub canonical_url: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorVideoFeed {
    pub creator_mid: String,
    pub creator_name: String,
    pub source_url: String,
    pub videos: Vec<CreatorVideoCandidate>,
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn extract_bilibili_creator_mid(input: &str) -> String {
    probe_bilibili::extract_bilibili_creator_mid(input)
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn canonicalize_bilibili_creator_url(input: &str) -> Result<String, String> {
    probe_bilibili::canonicalize_bilibili_creator_url(input)
}
