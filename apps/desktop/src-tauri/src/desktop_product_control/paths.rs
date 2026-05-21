//! Filesystem path, timestamp, version, and install-id helpers for the
//! product-control record.

use crate::desktop_paths::resolve_nimi_dir;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::record::PRODUCT_CONTROL_FILE_NAME;

pub fn product_control_record_path() -> Result<PathBuf, String> {
    Ok(resolve_nimi_dir()?.join(PRODUCT_CONTROL_FILE_NAME))
}

pub(crate) fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(crate) fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) fn product_version() -> String {
    option_env!("CARGO_PKG_VERSION")
        .unwrap_or("0.0.0")
        .to_string()
}

pub(crate) fn new_install_id() -> String {
    format!("local-{}-{}", now_unix_ms(), std::process::id())
}

pub(crate) fn runtime_config_path() -> Result<String, String> {
    Ok(resolve_nimi_dir()?
        .join("runtime")
        .join("config.json")
        .display()
        .to_string())
}
