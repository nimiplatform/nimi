use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::desktop_paths;
use crate::probe::{
    build_geocode_query, geocode_address, path_display, GeocodeOutcome, ProbeCommentClue,
    ProbeResult,
};

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
    pub stats: SnapshotStats,
}

#[derive(Debug, Clone)]
struct ImportRow {
    id: String,
    source_url: String,
    canonical_url: String,
    bvid: String,
    title: String,
    creator_name: String,
    creator_mid: String,
    description: String,
    tags_json: String,
    duration_sec: f64,
    status: String,
    transcript: String,
    extraction_raw: String,
    video_summary: String,
    uncertain_points_json: String,
    audio_source_url: String,
    selected_stt_model: String,
    extraction_coverage_json: String,
    output_dir: String,
    public_comment_count: i64,
    comment_clues_json: String,
    error_message: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug)]
struct VenueInput {
    venue_name: String,
    address_text: String,
    recommended_dishes: Vec<String>,
    cuisine_tags: Vec<String>,
    flavor_tags: Vec<String>,
    evidence: Vec<String>,
    confidence: String,
    recommendation_polarity: String,
    needs_review: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct VenueUserState {
    user_confirmed: bool,
    is_favorite: bool,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn generate_id(prefix: &str) -> String {
    format!("{prefix}-{}", Utc::now().timestamp_millis())
}

fn app_data_dir() -> Result<PathBuf, String> {
    let root = desktop_paths::resolve_nimi_data_dir()?.join("video-food-map");
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create video-food-map data dir ({}): {error}",
            root.display()
        )
    })?;
    Ok(root)
}

fn db_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("video-food-map.sqlite"))
}

fn to_json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".to_string())
}

fn parse_string_array(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn parse_json_value(raw: &str) -> Option<Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str::<Value>(trimmed).ok()
}

fn parse_comment_clues(raw: &str) -> Vec<CommentClueRecord> {
    serde_json::from_str::<Vec<CommentClueRecord>>(raw).unwrap_or_default()
}

fn table_has_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| format!("failed to inspect sqlite schema for {table_name}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("failed to query sqlite schema for {table_name}: {error}"))?;
    for row in rows {
        let current = row.map_err(|error| {
            format!("failed to read sqlite schema row for {table_name}: {error}")
        })?;
        if current == column_name {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<(), String> {
    if table_has_column(conn, table_name, column_name)? {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"),
        [],
    )
    .map_err(|error| format!("failed to add column {table_name}.{column_name}: {error}"))?;
    Ok(())
}

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS imports (
          id TEXT PRIMARY KEY,
          source_url TEXT NOT NULL,
          canonical_url TEXT NOT NULL DEFAULT '',
          bvid TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          creator_name TEXT NOT NULL DEFAULT '',
          creator_mid TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          duration_sec REAL NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'running',
          transcript TEXT NOT NULL DEFAULT '',
          extraction_raw TEXT NOT NULL DEFAULT '',
          video_summary TEXT NOT NULL DEFAULT '',
          uncertain_points_json TEXT NOT NULL DEFAULT '[]',
          audio_source_url TEXT NOT NULL DEFAULT '',
          selected_stt_model TEXT NOT NULL DEFAULT '',
          extraction_coverage_json TEXT NOT NULL DEFAULT '',
          output_dir TEXT NOT NULL DEFAULT '',
          public_comment_count INTEGER NOT NULL DEFAULT 0,
          comment_clues_json TEXT NOT NULL DEFAULT '[]',
          error_message TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_bvid ON imports(bvid) WHERE bvid <> '';

        CREATE TABLE IF NOT EXISTS venues (
          id TEXT PRIMARY KEY,
          import_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          venue_name TEXT NOT NULL DEFAULT '',
          address_text TEXT NOT NULL DEFAULT '',
          recommended_dishes_json TEXT NOT NULL DEFAULT '[]',
          cuisine_tags_json TEXT NOT NULL DEFAULT '[]',
          flavor_tags_json TEXT NOT NULL DEFAULT '[]',
          evidence_json TEXT NOT NULL DEFAULT '[]',
          confidence TEXT NOT NULL DEFAULT '',
          recommendation_polarity TEXT NOT NULL DEFAULT '',
          needs_review INTEGER NOT NULL DEFAULT 0,
          review_state TEXT NOT NULL DEFAULT 'review',
          geocode_status TEXT NOT NULL DEFAULT 'skipped',
          geocode_provider TEXT NOT NULL DEFAULT '',
          geocode_query TEXT NOT NULL DEFAULT '',
          latitude REAL,
          longitude REAL,
          user_confirmed INTEGER NOT NULL DEFAULT 0,
          is_favorite INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(import_id) REFERENCES imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_venues_import_id ON venues(import_id);
        ",
    )
    .map_err(|error| format!("failed to initialize sqlite schema: {error}"))?;
    ensure_column(
        conn,
        "imports",
        "public_comment_count",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "imports",
        "comment_clues_json",
        "TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "venues",
        "user_confirmed",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "venues",
        "is_favorite",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    Ok(())
}

fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
    let conn = Connection::open(&path).map_err(|error| {
        format!(
            "failed to open sqlite db ({}): {error}",
            path_display(&path)
        )
    })?;
    ensure_schema(&conn)?;
    Ok(conn)
}

fn row_to_import(row: &rusqlite::Row<'_>) -> Result<ImportRow, rusqlite::Error> {
    Ok(ImportRow {
        id: row.get("id")?,
        source_url: row.get("source_url")?,
        canonical_url: row.get("canonical_url")?,
        bvid: row.get("bvid")?,
        title: row.get("title")?,
        creator_name: row.get("creator_name")?,
        creator_mid: row.get("creator_mid")?,
        description: row.get("description")?,
        tags_json: row.get("tags_json")?,
        duration_sec: row.get("duration_sec")?,
        status: row.get("status")?,
        transcript: row.get("transcript")?,
        extraction_raw: row.get("extraction_raw")?,
        video_summary: row.get("video_summary")?,
        uncertain_points_json: row.get("uncertain_points_json")?,
        audio_source_url: row.get("audio_source_url")?,
        selected_stt_model: row.get("selected_stt_model")?,
        extraction_coverage_json: row.get("extraction_coverage_json")?,
        output_dir: row.get("output_dir")?,
        public_comment_count: row.get("public_comment_count")?,
        comment_clues_json: row.get("comment_clues_json")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn load_venues_for_import(conn: &Connection, import_id: &str) -> Result<Vec<VenueRecord>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT
              id,
              import_id,
              venue_name,
              address_text,
              recommended_dishes_json,
              cuisine_tags_json,
              flavor_tags_json,
              evidence_json,
              confidence,
              recommendation_polarity,
              needs_review,
              review_state,
              geocode_status,
              geocode_query,
              latitude,
              longitude,
              user_confirmed,
              is_favorite,
              created_at,
              updated_at
            FROM venues
            WHERE import_id = ?1
            ORDER BY ordinal ASC
            ",
        )
        .map_err(|error| format!("failed to prepare venue query: {error}"))?;

    let rows = statement
        .query_map(params![import_id], |row| {
            Ok(VenueRecord {
                id: row.get("id")?,
                import_id: row.get("import_id")?,
                venue_name: row.get("venue_name")?,
                address_text: row.get("address_text")?,
                recommended_dishes: parse_string_array(
                    &row.get::<_, String>("recommended_dishes_json")?,
                ),
                cuisine_tags: parse_string_array(&row.get::<_, String>("cuisine_tags_json")?),
                flavor_tags: parse_string_array(&row.get::<_, String>("flavor_tags_json")?),
                evidence: parse_string_array(&row.get::<_, String>("evidence_json")?),
                confidence: row.get("confidence")?,
                recommendation_polarity: row.get("recommendation_polarity")?,
                needs_review: row.get::<_, i64>("needs_review")? != 0,
                review_state: row.get("review_state")?,
                geocode_status: row.get("geocode_status")?,
                geocode_query: row.get("geocode_query")?,
                latitude: row.get("latitude")?,
                longitude: row.get("longitude")?,
                user_confirmed: row.get::<_, i64>("user_confirmed")? != 0,
                is_favorite: row.get::<_, i64>("is_favorite")? != 0,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })
        .map_err(|error| format!("failed to query venues: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect venues: {error}"))
}

fn hydrate_import(conn: &Connection, row: ImportRow) -> Result<ImportRecord, String> {
    Ok(ImportRecord {
        id: row.id.clone(),
        source_url: row.source_url,
        canonical_url: row.canonical_url,
        bvid: row.bvid,
        title: row.title,
        creator_name: row.creator_name,
        creator_mid: row.creator_mid,
        description: row.description,
        tags: parse_string_array(&row.tags_json),
        duration_sec: row.duration_sec,
        status: row.status,
        transcript: row.transcript,
        extraction_raw: row.extraction_raw,
        video_summary: row.video_summary,
        uncertain_points: parse_string_array(&row.uncertain_points_json),
        audio_source_url: row.audio_source_url,
        selected_stt_model: row.selected_stt_model,
        extraction_coverage: parse_json_value(&row.extraction_coverage_json),
        output_dir: row.output_dir,
        public_comment_count: row.public_comment_count,
        comment_clues: parse_comment_clues(&row.comment_clues_json),
        error_message: row.error_message,
        created_at: row.created_at,
        updated_at: row.updated_at,
        venues: load_venues_for_import(conn, &row.id)?,
    })
}

fn load_import_row(conn: &Connection, import_id: &str) -> Result<ImportRow, String> {
    conn.query_row(
        "SELECT * FROM imports WHERE id = ?1",
        params![import_id],
        row_to_import,
    )
    .map_err(|error| format!("failed to load import {import_id}: {error}"))
}

fn ensure_import_row(
    conn: &Connection,
    source_url: &str,
    bvid_hint: &str,
) -> Result<String, String> {
    let existing_id = if !bvid_hint.trim().is_empty() {
        conn.query_row(
            "SELECT id FROM imports WHERE bvid = ?1 LIMIT 1",
            params![bvid_hint],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to query import by bvid: {error}"))?
    } else {
        None
    };

    if let Some(id) = existing_id {
        let now = now_iso();
        conn.execute(
            "UPDATE imports SET status = 'running', source_url = ?1, error_message = '', updated_at = ?2 WHERE id = ?3",
            params![source_url, now, id],
        )
        .map_err(|error| format!("failed to mark import running: {error}"))?;
        return Ok(id);
    }

    let id = generate_id("import");
    let now = now_iso();
    conn.execute(
        "
        INSERT INTO imports (
          id,
          source_url,
          status,
          created_at,
          updated_at
        ) VALUES (?1, ?2, 'running', ?3, ?4)
        ",
        params![id, source_url, now, now],
    )
    .map_err(|error| format!("failed to insert import row: {error}"))?;
    Ok(id)
}

fn update_import_status_by_id(
    conn: &Connection,
    import_id: &str,
    status: &str,
    error_message: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE imports SET status = ?1, error_message = ?2, updated_at = ?3 WHERE id = ?4",
        params![status, error_message, now_iso(), import_id],
    )
    .map_err(|error| format!("failed to update import status: {error}"))?;
    Ok(())
}

fn read_string_field(value: Option<&Value>, key: &str) -> String {
    value
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_default()
}

fn read_bool_field(value: Option<&Value>, key: &str) -> bool {
    value
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
}

fn read_string_array_field(value: Option<&Value>, key: &str) -> Vec<String> {
    value
        .and_then(|value| value.get(key))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn parse_venue_inputs(extraction_json: Option<&Value>) -> Vec<VenueInput> {
    let Some(value) = extraction_json else {
        return Vec::new();
    };
    let Some(items) = value.get("venues").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|item| {
            if !item.is_object() {
                return None;
            }
            Some(VenueInput {
                venue_name: read_string_field(Some(item), "venue_name"),
                address_text: read_string_field(Some(item), "address_text"),
                recommended_dishes: read_string_array_field(Some(item), "recommended_dishes"),
                cuisine_tags: read_string_array_field(Some(item), "cuisine_tags"),
                flavor_tags: read_string_array_field(Some(item), "flavor_tags"),
                evidence: read_string_array_field(Some(item), "evidence"),
                confidence: read_string_field(Some(item), "confidence"),
                recommendation_polarity: read_string_field(Some(item), "recommendation_polarity"),
                needs_review: read_bool_field(Some(item), "needs_review"),
            })
        })
        .collect()
}

fn read_uncertain_points(extraction_json: Option<&Value>) -> Vec<String> {
    extraction_json
        .and_then(|value| value.get("uncertain_points"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn read_video_summary(extraction_json: Option<&Value>) -> String {
    extraction_json
        .and_then(|value| value.get("video_summary"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_default()
}

fn to_comment_clue_records(items: &[ProbeCommentClue]) -> Vec<CommentClueRecord> {
    items
        .iter()
        .map(|item| CommentClueRecord {
            comment_id: item.comment_id.clone(),
            author_name: item.author_name.clone(),
            message: item.message.clone(),
            like_count: item.like_count,
            published_at: item.published_at.clone(),
            matched_venue_names: item.matched_venue_names.clone(),
            address_hint: item.address_hint.clone(),
        })
        .collect()
}

fn normalize_text_key(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .chars()
        .filter(|char| !char.is_whitespace())
        .collect()
}

fn venue_user_key(venue_name: &str, address_text: &str) -> String {
    let normalized_name = normalize_text_key(venue_name);
    let normalized_address = normalize_text_key(address_text);
    if normalized_name.is_empty() && normalized_address.is_empty() {
        return String::new();
    }
    format!("{normalized_name}::{normalized_address}")
}

fn load_existing_venue_user_state(
    conn: &Connection,
    import_id: &str,
) -> Result<std::collections::HashMap<String, VenueUserState>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT venue_name, address_text, user_confirmed, is_favorite
            FROM venues
            WHERE import_id = ?1
            ",
        )
        .map_err(|error| format!("failed to prepare venue user state query: {error}"))?;

    let rows = statement
        .query_map(params![import_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                VenueUserState {
                    user_confirmed: row.get::<_, i64>(2)? != 0,
                    is_favorite: row.get::<_, i64>(3)? != 0,
                },
            ))
        })
        .map_err(|error| format!("failed to query venue user state: {error}"))?;

    let mut states = std::collections::HashMap::new();
    for row in rows {
        let (venue_name, address_text, state) =
            row.map_err(|error| format!("failed to read venue user state: {error}"))?;
        let key = venue_user_key(&venue_name, &address_text);
        if !key.is_empty() {
            states.entry(key).or_insert(state);
        }
    }
    Ok(states)
}

fn address_is_specific(address_text: &str) -> bool {
    let normalized = address_text.trim();
    if normalized.is_empty() {
        return false;
    }

    let has_digit = normalized.chars().any(|char| char.is_ascii_digit());
    let detailed_markers = [
        "号", "路", "街", "巷", "弄", "大道", "道", "楼", "层", "栋", "室", "城", "广场",
    ];
    let vague_markers = [
        "附近",
        "旁边",
        "周边",
        "对面",
        "里面",
        "门口",
        "地铁",
        "公交",
        "商圈",
        "一带",
        "附近的",
    ];

    if vague_markers
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return false;
    }

    if has_digit {
        return true;
    }

    detailed_markers
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn resolve_review_state(input: &VenueInput, geocode: &GeocodeOutcome) -> String {
    if geocode.status == "resolved"
        && input.confidence.trim() != "low"
        && !input.venue_name.trim().is_empty()
        && address_is_specific(&input.address_text)
    {
        return "map_ready".to_string();
    }
    if input.needs_review || input.venue_name.trim().is_empty() {
        return "review".to_string();
    }
    if input.address_text.trim().is_empty() {
        return "search_only".to_string();
    }
    if geocode.status == "failed" {
        return "review".to_string();
    }
    "search_only".to_string()
}

fn should_show_on_map(venue: &VenueRecord) -> bool {
    (venue.review_state == "map_ready" || venue.user_confirmed)
        && venue.latitude.is_some()
        && venue.longitude.is_some()
}

fn load_import_id_for_venue(conn: &Connection, venue_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT import_id FROM venues WHERE id = ?1",
        params![venue_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|error| format!("failed to load import id for venue {venue_id}: {error}"))
}

fn replace_venues(conn: &Connection, import_id: &str, venues: &[VenueInput]) -> Result<(), String> {
    let existing_user_states = load_existing_venue_user_state(conn, import_id)?;
    conn.execute(
        "DELETE FROM venues WHERE import_id = ?1",
        params![import_id],
    )
    .map_err(|error| format!("failed to clear existing venues: {error}"))?;

    for (index, venue) in venues.iter().enumerate() {
        let user_state = existing_user_states
            .get(&venue_user_key(&venue.venue_name, &venue.address_text))
            .copied()
            .unwrap_or_default();
        let geocode_query = build_geocode_query(&venue.venue_name, &venue.address_text);
        let geocode =
            if venue.address_text.trim().is_empty() || !address_is_specific(&venue.address_text) {
                GeocodeOutcome {
                    provider: "amap".to_string(),
                    status: "skipped".to_string(),
                    query: if address_is_specific(&venue.address_text) {
                        String::new()
                    } else {
                        geocode_query.clone()
                    },
                    latitude: None,
                    longitude: None,
                }
            } else {
                geocode_address(&geocode_query, &venue.venue_name, &venue.address_text)
            };
        let review_state = resolve_review_state(venue, &geocode);
        let now = now_iso();
        conn.execute(
            "
            INSERT INTO venues (
              id,
              import_id,
              ordinal,
              venue_name,
              address_text,
              recommended_dishes_json,
              cuisine_tags_json,
              flavor_tags_json,
              evidence_json,
              confidence,
              recommendation_polarity,
              needs_review,
              review_state,
              geocode_status,
              geocode_provider,
              geocode_query,
              latitude,
              longitude,
              user_confirmed,
              is_favorite,
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
            ",
            params![
                generate_id("venue"),
                import_id,
                index as i64,
                venue.venue_name,
                venue.address_text,
                to_json(&venue.recommended_dishes),
                to_json(&venue.cuisine_tags),
                to_json(&venue.flavor_tags),
                to_json(&venue.evidence),
                venue.confidence,
                venue.recommendation_polarity,
                if venue.needs_review { 1 } else { 0 },
                review_state,
                geocode.status,
                geocode.provider,
                geocode.query,
                geocode.latitude,
                geocode.longitude,
                if user_state.user_confirmed { 1 } else { 0 },
                if user_state.is_favorite { 1 } else { 0 },
                now,
                now,
            ],
        )
        .map_err(|error| format!("failed to insert venue row: {error}"))?;
    }

    Ok(())
}

pub fn complete_import_by_id(
    import_id: &str,
    url: &str,
    probe: &ProbeResult,
) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    let updated_at = now_iso();
    conn.execute(
        "
        UPDATE imports
        SET
          source_url = ?1,
          canonical_url = ?2,
          bvid = ?3,
          title = ?4,
          creator_name = ?5,
          creator_mid = ?6,
          description = ?7,
          tags_json = ?8,
          duration_sec = ?9,
          status = 'succeeded',
          transcript = ?10,
          extraction_raw = ?11,
          video_summary = ?12,
          uncertain_points_json = ?13,
          audio_source_url = ?14,
          selected_stt_model = ?15,
          extraction_coverage_json = ?16,
          output_dir = ?17,
          public_comment_count = ?18,
          comment_clues_json = ?19,
          error_message = '',
          updated_at = ?20
        WHERE id = ?21
        ",
        params![
            url,
            probe.metadata.canonical_url,
            probe.metadata.bvid,
            probe.metadata.title,
            probe.metadata.owner_name,
            probe.metadata.owner_mid,
            probe.metadata.description,
            to_json(&probe.metadata.tags),
            probe.metadata.duration_sec,
            probe.transcript,
            probe.extraction_raw,
            read_video_summary(probe.extraction_json.as_ref()),
            to_json(&read_uncertain_points(probe.extraction_json.as_ref())),
            probe.audio_source_url,
            probe.selected_stt_model,
            serde_json::to_string(&probe.extraction_coverage).unwrap_or_default(),
            probe.output_dir,
            probe.raw_comment_count,
            to_json(&to_comment_clue_records(&probe.comment_clues)),
            updated_at,
            import_id,
        ],
    )
    .map_err(|error| format!("failed to update successful import row: {error}"))?;

    replace_venues(
        &conn,
        &import_id,
        &parse_venue_inputs(probe.extraction_json.as_ref()),
    )?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}

pub fn queue_import(url: &str, bvid_hint: &str) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    let import_id = ensure_import_row(&conn, url, bvid_hint)?;
    update_import_status_by_id(&conn, &import_id, "queued", "")?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}

pub fn set_import_stage(import_id: &str, status: &str) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    update_import_status_by_id(&conn, import_id, status, "")?;
    hydrate_import(&conn, load_import_row(&conn, import_id)?)
}

pub fn mark_import_failed_by_id(
    import_id: &str,
    error_message: &str,
) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    update_import_status_by_id(&conn, import_id, "failed", error_message)?;
    hydrate_import(&conn, load_import_row(&conn, import_id)?)
}

pub fn set_venue_confirmation(
    venue_id: &str,
    confirmed: bool,
) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    let import_id = load_import_id_for_venue(&conn, venue_id)?;
    conn.execute(
        "UPDATE venues SET user_confirmed = ?1, updated_at = ?2 WHERE id = ?3",
        params![if confirmed { 1 } else { 0 }, now_iso(), venue_id],
    )
    .map_err(|error| format!("failed to update venue confirmation: {error}"))?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}

pub fn toggle_venue_favorite(venue_id: &str) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    let import_id = load_import_id_for_venue(&conn, venue_id)?;
    conn.execute(
        "UPDATE venues SET is_favorite = CASE is_favorite WHEN 0 THEN 1 ELSE 0 END, updated_at = ?1 WHERE id = ?2",
        params![now_iso(), venue_id],
    )
    .map_err(|error| format!("failed to update venue favorite state: {error}"))?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}

pub fn load_snapshot() -> Result<Snapshot, String> {
    let conn = open_db()?;
    let mut statement = conn
        .prepare("SELECT * FROM imports ORDER BY updated_at DESC, created_at DESC")
        .map_err(|error| format!("failed to prepare import snapshot query: {error}"))?;
    let import_rows = statement
        .query_map([], row_to_import)
        .map_err(|error| format!("failed to query imports: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect imports: {error}"))?;

    let mut imports = Vec::with_capacity(import_rows.len());
    let mut map_points = Vec::new();
    let mut venue_count = 0usize;
    let mut mapped_venue_count = 0usize;
    let mut review_venue_count = 0usize;
    let mut confirmed_venue_count = 0usize;
    let mut favorite_venue_count = 0usize;

    for row in import_rows {
        let import_record = hydrate_import(&conn, row)?;
        for venue in &import_record.venues {
            venue_count += 1;
            if venue.is_favorite {
                favorite_venue_count += 1;
            }
            if venue.user_confirmed {
                confirmed_venue_count += 1;
            }
            if should_show_on_map(venue) {
                mapped_venue_count += 1;
            } else if venue.review_state == "review" && !venue.user_confirmed {
                review_venue_count += 1;
            }
            if should_show_on_map(venue) {
                if let (Some(latitude), Some(longitude)) = (venue.latitude, venue.longitude) {
                    map_points.push(MapPoint {
                        venue_id: venue.id.clone(),
                        import_id: import_record.id.clone(),
                        venue_name: venue.venue_name.clone(),
                        creator_name: import_record.creator_name.clone(),
                        title: import_record.title.clone(),
                        address_text: venue.address_text.clone(),
                        latitude,
                        longitude,
                        is_favorite: venue.is_favorite,
                        user_confirmed: venue.user_confirmed,
                    });
                }
            }
        }
        imports.push(import_record);
    }

    let stats = SnapshotStats {
        import_count: imports.len(),
        succeeded_count: imports
            .iter()
            .filter(|record| record.status == "succeeded")
            .count(),
        failed_count: imports
            .iter()
            .filter(|record| record.status == "failed")
            .count(),
        venue_count,
        mapped_venue_count,
        review_venue_count,
        confirmed_venue_count,
        favorite_venue_count,
    };

    Ok(Snapshot {
        imports,
        map_points,
        stats,
    })
}

#[cfg(test)]
mod tests {
    use super::{address_is_specific, now_iso, resolve_review_state, should_show_on_map, VenueInput, VenueRecord};
    use crate::probe::GeocodeOutcome;

    fn sample_input(address_text: &str) -> VenueInput {
        VenueInput {
            venue_name: "炭火小馆".to_string(),
            address_text: address_text.to_string(),
            recommended_dishes: vec!["烤鸡翅".to_string()],
            cuisine_tags: vec![],
            flavor_tags: vec![],
            evidence: vec!["这家鸡翅不错".to_string()],
            confidence: "high".to_string(),
            recommendation_polarity: "positive".to_string(),
            needs_review: false,
        }
    }

    #[test]
    fn vague_business_area_is_not_specific_enough_for_map_promotion() {
        assert!(!address_is_specific("天河城商圈附近"));
    }

    #[test]
    fn street_address_is_specific_enough_for_map_promotion() {
        assert!(address_is_specific("广州市天河区体育西路123号"));
    }

    #[test]
    fn resolved_geocode_stays_in_review_when_address_is_vague() {
        let geocode = GeocodeOutcome {
            provider: "amap".to_string(),
            status: "resolved".to_string(),
            query: "炭火小馆 天河城商圈".to_string(),
            latitude: Some(23.0),
            longitude: Some(113.0),
        };
        assert_eq!(
            resolve_review_state(&sample_input("天河城商圈"), &geocode),
            "search_only"
        );
    }

    #[test]
    fn resolved_precise_address_can_map_even_if_record_still_needs_review() {
        let mut input = sample_input("上海市静安区茂名北路68号");
        input.needs_review = true;
        let geocode = GeocodeOutcome {
            provider: "amap".to_string(),
            status: "resolved".to_string(),
            query: "上海市静安区茂名北路68号".to_string(),
            latitude: Some(31.227),
            longitude: Some(121.459),
        };
        assert_eq!(resolve_review_state(&input, &geocode), "map_ready");
    }

    #[test]
    fn user_confirmed_venue_with_coordinates_can_show_on_map() {
        let venue = VenueRecord {
            id: "venue-1".to_string(),
            import_id: "import-1".to_string(),
            venue_name: "那木山选有料蛋饼".to_string(),
            address_text: "上海市静安区茂名北路68号".to_string(),
            recommended_dishes: vec![],
            cuisine_tags: vec![],
            flavor_tags: vec![],
            evidence: vec![],
            confidence: "medium".to_string(),
            recommendation_polarity: "positive".to_string(),
            needs_review: true,
            review_state: "review".to_string(),
            geocode_status: "resolved".to_string(),
            geocode_query: "上海市静安区茂名北路68号".to_string(),
            latitude: Some(31.225032),
            longitude: Some(121.460684),
            user_confirmed: true,
            is_favorite: false,
            created_at: now_iso(),
            updated_at: now_iso(),
        };
        assert!(should_show_on_map(&venue));
    }
}
