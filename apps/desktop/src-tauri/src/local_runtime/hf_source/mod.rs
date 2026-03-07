use std::collections::{HashMap, HashSet};
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
    normalize_non_empty, slugify_local_model_id, ImportedModelManifest, ImportedModelSource,
    LocalAiInstallRequest, DEFAULT_LOCAL_RUNTIME_ENDPOINT,
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
