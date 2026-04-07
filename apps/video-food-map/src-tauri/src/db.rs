use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::db_queries::{complete_import_by_id as complete_import_query, should_show_on_map};
use crate::desktop_paths;
use crate::probe::{path_display, ProbeResult};

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
    selected_text_model: String,
    extraction_coverage_json: String,
    output_dir: String,
    public_comment_count: i64,
    comment_clues_json: String,
    error_message: String,
    created_at: String,
    updated_at: String,
}

pub(crate) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) fn generate_id(prefix: &str) -> String {
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
          source_key TEXT NOT NULL DEFAULT '',
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
          selected_text_model TEXT NOT NULL DEFAULT '',
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

        CREATE TABLE IF NOT EXISTS creator_syncs (
          creator_mid TEXT PRIMARY KEY,
          creator_name TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          last_synced_at TEXT NOT NULL DEFAULT '',
          last_scanned_count INTEGER NOT NULL DEFAULT 0,
          last_queued_count INTEGER NOT NULL DEFAULT 0,
          last_skipped_existing_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        ",
    )
    .map_err(|error| format!("failed to initialize sqlite schema: {error}"))?;
    ensure_column(conn, "imports", "source_key", "TEXT NOT NULL DEFAULT ''")?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_source_key ON imports(source_key) WHERE source_key <> ''",
        [],
    )
    .map_err(|error| format!("failed to ensure source key index: {error}"))?;
    ensure_column(
        conn,
        "imports",
        "selected_text_model",
        "TEXT NOT NULL DEFAULT ''",
    )?;
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
    ensure_column(conn, "venues", "is_favorite", "INTEGER NOT NULL DEFAULT 0")?;
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
        selected_text_model: row.get("selected_text_model")?,
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
        selected_text_model: row.selected_text_model,
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

pub fn lookup_import_by_bvid(bvid: &str) -> Result<Option<ImportLookup>, String> {
    let normalized = bvid.trim().to_ascii_uppercase();
    if normalized.is_empty() {
        return Ok(None);
    }
    let conn = open_db()?;
    conn.query_row(
        "SELECT id, status FROM imports WHERE bvid = ?1 LIMIT 1",
        params![normalized],
        |row| {
            Ok(ImportLookup {
                id: row.get::<_, String>(0)?,
                status: row.get::<_, String>(1)?,
            })
        },
    )
    .optional()
    .map_err(|error| format!("failed to query import by bvid: {error}"))
}

pub fn retry_import_by_id(import_id: &str) -> Result<QueuedImport, String> {
    let conn = open_db()?;
    let row = load_import_row(&conn, import_id)?;
    let retry_url = if row.source_url.trim().is_empty() {
        row.canonical_url.trim().to_string()
    } else {
        row.source_url.trim().to_string()
    };
    if retry_url.is_empty() {
        return Err("this import does not have a retryable source url".to_string());
    }
    let queued = ensure_import_row(&conn, &retry_url, &row.bvid)?;
    Ok(QueuedImport {
        record: hydrate_import(&conn, load_import_row(&conn, &queued.id)?)?,
        should_start: queued.should_start,
    })
}

pub fn save_creator_sync(
    creator_mid: &str,
    creator_name: &str,
    source_url: &str,
    scanned_count: usize,
    queued_count: usize,
    skipped_existing_count: usize,
) -> Result<CreatorSyncRecord, String> {
    let normalized_mid = creator_mid.trim();
    if normalized_mid.is_empty() {
        return Err("creator mid is required".to_string());
    }
    let conn = open_db()?;
    let now = now_iso();
    conn.execute(
        "
        INSERT INTO creator_syncs (
          creator_mid,
          creator_name,
          source_url,
          last_synced_at,
          last_scanned_count,
          last_queued_count,
          last_skipped_existing_count,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(creator_mid) DO UPDATE SET
          creator_name = excluded.creator_name,
          source_url = excluded.source_url,
          last_synced_at = excluded.last_synced_at,
          last_scanned_count = excluded.last_scanned_count,
          last_queued_count = excluded.last_queued_count,
          last_skipped_existing_count = excluded.last_skipped_existing_count,
          updated_at = excluded.updated_at
        ",
        params![
            normalized_mid,
            creator_name.trim(),
            source_url.trim(),
            now,
            scanned_count as i64,
            queued_count as i64,
            skipped_existing_count as i64,
            now,
            now,
        ],
    )
    .map_err(|error| format!("failed to save creator sync: {error}"))?;
    load_creator_syncs(&conn)?
        .into_iter()
        .find(|record| record.creator_mid == normalized_mid)
        .ok_or_else(|| "failed to load saved creator sync".to_string())
}

fn load_creator_syncs(conn: &Connection) -> Result<Vec<CreatorSyncRecord>, String> {
    let mut statement = conn
        .prepare(
            "
            SELECT
              creator_mid,
              creator_name,
              source_url,
              last_synced_at,
              last_scanned_count,
              last_queued_count,
              last_skipped_existing_count,
              created_at,
              updated_at
            FROM creator_syncs
            ORDER BY last_synced_at DESC, updated_at DESC, created_at DESC
            ",
        )
        .map_err(|error| format!("failed to prepare creator sync query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(CreatorSyncRecord {
                creator_mid: row.get("creator_mid")?,
                creator_name: row.get("creator_name")?,
                source_url: row.get("source_url")?,
                last_synced_at: row.get("last_synced_at")?,
                last_scanned_count: row.get("last_scanned_count")?,
                last_queued_count: row.get("last_queued_count")?,
                last_skipped_existing_count: row.get("last_skipped_existing_count")?,
                created_at: row.get("created_at")?,
                updated_at: row.get("updated_at")?,
            })
        })
        .map_err(|error| format!("failed to query creator syncs: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to collect creator syncs: {error}"))
}

fn normalize_source_url(source_url: &str) -> String {
    let trimmed = source_url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let Ok(mut parsed) = Url::parse(trimmed) else {
        return trimmed.to_string();
    };
    parsed.set_fragment(None);
    let _ = parsed.set_username("");
    let _ = parsed.set_password(None);

    if matches!(parsed.scheme(), "http" | "https") {
        let _ = parsed.set_scheme("https");
    }

    if let Some(host) = parsed.host_str().map(|value| value.to_lowercase()) {
        let _ = parsed.set_host(Some(&host));
    }

    let normalized_path = {
        let path = parsed.path().trim_end_matches('/');
        if path.is_empty() {
            "/".to_string()
        } else {
            path.to_string()
        }
    };
    parsed.set_path(&normalized_path);

    if parsed.query() == Some("") {
        parsed.set_query(None);
    }

    parsed.to_string()
}

fn build_source_key(source_url: &str, bvid_hint: &str) -> String {
    let normalized_bvid = bvid_hint.trim().to_ascii_uppercase();
    if !normalized_bvid.is_empty() {
        return format!("bvid:{normalized_bvid}");
    }
    let normalized_url = normalize_source_url(source_url);
    if normalized_url.is_empty() {
        return String::new();
    }
    format!("url:{normalized_url}")
}

fn is_active_import_status(status: &str) -> bool {
    matches!(status, "running" | "queued" | "resolving" | "geocoding")
}

#[derive(Debug)]
struct EnsuredImportRow {
    id: String,
    should_start: bool,
}

fn ensure_import_row(
    conn: &Connection,
    source_url: &str,
    bvid_hint: &str,
) -> Result<EnsuredImportRow, String> {
    let normalized_bvid = bvid_hint.trim().to_ascii_uppercase();
    let source_key = build_source_key(source_url, &normalized_bvid);
    let mut existing = if !normalized_bvid.is_empty() {
        conn.query_row(
            "SELECT id, status FROM imports WHERE bvid = ?1 LIMIT 1",
            params![normalized_bvid],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| format!("failed to query import by bvid: {error}"))?
    } else {
        None
    };
    if existing.is_none() && !source_key.is_empty() {
        existing = conn
            .query_row(
                "SELECT id, status FROM imports WHERE source_key = ?1 LIMIT 1",
                params![source_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| format!("failed to query import by source key: {error}"))?;
    }

    if let Some((id, status)) = existing {
        let now = now_iso();
        conn.execute(
            "
            UPDATE imports
            SET
              source_url = ?1,
              source_key = CASE WHEN source_key = '' AND ?2 <> '' THEN ?2 ELSE source_key END,
              bvid = CASE WHEN bvid = '' AND ?3 <> '' THEN ?3 ELSE bvid END,
              status = CASE WHEN ?4 = 1 THEN status ELSE 'queued' END,
              error_message = CASE WHEN ?4 = 1 THEN error_message ELSE '' END,
              updated_at = ?5
            WHERE id = ?6
            ",
            params![
                source_url,
                source_key,
                normalized_bvid,
                if is_active_import_status(&status) {
                    1
                } else {
                    0
                },
                now,
                id,
            ],
        )
        .map_err(|error| format!("failed to refresh existing import row: {error}"))?;
        return Ok(EnsuredImportRow {
            id,
            should_start: !is_active_import_status(&status),
        });
    }

    let id = generate_id("import");
    let now = now_iso();
    conn.execute(
        "
        INSERT INTO imports (
          id,
          source_url,
          source_key,
          bvid,
          status,
          created_at,
          updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6)
        ",
        params![id, source_url, source_key, normalized_bvid, now, now],
    )
    .map_err(|error| format!("failed to insert import row: {error}"))?;
    Ok(EnsuredImportRow {
        id,
        should_start: true,
    })
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

fn load_import_id_for_venue(conn: &Connection, venue_id: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT import_id FROM venues WHERE id = ?1",
        params![venue_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|error| format!("failed to load import id for venue {venue_id}: {error}"))
}

pub fn complete_import_by_id(
    import_id: &str,
    url: &str,
    probe: &ProbeResult,
) -> Result<ImportRecord, String> {
    let mut conn = open_db()?;
    complete_import_query(&mut conn, import_id, url, probe)?;
    hydrate_import(&conn, load_import_row(&conn, import_id)?)
}

pub fn queue_import(url: &str, bvid_hint: &str) -> Result<QueuedImport, String> {
    let conn = open_db()?;
    let queued = ensure_import_row(&conn, url, bvid_hint)?;
    Ok(QueuedImport {
        record: hydrate_import(&conn, load_import_row(&conn, &queued.id)?)?,
        should_start: queued.should_start,
    })
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

pub fn set_venue_confirmation(venue_id: &str, confirmed: bool) -> Result<ImportRecord, String> {
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
        creator_syncs: load_creator_syncs(&conn)?,
        stats,
    })
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::ffi::OsString;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::{
        load_snapshot, now_iso, open_db, queue_import, retry_import_by_id, save_creator_sync,
        update_import_status_by_id, VenueRecord,
    };
    use crate::db_queries::{
        address_is_specific, resolve_review_state, should_show_on_map, VenueInput,
    };
    use crate::probe::{
        GeocodeOutcome, ProbeCommentClue, ProbeExtractionCoverage, ProbeMetadata, ProbeResult,
        ProbeSavedFiles,
    };

    fn db_test_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    struct TestHomeGuard {
        original_home: Option<OsString>,
        root: PathBuf,
    }

    impl TestHomeGuard {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let root = env::temp_dir().join(format!("video-food-map-db-{name}-{unique}"));
            fs::create_dir_all(&root).expect("failed to create test home");
            let original_home = env::var_os("HOME");
            env::set_var("HOME", &root);
            Self {
                original_home,
                root,
            }
        }
    }

    impl Drop for TestHomeGuard {
        fn drop(&mut self) {
            if let Some(value) = &self.original_home {
                env::set_var("HOME", value);
            } else {
                env::remove_var("HOME");
            }
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn sample_probe_result() -> ProbeResult {
        ProbeResult {
            metadata: ProbeMetadata {
                bvid: "BV1xx411c7mD".to_string(),
                aid: "123".to_string(),
                cid: "456".to_string(),
                title: "上海探店".to_string(),
                owner_mid: "789".to_string(),
                owner_name: "测试博主".to_string(),
                duration_sec: 98.5,
                description: "今天去吃了两家店".to_string(),
                tags: vec!["上海".to_string(), "美食".to_string()],
                canonical_url: "https://www.bilibili.com/video/BV1xx411c7mD/".to_string(),
            },
            audio_source_url: "https://example.com/audio.m4a".to_string(),
            selected_stt_model: "stt-model".to_string(),
            selected_text_model: "text-model".to_string(),
            raw_comment_count: 5,
            comment_clues: vec![ProbeCommentClue {
                comment_id: "c1".to_string(),
                author_name: "路人甲".to_string(),
                message: "这家店我也去过".to_string(),
                like_count: 8,
                published_at: "2026-04-06T10:00:00.000Z".to_string(),
                matched_venue_names: vec!["炭火小馆".to_string()],
                address_hint: "静安区".to_string(),
            }],
            extraction_coverage: ProbeExtractionCoverage {
                state: "complete".to_string(),
                processed_segment_count: 4,
                processed_duration_sec: 98.5,
                total_duration_sec: 98.5,
            },
            transcript: "先去炭火小馆，再去面馆".to_string(),
            extraction_raw: "原始提取文本".to_string(),
            extraction_json: Some(json!({
                "video_summary": "视频讲了两家店",
                "uncertain_points": ["第二家门牌号没听清"],
                "venues": [
                    {
                        "venue_name": "炭火小馆",
                        "address_text": "",
                        "recommended_dishes": ["鸡翅"],
                        "cuisine_tags": ["烧烤"],
                        "flavor_tags": ["香辣"],
                        "evidence": ["鸡翅不错"],
                        "confidence": "high",
                        "recommendation_polarity": "positive",
                        "needs_review": false
                    }
                ]
            })),
            output_dir: "/tmp/video-food-map-test".to_string(),
            saved_files: ProbeSavedFiles {
                metadata_json: "/tmp/video-food-map-test/metadata.json".to_string(),
                transcript_text: "/tmp/video-food-map-test/transcript.txt".to_string(),
                extraction_raw_text: "/tmp/video-food-map-test/extraction-raw.txt".to_string(),
                extraction_json: "/tmp/video-food-map-test/extraction.json".to_string(),
            },
        }
    }

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
    fn resolved_geocode_can_map_when_name_search_finds_a_place() {
        let geocode = GeocodeOutcome {
            provider: "amap".to_string(),
            status: "resolved".to_string(),
            query: "炭火小馆 天河城商圈".to_string(),
            latitude: Some(23.0),
            longitude: Some(113.0),
        };
        assert_eq!(
            resolve_review_state(&sample_input("天河城商圈"), &geocode),
            "map_ready"
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

    #[test]
    fn queue_import_reuses_active_bvid_row_without_restart() {
        let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
        let _home = TestHomeGuard::new("reuse-active");

        let first = queue_import(
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            "BV1xx411c7mD",
        )
        .expect("failed to queue first import");
        let second = queue_import(
            "https://www.bilibili.com/video/BV1xx411c7mD/?share_source=copy_web",
            "BV1xx411c7mD",
        )
        .expect("failed to queue second import");

        assert!(first.should_start);
        assert!(!second.should_start);
        assert_eq!(first.record.id, second.record.id);

        let conn = open_db().expect("failed to reopen db");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM imports", [], |row| row.get(0))
            .expect("failed to count imports");
        assert_eq!(count, 1);
    }

    #[test]
    fn queue_import_reuses_normalized_url_when_bvid_is_missing() {
        let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
        let _home = TestHomeGuard::new("reuse-url");

        let first = queue_import("https://b23.tv/demo-short-link", "")
            .expect("failed to queue first short url import");
        let second = queue_import("https://b23.tv/demo-short-link#fragment", "")
            .expect("failed to queue second short url import");

        assert!(first.should_start);
        assert!(!second.should_start);
        assert_eq!(first.record.id, second.record.id);
    }

    #[test]
    fn queue_import_can_restart_failed_row_without_creating_duplicate() {
        let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
        let _home = TestHomeGuard::new("restart-failed");

        let first = queue_import(
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            "BV1xx411c7mD",
        )
        .expect("failed to queue import");
        let conn = open_db().expect("failed to reopen db");
        update_import_status_by_id(&conn, &first.record.id, "failed", "boom")
            .expect("failed to mark import failed");

        let retried = queue_import(
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            "BV1xx411c7mD",
        )
        .expect("failed to retry import");

        assert!(retried.should_start);
        assert_eq!(retried.record.id, first.record.id);
        assert_eq!(retried.record.status, "queued");
        assert!(retried.record.error_message.is_empty());
    }

    #[test]
    fn complete_import_writes_summary_and_venues() {
        let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
        let _home = TestHomeGuard::new("complete-import");

        let queued = queue_import(
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            "BV1xx411c7mD",
        )
        .expect("failed to queue import");
        let completed = super::complete_import_by_id(
            &queued.record.id,
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            &sample_probe_result(),
        )
        .expect("failed to complete import");

        assert_eq!(completed.status, "succeeded");
        assert_eq!(completed.bvid, "BV1xx411c7mD");
        assert_eq!(completed.video_summary, "视频讲了两家店");
        assert_eq!(completed.venues.len(), 1);
        assert_eq!(completed.venues[0].venue_name, "炭火小馆");
    }

    #[test]
    fn retry_import_reuses_failed_row_and_requeues_it() {
        let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
        let _home = TestHomeGuard::new("retry-import");

        let first = queue_import(
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            "BV1xx411c7mD",
        )
        .expect("failed to queue import");
        let conn = open_db().expect("failed to reopen db");
        update_import_status_by_id(&conn, &first.record.id, "failed", "boom")
            .expect("failed to mark import failed");

        let retried = retry_import_by_id(&first.record.id).expect("failed to retry import by id");
        assert!(retried.should_start);
        assert_eq!(retried.record.id, first.record.id);
        assert_eq!(retried.record.status, "queued");
        assert!(retried.record.error_message.is_empty());
    }

    #[test]
    fn snapshot_includes_saved_creator_syncs() {
        let _lock = db_test_lock().lock().expect("failed to lock db test mutex");
        let _home = TestHomeGuard::new("creator-sync-history");

        save_creator_sync(
            "123456",
            "测试博主",
            "https://space.bilibili.com/123456",
            12,
            4,
            8,
        )
        .expect("failed to save creator sync");

        let snapshot = load_snapshot().expect("failed to load snapshot");
        assert_eq!(snapshot.creator_syncs.len(), 1);
        let sync = &snapshot.creator_syncs[0];
        assert_eq!(sync.creator_mid, "123456");
        assert_eq!(sync.creator_name, "测试博主");
        assert_eq!(sync.last_scanned_count, 12);
        assert_eq!(sync.last_queued_count, 4);
        assert_eq!(sync.last_skipped_existing_count, 8);
    }
}
