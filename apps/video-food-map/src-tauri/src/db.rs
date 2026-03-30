use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::desktop_paths;
use crate::probe::{build_geocode_query, geocode_address, path_display, GeocodeOutcome, ProbeResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStats {
    pub import_count: usize,
    pub succeeded_count: usize,
    pub failed_count: usize,
    pub venue_count: usize,
    pub mapped_venue_count: usize,
    pub review_venue_count: usize,
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
    pub error_message: String,
    pub created_at: String,
    pub updated_at: String,
    pub venues: Vec<VenueRecord>,
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

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn generate_id(prefix: &str) -> String {
    format!("{prefix}-{}", Utc::now().timestamp_millis())
}

fn app_data_dir() -> Result<PathBuf, String> {
    let root = desktop_paths::resolve_nimi_data_dir()?.join("video-food-map");
    fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create video-food-map data dir ({}): {error}", root.display()))?;
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
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(import_id) REFERENCES imports(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_venues_import_id ON venues(import_id);
        ",
    )
    .map_err(|error| format!("failed to initialize sqlite schema: {error}"))
}

fn open_db() -> Result<Connection, String> {
    let path = db_path()?;
    let conn = Connection::open(&path)
        .map_err(|error| format!("failed to open sqlite db ({}): {error}", path_display(&path)))?;
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
                recommended_dishes: parse_string_array(&row.get::<_, String>("recommended_dishes_json")?),
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

fn ensure_import_row(conn: &Connection, source_url: &str, bvid_hint: &str) -> Result<String, String> {
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

fn resolve_review_state(input: &VenueInput, geocode: &GeocodeOutcome) -> String {
    if geocode.status == "resolved" {
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

fn replace_venues(conn: &Connection, import_id: &str, venues: &[VenueInput]) -> Result<(), String> {
    conn.execute("DELETE FROM venues WHERE import_id = ?1", params![import_id])
        .map_err(|error| format!("failed to clear existing venues: {error}"))?;

    for (index, venue) in venues.iter().enumerate() {
        let geocode_query = build_geocode_query(&venue.venue_name, &venue.address_text);
        let geocode = if venue.address_text.trim().is_empty() {
            GeocodeOutcome {
                provider: "nominatim".to_string(),
                status: "skipped".to_string(),
                query: String::new(),
                latitude: None,
                longitude: None,
            }
        } else {
            geocode_address(&geocode_query)
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
              created_at,
              updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
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
                now,
                now,
            ],
        )
        .map_err(|error| format!("failed to insert venue row: {error}"))?;
    }

    Ok(())
}

pub fn import_video(url: &str, bvid_hint: &str, probe: &ProbeResult) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    let import_id = ensure_import_row(&conn, url, bvid_hint)?;
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
          error_message = '',
          updated_at = ?18
        WHERE id = ?19
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
            updated_at,
            import_id,
        ],
    )
    .map_err(|error| format!("failed to update successful import row: {error}"))?;

    replace_venues(&conn, &import_id, &parse_venue_inputs(probe.extraction_json.as_ref()))?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}

pub fn mark_import_failed(url: &str, bvid_hint: &str, error_message: &str) -> Result<ImportRecord, String> {
    let conn = open_db()?;
    let import_id = ensure_import_row(&conn, url, bvid_hint)?;
    conn.execute(
        "UPDATE imports SET status = 'failed', error_message = ?1, updated_at = ?2 WHERE id = ?3",
        params![error_message, now_iso(), import_id],
    )
    .map_err(|error| format!("failed to mark import failed: {error}"))?;
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

    for row in import_rows {
        let import_record = hydrate_import(&conn, row)?;
        for venue in &import_record.venues {
            venue_count += 1;
            if venue.review_state == "map_ready" {
                mapped_venue_count += 1;
            } else if venue.review_state == "review" {
                review_venue_count += 1;
            }
            if venue.review_state == "map_ready" {
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
                    });
                }
            }
        }
        imports.push(import_record);
    }

    let stats = SnapshotStats {
        import_count: imports.len(),
        succeeded_count: imports.iter().filter(|record| record.status == "succeeded").count(),
        failed_count: imports.iter().filter(|record| record.status == "failed").count(),
        venue_count,
        mapped_venue_count,
        review_venue_count,
    };

    Ok(Snapshot {
        imports,
        map_points,
        stats,
    })
}
