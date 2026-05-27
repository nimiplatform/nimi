use rusqlite::{params, Connection, OptionalExtension};
use url::Url;

use crate::db_queries::complete_import_by_id as complete_import_query;
use crate::probe::ProbeResult;

use super::db_schema::open_db;
use super::db_snapshot::{hydrate_import, load_creator_syncs, load_import_row};
use super::{generate_id, now_iso, CreatorSyncRecord, ImportLookup, QueuedImport};

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

pub(crate) fn update_import_status_by_id(
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

pub fn refresh_import_source_url(import_id: &str, source_url: &str) -> Result<(), String> {
    let trimmed = source_url.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let conn = open_db()?;
    conn.execute(
        "
        UPDATE imports
        SET
          source_url = ?1,
          source_key = CASE WHEN bvid <> '' THEN source_key ELSE ?2 END,
          canonical_url = CASE
            WHEN canonical_url = '' OR canonical_url = source_url THEN ?1
            ELSE canonical_url
          END,
          updated_at = ?3
        WHERE id = ?4
        ",
        params![trimmed, build_source_key(trimmed, ""), now_iso(), import_id],
    )
    .map_err(|error| format!("failed to refresh import source url: {error}"))?;
    Ok(())
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

pub fn complete_import_by_id(
    import_id: &str,
    url: &str,
    probe: &ProbeResult,
) -> Result<super::ImportRecord, String> {
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

pub fn set_import_stage(import_id: &str, status: &str) -> Result<super::ImportRecord, String> {
    let conn = open_db()?;
    update_import_status_by_id(&conn, import_id, status, "")?;
    hydrate_import(&conn, load_import_row(&conn, import_id)?)
}

pub fn mark_import_failed_by_id(
    import_id: &str,
    error_message: &str,
) -> Result<super::ImportRecord, String> {
    let conn = open_db()?;
    update_import_status_by_id(&conn, import_id, "failed", error_message)?;
    hydrate_import(&conn, load_import_row(&conn, import_id)?)
}

pub fn set_venue_confirmation(
    venue_id: &str,
    confirmed: bool,
) -> Result<super::ImportRecord, String> {
    let conn = open_db()?;
    let import_id = load_import_id_for_venue(&conn, venue_id)?;
    conn.execute(
        "UPDATE venues SET user_confirmed = ?1, updated_at = ?2 WHERE id = ?3",
        params![if confirmed { 1 } else { 0 }, now_iso(), venue_id],
    )
    .map_err(|error| format!("failed to update venue confirmation: {error}"))?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}

pub fn toggle_venue_favorite(venue_id: &str) -> Result<super::ImportRecord, String> {
    let conn = open_db()?;
    let import_id = load_import_id_for_venue(&conn, venue_id)?;
    conn.execute(
        "UPDATE venues SET is_favorite = CASE is_favorite WHEN 0 THEN 1 ELSE 0 END, updated_at = ?1 WHERE id = ?2",
        params![now_iso(), venue_id],
    )
    .map_err(|error| format!("failed to update venue favorite state: {error}"))?;
    hydrate_import(&conn, load_import_row(&conn, &import_id)?)
}
