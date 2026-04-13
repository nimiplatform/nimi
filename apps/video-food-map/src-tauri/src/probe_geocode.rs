use std::env;

use serde::Deserialize;

use super::GeocodeOutcome;
use super::probe_client::build_http_client;

const GEOCODER_PROVIDER: &str = "amap";
const AMAP_GEOCODE_ENDPOINT: &str = "https://restapi.amap.com/v3/geocode/geo";
const AMAP_PLACE_TEXT_ENDPOINT: &str = "https://restapi.amap.com/v3/place/text";

#[derive(Debug, Deserialize)]
struct AmapGeocodeRow {
    location: String,
}

#[derive(Debug, Deserialize)]
struct AmapGeocodeResponse {
    status: String,
    geocodes: Option<Vec<AmapGeocodeRow>>,
}

#[derive(Debug, Deserialize)]
struct AmapPlacePoi {
    location: String,
}

#[derive(Debug, Deserialize)]
struct AmapPlaceSearchResponse {
    status: String,
    pois: Option<Vec<AmapPlacePoi>>,
}

pub fn build_geocode_query(venue_name: &str, address_text: &str) -> String {
    let venue = venue_name.trim();
    let address = address_text.trim();
    if venue.is_empty() && address.is_empty() {
        return String::new();
    }
    if venue.is_empty() {
        return address.to_string();
    }
    if address.is_empty() {
        return venue.to_string();
    }
    address.to_string()
}

fn amap_web_key() -> String {
    env::var("NIMI_VIDEO_FOOD_MAP_AMAP_WEB_KEY")
        .ok()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn amap_default_city() -> String {
    env::var("NIMI_VIDEO_FOOD_MAP_AMAP_DEFAULT_CITY")
        .ok()
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn split_amap_location(raw: &str) -> (Option<f64>, Option<f64>) {
    let mut parts = raw.split(',');
    let longitude = parts
        .next()
        .and_then(|value| value.trim().parse::<f64>().ok());
    let latitude = parts
        .next()
        .and_then(|value| value.trim().parse::<f64>().ok());
    (latitude, longitude)
}

fn failed_outcome(query: &str) -> GeocodeOutcome {
    GeocodeOutcome {
        provider: GEOCODER_PROVIDER.to_string(),
        status: "failed".to_string(),
        query: query.to_string(),
        latitude: None,
        longitude: None,
    }
}

fn resolved_outcome(
    query: &str,
    city: &str,
    latitude: Option<f64>,
    longitude: Option<f64>,
) -> GeocodeOutcome {
    GeocodeOutcome {
        provider: GEOCODER_PROVIDER.to_string(),
        status: "resolved".to_string(),
        query: if city.is_empty() {
            query.to_string()
        } else {
            format!("{city} {query}")
        },
        latitude,
        longitude,
    }
}

fn place_search_keywords(venue_name: &str, address_text: &str, query: &str) -> String {
    let venue = venue_name.trim();
    let address = address_text.trim();
    if !venue.is_empty() && !address.is_empty() {
        return format!("{venue} {address}");
    }
    if !venue.is_empty() {
        return venue.to_string();
    }
    if !address.is_empty() {
        return address.to_string();
    }
    query.trim().to_string()
}

pub fn geocode_address(
    query: &str,
    venue_name: &str,
    address_text: &str,
    city_hint: &str,
) -> GeocodeOutcome {
    let normalized = query.trim();
    if normalized.is_empty() {
        return GeocodeOutcome {
            provider: GEOCODER_PROVIDER.to_string(),
            status: "skipped".to_string(),
            query: String::new(),
            latitude: None,
            longitude: None,
        };
    }

    let key = amap_web_key();
    if key.is_empty() {
        return failed_outcome(normalized);
    }

    let client = match build_http_client() {
        Ok(client) => client,
        Err(_) => return failed_outcome(normalized),
    };

    let city = {
        let explicit = city_hint.trim();
        if explicit.is_empty() {
            amap_default_city()
        } else {
            explicit.to_string()
        }
    };

    let response = client
        .get(AMAP_GEOCODE_ENDPOINT)
        .query(&[
            ("key", key.as_str()),
            ("address", normalized),
            ("output", "json"),
            ("city", city.as_str()),
        ])
        .send();

    let rows = match response.and_then(|result| result.error_for_status()) {
        Ok(response) => response.json::<AmapGeocodeResponse>(),
        Err(_) => return failed_outcome(normalized),
    };

    if let Ok(payload) = rows {
        let first = payload.geocodes.as_ref().and_then(|rows| rows.first());
        let (latitude, longitude) = first
            .map(|row| split_amap_location(&row.location))
            .unwrap_or((None, None));
        if payload.status.trim() == "1" && latitude.is_some() && longitude.is_some() {
            return resolved_outcome(normalized, &city, latitude, longitude);
        }
    }

    let keywords = place_search_keywords(venue_name, address_text, normalized);
    if keywords.is_empty() {
        return failed_outcome(normalized);
    }

    let place_response = client
        .get(AMAP_PLACE_TEXT_ENDPOINT)
        .query(&[
            ("key", key.as_str()),
            ("keywords", keywords.as_str()),
            ("city", city.as_str()),
            ("offset", "5"),
            ("page", "1"),
            ("extensions", "base"),
            ("output", "json"),
        ])
        .send();

    let pois = match place_response.and_then(|result| result.error_for_status()) {
        Ok(response) => response.json::<AmapPlaceSearchResponse>(),
        Err(_) => return failed_outcome(&keywords),
    };

    match pois {
        Ok(payload) => {
            let first = payload.pois.as_ref().and_then(|rows| rows.first());
            let (latitude, longitude) = first
                .map(|row| split_amap_location(&row.location))
                .unwrap_or((None, None));
            if payload.status.trim() == "1" && latitude.is_some() && longitude.is_some() {
                return resolved_outcome(&keywords, &city, latitude, longitude);
            }
            failed_outcome(&keywords)
        }
        Err(_) => failed_outcome(&keywords),
    }
}
