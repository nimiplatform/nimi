use rusqlite::{params, Connection};

use crate::db_queries::should_show_on_map;

use super::{
    parse_comment_clues, parse_json_value, parse_string_array, CreatorSyncRecord, ImportRecord,
    ImportRow, MapPoint, Snapshot, SnapshotStats, VenueRecord,
};
use super::db_schema::open_db;

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

pub(super) fn hydrate_import(conn: &Connection, row: ImportRow) -> Result<ImportRecord, String> {
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

pub(super) fn load_import_row(conn: &Connection, import_id: &str) -> Result<ImportRow, String> {
    conn.query_row(
        "SELECT * FROM imports WHERE id = ?1",
        params![import_id],
        row_to_import,
    )
    .map_err(|error| format!("failed to load import {import_id}: {error}"))
}

pub(super) fn load_creator_syncs(conn: &Connection) -> Result<Vec<CreatorSyncRecord>, String> {
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
        failed_count: imports.iter().filter(|record| record.status == "failed").count(),
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
