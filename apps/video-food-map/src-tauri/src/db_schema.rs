use std::fs;
use std::path::PathBuf;

use rusqlite::Connection;

use crate::desktop_paths;
use crate::probe::path_display;

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

pub(crate) fn open_db() -> Result<Connection, String> {
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
