use rusqlite::{params, Connection};
use serde_json::Value;

use crate::db::{now_iso, generate_id, to_json, CommentClueRecord, VenueRecord};
use crate::probe::{
    build_geocode_query, geocode_address, GeocodeOutcome, ProbeCommentClue, ProbeResult,
};

#[derive(Debug)]
pub(crate) struct VenueInput {
    pub venue_name: String,
    pub address_text: String,
    pub recommended_dishes: Vec<String>,
    pub cuisine_tags: Vec<String>,
    pub flavor_tags: Vec<String>,
    pub evidence: Vec<String>,
    pub confidence: String,
    pub recommendation_polarity: String,
    pub needs_review: bool,
}

#[derive(Debug, Clone, Copy, Default)]
struct VenueUserState {
    user_confirmed: bool,
    is_favorite: bool,
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

pub(crate) fn parse_venue_inputs(extraction_json: Option<&Value>) -> Vec<VenueInput> {
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

pub(crate) fn read_uncertain_points(extraction_json: Option<&Value>) -> Vec<String> {
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

pub(crate) fn read_video_summary(extraction_json: Option<&Value>) -> String {
    extraction_json
        .and_then(|value| value.get("video_summary"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_default()
}

pub(crate) fn to_comment_clue_records(items: &[ProbeCommentClue]) -> Vec<CommentClueRecord> {
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

pub(crate) fn address_is_specific(address_text: &str) -> bool {
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

pub(crate) fn resolve_review_state(input: &VenueInput, geocode: &GeocodeOutcome) -> String {
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

pub(crate) fn replace_venues(conn: &Connection, import_id: &str, venues: &[VenueInput]) -> Result<(), String> {
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

pub(crate) fn complete_import_by_id(
    conn: &Connection,
    import_id: &str,
    url: &str,
    probe: &ProbeResult,
) -> Result<(), String> {
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
        conn,
        import_id,
        &parse_venue_inputs(probe.extraction_json.as_ref()),
    )?;
    Ok(())
}

pub(crate) fn should_show_on_map(venue: &VenueRecord) -> bool {
    (venue.review_state == "map_ready" || venue.user_confirmed)
        && venue.latitude.is_some()
        && venue.longitude.is_some()
}
