use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[path = "db_imports.rs"]
mod db_imports;
#[path = "db_schema.rs"]
mod db_schema;
#[path = "db_snapshot.rs"]
mod db_snapshot;
#[cfg(test)]
#[path = "db_tests.rs"]
mod tests;

pub use db_imports::{
    complete_import_by_id, lookup_import_by_bvid, mark_import_failed_by_id, queue_import,
    refresh_import_source_url, retry_import_by_id, save_creator_sync, set_import_stage,
    set_venue_confirmation, toggle_venue_favorite,
};
pub use db_snapshot::load_snapshot;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    pub import_count: usize,
    pub succeeded_count: usize,
    pub failed_count: usize,
    pub venue_count: usize,
    pub mapped_venue_count: usize,
    pub review_venue_count: usize,
    pub confirmed_venue_count: usize,
    pub favorite_venue_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VenueRecord {
    pub id: String,
    pub import_id: String,
    pub venue_name: String,
    pub address_text: String,
    pub recommended_dishes: Vec<String>,
    pub cuisine_tags: Vec<String>,
    pub flavor_tags: Vec<String>,
    pub evidence: Vec<String>,
    pub confidence: String,
    pub recommendation_polarity: String,
    pub needs_review: bool,
    pub review_state: String,
    pub geocode_status: String,
    pub geocode_query: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub user_confirmed: bool,
    pub is_favorite: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRecord {
    pub id: String,
    pub source_url: String,
    pub canonical_url: String,
    pub bvid: String,
    pub title: String,
    pub creator_name: String,
    pub creator_mid: String,
    pub description: String,
    pub tags: Vec<String>,
    pub duration_sec: f64,
    pub status: String,
    pub transcript: String,
    pub extraction_raw: String,
    pub video_summary: String,
    pub uncertain_points: Vec<String>,
    pub audio_source_url: String,
    pub selected_stt_model: String,
    pub selected_text_model: String,
    pub extraction_coverage: Option<Value>,
    pub output_dir: String,
    pub public_comment_count: i64,
    pub comment_clues: Vec<CommentClueRecord>,
    pub error_message: String,
    pub created_at: String,
    pub updated_at: String,
    pub venues: Vec<VenueRecord>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentClueRecord {
    pub comment_id: String,
    pub author_name: String,
    pub message: String,
    pub like_count: i64,
    pub published_at: String,
    pub matched_venue_names: Vec<String>,
    pub address_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapPoint {
    pub venue_id: String,
    pub import_id: String,
    pub venue_name: String,
    pub creator_name: String,
    pub title: String,
    pub address_text: String,
    pub latitude: f64,
    pub longitude: f64,
    pub is_favorite: bool,
    pub user_confirmed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub imports: Vec<ImportRecord>,
    pub map_points: Vec<MapPoint>,
    pub creator_syncs: Vec<CreatorSyncRecord>,
    pub stats: SnapshotStats,
}

#[derive(Debug)]
pub struct QueuedImport {
    pub record: ImportRecord,
    pub should_start: bool,
}

#[derive(Debug)]
pub struct ImportLookup {
    pub id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatorSyncRecord {
    pub creator_mid: String,
    pub creator_name: String,
    pub source_url: String,
    pub last_synced_at: String,
    pub last_scanned_count: i64,
    pub last_queued_count: i64,
    pub last_skipped_existing_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ImportRow {
    pub(crate) id: String,
    pub(crate) source_url: String,
    pub(crate) canonical_url: String,
    pub(crate) bvid: String,
    pub(crate) title: String,
    pub(crate) creator_name: String,
    pub(crate) creator_mid: String,
    pub(crate) description: String,
    pub(crate) tags_json: String,
    pub(crate) duration_sec: f64,
    pub(crate) status: String,
    pub(crate) transcript: String,
    pub(crate) extraction_raw: String,
    pub(crate) video_summary: String,
    pub(crate) uncertain_points_json: String,
    pub(crate) audio_source_url: String,
    pub(crate) selected_stt_model: String,
    pub(crate) selected_text_model: String,
    pub(crate) extraction_coverage_json: String,
    pub(crate) output_dir: String,
    pub(crate) public_comment_count: i64,
    pub(crate) comment_clues_json: String,
    pub(crate) error_message: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

pub(crate) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) fn generate_id(prefix: &str) -> String {
    static NEXT_ID_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let timestamp = Utc::now().timestamp_micros();
    let sequence = NEXT_ID_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{timestamp}-{sequence}")
}

pub(crate) fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string())
}

pub(crate) fn parse_string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

pub(crate) fn parse_json_value(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(trimmed).ok()
}

pub(crate) fn parse_comment_clues(raw: &str) -> Vec<CommentClueRecord> {
    serde_json::from_str::<Vec<CommentClueRecord>>(raw).unwrap_or_default()
}
