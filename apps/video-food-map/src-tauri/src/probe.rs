use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;

const GEOCODER_PROVIDER: &str = "nominatim";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeMetadata {
    pub bvid: String,
    pub aid: String,
    pub cid: String,
    pub title: String,
    pub owner_mid: String,
    pub owner_name: String,
    pub duration_sec: f64,
    pub description: String,
    pub tags: Vec<String>,
    pub canonical_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeExtractionCoverage {
    pub state: String,
    pub processed_segment_count: i64,
    pub processed_duration_sec: f64,
    pub total_duration_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSavedFiles {
    pub metadata_json: String,
    pub transcript_text: String,
    pub extraction_raw_text: String,
    pub extraction_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeCommentClue {
    pub comment_id: String,
    pub author_name: String,
    pub message: String,
    pub like_count: i64,
    pub published_at: String,
    pub matched_venue_names: Vec<String>,
    pub address_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub metadata: ProbeMetadata,
    pub audio_source_url: String,
    pub selected_stt_model: String,
    pub raw_comment_count: i64,
    pub comment_clues: Vec<ProbeCommentClue>,
    pub extraction_coverage: ProbeExtractionCoverage,
    pub transcript: String,
    pub extraction_raw: String,
    pub extraction_json: Option<Value>,
    pub output_dir: String,
    pub saved_files: ProbeSavedFiles,
}

#[derive(Debug, Clone)]
pub struct GeocodeOutcome {
    pub provider: String,
    pub status: String,
    pub query: String,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct NominatimRow {
    lat: String,
    lon: String,
}

fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("../../..")
        .canonicalize()
        .map_err(|error| format!("failed to resolve repo root: {error}"))
}

fn app_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("..")
        .canonicalize()
        .map_err(|error| format!("failed to resolve app root: {error}"))
}

fn normalize_path_env() -> String {
    let base = env::var("PATH").unwrap_or_default();
    let mut prefixes = vec![
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    if !base.trim().is_empty() {
        prefixes.push(base);
    }
    prefixes.join(":")
}

fn tsx_binary_candidates() -> Result<Vec<PathBuf>, String> {
    let repo_root = repo_root()?;
    let app_root = app_root()?;
    Ok(vec![
        app_root.join("node_modules/.bin/tsx"),
        repo_root.join("apps/realm-drift/node_modules/.bin/tsx"),
        repo_root.join("node_modules/.bin/tsx"),
    ])
}

fn find_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.exists()).cloned()
}

fn best_command_path() -> Result<PathBuf, String> {
    let candidates = tsx_binary_candidates()?;
    find_existing_path(&candidates).ok_or_else(|| {
        format!(
            "tsx binary not found; looked in: {}",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })
}

fn spawn_probe_command(url: &str) -> Result<String, String> {
    let repo_root = repo_root()?;
    let command_path = best_command_path()?;
    let script_path =
        repo_root.join("apps/video-food-map/scripts/run-bilibili-food-video-probe.mts");
    let grpc_addr = crate::runtime_daemon::ensure_running()?;
    let output = Command::new(&command_path)
        .arg(script_path.as_os_str())
        .arg("--url")
        .arg(url)
        .current_dir(&repo_root)
        .env("PATH", normalize_path_env())
        .env("NIMI_RUNTIME_GRPC_ADDR", grpc_addr)
        .output()
        .map_err(|error| format!("failed to start probe command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "probe command failed with status {}.\nstdout={}\nstderr={}",
            output.status,
            stdout.trim(),
            stderr.trim(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn run_probe(url: &str) -> Result<ProbeResult, String> {
    let stdout = spawn_probe_command(url)?;
    serde_json::from_str::<ProbeResult>(&stdout)
        .map_err(|error| format!("probe returned invalid json: {error}"))
}

pub fn extract_bvid_hint(url: &str) -> String {
    let chars: Vec<char> = url.chars().collect();
    for index in 0..chars.len() {
        if chars[index] != 'B' {
            continue;
        }
        if chars.get(index + 1) != Some(&'V') {
            continue;
        }
        let mut end = index + 2;
        while end < chars.len() && chars[end].is_ascii_alphanumeric() {
            end += 1;
        }
        if end > index + 2 {
            return chars[index..end].iter().collect();
        }
    }
    String::new()
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
    format!("{venue} {address}")
}

pub fn geocode_address(query: &str) -> GeocodeOutcome {
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

    let client = match reqwest::blocking::Client::builder()
        .user_agent("nimi-video-food-map/0.1 (local desktop app)")
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return GeocodeOutcome {
                provider: GEOCODER_PROVIDER.to_string(),
                status: "failed".to_string(),
                query: normalized.to_string(),
                latitude: None,
                longitude: None,
            }
        }
    };

    let response = client
        .get("https://nominatim.openstreetmap.org/search")
        .query(&[("format", "jsonv2"), ("limit", "1"), ("q", normalized)])
        .send();

    let rows = match response.and_then(|result| result.error_for_status()) {
        Ok(response) => response.json::<Vec<NominatimRow>>(),
        Err(_) => {
            return GeocodeOutcome {
                provider: GEOCODER_PROVIDER.to_string(),
                status: "failed".to_string(),
                query: normalized.to_string(),
                latitude: None,
                longitude: None,
            }
        }
    };

    match rows {
        Ok(rows) => {
            let first = rows.first();
            let latitude = first.and_then(|row| row.lat.parse::<f64>().ok());
            let longitude = first.and_then(|row| row.lon.parse::<f64>().ok());
            let status = if latitude.is_some() && longitude.is_some() {
                "resolved"
            } else {
                "failed"
            };
            GeocodeOutcome {
                provider: GEOCODER_PROVIDER.to_string(),
                status: status.to_string(),
                query: normalized.to_string(),
                latitude,
                longitude,
            }
        }
        Err(_) => GeocodeOutcome {
            provider: GEOCODER_PROVIDER.to_string(),
            status: "failed".to_string(),
            query: normalized.to_string(),
            latitude: None,
            longitude: None,
        },
    }
}

pub fn path_display(path: &Path) -> String {
    path.display().to_string()
}
