use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::fs::OpenOptions;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::import_validator::{
    manifest_to_model_record, normalize_and_validate_capabilities, parse_and_validate_manifest,
    validate_loopback_endpoint,
};
use super::store::runtime_models_dir;
use super::types::{
    default_artifact_roles_for_capabilities, default_fallback_engines_for_engine,
    default_logical_model_id, default_preferred_engine_for_capabilities,
    normalize_local_engine, normalize_non_empty, slugify_local_model_id,
    ImportedModelManifest, ImportedModelSource, LocalAiInstallRequest, DEFAULT_LOCAL_ENDPOINT,
};

#[derive(Debug, Clone)]
pub struct HfDownloadProgress {
    pub phase: String,
    pub bytes_received: u64,
    pub bytes_total: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HfDownloadControl {
    Continue,
    Pause,
    Cancel,
}

/// Returns the base URL for HuggingFace downloads.
/// Priority: NIMI_HF_MIRROR > HF_ENDPOINT > default "https://huggingface.co".
pub(super) fn hf_download_base_url() -> String {
    if let Ok(value) = std::env::var("NIMI_HF_MIRROR") {
        let trimmed = value.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    if let Ok(value) = std::env::var("HF_ENDPOINT") {
        let trimmed = value.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    "https://huggingface.co".to_string()
}

include!("repo_normalization.rs");
include!("download_transport.rs");
include!("install_flow.rs");
include!("tests.rs");

pub(super) fn download_file_for_local_runtime<F>(
    url: &str,
    destination: &std::path::PathBuf,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(HfDownloadProgress) -> HfDownloadControl,
{
    download_file_with_resume(url, destination, on_progress)
}

pub(super) fn sha256_hex_for_local_runtime(path: &std::path::Path) -> Result<String, String> {
    sha256_hex_streaming_with_progress(path, &mut |_bytes_verified, _bytes_total| true)
}
