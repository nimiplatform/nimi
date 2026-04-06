use rusqlite::{params, Connection, Transaction};
use serde_json::Value;

use crate::db::{generate_id, now_iso, to_json, CommentClueRecord, VenueRecord};
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

#[derive(Debug)]
struct PreparedVenueRow {
    ordinal: i64,
    venue_name: String,
    address_text: String,
    recommended_dishes_json: String,
    cuisine_tags_json: String,
    flavor_tags_json: String,
    evidence_json: String,
    confidence: String,
    recommendation_polarity: String,
    needs_review: bool,
    review_state: String,
    geocode_status: String,
    geocode_provider: String,
    geocode_query: String,
    latitude: Option<f64>,
    longitude: Option<f64>,
    user_confirmed: bool,
    is_favorite: bool,
    created_at: String,
    updated_at: String,
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

fn extract_city_candidates(text: &str) -> Vec<String> {
    let normalized = text.trim();
    if normalized.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    let suffixed = regex::Regex::new(r"([\u4e00-\u9fa5]{2,12}(?:市|区|县|镇|乡|村|州|旗))").ok();
    if let Some(pattern) = suffixed {
        for capture in pattern.captures_iter(normalized) {
            if let Some(value) = capture.get(1) {
                candidates.push(value.as_str().trim().to_string());
            }
        }
    }

    let title_prefix =
        regex::Regex::new(r"^([\u4e00-\u9fa5]{2,8})(?:[\d一二两三四五六七八九十百千]+家|探店|美食|必吃|吃|合集|攻略|vlog|VLOG|小吃|粉店|早餐|宵夜)")
            .ok();
    if let Some(pattern) = title_prefix {
        if let Some(capture) = pattern.captures(normalized) {
            if let Some(value) = capture.get(1) {
                candidates.push(value.as_str().trim().to_string());
            }
        }
    }

    candidates
}

fn infer_import_city_hint(probe: &ProbeResult, venues: &[VenueInput]) -> String {
    let mut counts = std::collections::HashMap::<String, usize>::new();
    let mut texts = vec![
        probe.metadata.title.as_str(),
        probe.metadata.description.as_str(),
        probe.transcript.as_str(),
    ];
    for tag in &probe.metadata.tags {
        texts.push(tag.as_str());
    }
    for clue in &probe.comment_clues {
        texts.push(clue.address_hint.as_str());
        texts.push(clue.message.as_str());
    }
    for venue in venues {
        texts.push(venue.address_text.as_str());
        texts.push(venue.venue_name.as_str());
    }

    for text in texts {
        for candidate in extract_city_candidates(text) {
            *counts.entry(candidate).or_insert(0) += 1;
        }
    }

    counts
        .into_iter()
        .max_by(|(left_name, left_count), (right_name, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| left_name.len().cmp(&right_name.len()))
        })
        .map(|(name, _)| name)
        .unwrap_or_default()
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

fn prepare_venues(
    conn: &Connection,
    import_id: &str,
    probe: &ProbeResult,
    venues: &[VenueInput],
) -> Result<Vec<PreparedVenueRow>, String> {
    let existing_user_states = load_existing_venue_user_state(conn, import_id)?;
    let city_hint = infer_import_city_hint(probe, venues);
    let mut prepared = Vec::with_capacity(venues.len());

    for (index, venue) in venues.iter().enumerate() {
        let user_state = existing_user_states
            .get(&venue_user_key(&venue.venue_name, &venue.address_text))
            .copied()
            .unwrap_or_default();
        let geocode_query = build_geocode_query(&venue.venue_name, &venue.address_text);
        let can_try_name_search =
            !venue.venue_name.trim().is_empty() && !city_hint.trim().is_empty();
        let geocode = if venue.address_text.trim().is_empty()
            || (!address_is_specific(&venue.address_text) && !can_try_name_search)
        {
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
            geocode_address(
                &geocode_query,
                &venue.venue_name,
                &venue.address_text,
                &city_hint,
            )
        };
        let review_state = resolve_review_state(venue, &geocode);
        let now = now_iso();
        prepared.push(PreparedVenueRow {
            ordinal: index as i64,
            venue_name: venue.venue_name.clone(),
            address_text: venue.address_text.clone(),
            recommended_dishes_json: to_json(&venue.recommended_dishes),
            cuisine_tags_json: to_json(&venue.cuisine_tags),
            flavor_tags_json: to_json(&venue.flavor_tags),
            evidence_json: to_json(&venue.evidence),
            confidence: venue.confidence.clone(),
            recommendation_polarity: venue.recommendation_polarity.clone(),
            needs_review: venue.needs_review,
            review_state,
            geocode_status: geocode.status,
            geocode_provider: geocode.provider,
            geocode_query: geocode.query,
            latitude: geocode.latitude,
            longitude: geocode.longitude,
            user_confirmed: user_state.user_confirmed,
            is_favorite: user_state.is_favorite,
            created_at: now.clone(),
            updated_at: now,
        });
    }

    Ok(prepared)
}

fn replace_venues(
    transaction: &Transaction<'_>,
    import_id: &str,
    venues: &[PreparedVenueRow],
) -> Result<(), String> {
    transaction
        .execute(
            "DELETE FROM venues WHERE import_id = ?1",
            params![import_id],
        )
        .map_err(|error| format!("failed to clear existing venues: {error}"))?;

    for venue in venues {
        transaction
            .execute(
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
                    venue.ordinal,
                    venue.venue_name,
                    venue.address_text,
                    venue.recommended_dishes_json,
                    venue.cuisine_tags_json,
                    venue.flavor_tags_json,
                    venue.evidence_json,
                    venue.confidence,
                    venue.recommendation_polarity,
                    if venue.needs_review { 1 } else { 0 },
                    venue.review_state,
                    venue.geocode_status,
                    venue.geocode_provider,
                    venue.geocode_query,
                    venue.latitude,
                    venue.longitude,
                    if venue.user_confirmed { 1 } else { 0 },
                    if venue.is_favorite { 1 } else { 0 },
                    venue.created_at,
                    venue.updated_at,
                ],
            )
            .map_err(|error| format!("failed to insert venue row: {error}"))?;
    }

    Ok(())
}

pub(crate) fn complete_import_by_id(
    conn: &mut Connection,
    import_id: &str,
    url: &str,
    probe: &ProbeResult,
) -> Result<(), String> {
    let venue_inputs = parse_venue_inputs(probe.extraction_json.as_ref());
    let prepared_venues = prepare_venues(conn, import_id, probe, &venue_inputs)?;
    let updated_at = now_iso();
    let transaction = conn
        .transaction()
        .map_err(|error| format!("failed to open completion transaction: {error}"))?;
    transaction
        .execute(
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
              selected_text_model = ?16,
              extraction_coverage_json = ?17,
              output_dir = ?18,
              public_comment_count = ?19,
              comment_clues_json = ?20,
              error_message = '',
              updated_at = ?21
            WHERE id = ?22
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
                probe.selected_text_model,
                serde_json::to_string(&probe.extraction_coverage).unwrap_or_default(),
                probe.output_dir,
                probe.raw_comment_count,
                to_json(&to_comment_clue_records(&probe.comment_clues)),
                updated_at,
                import_id,
            ],
        )
        .map_err(|error| format!("failed to update successful import row: {error}"))?;

    replace_venues(&transaction, import_id, &prepared_venues)?;
    transaction
        .commit()
        .map_err(|error| format!("failed to commit completed import: {error}"))?;
    Ok(())
}

pub(crate) fn should_show_on_map(venue: &VenueRecord) -> bool {
    (venue.review_state == "map_ready" || venue.user_confirmed)
        && venue.latitude.is_some()
        && venue.longitude.is_some()
}
