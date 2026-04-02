use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::desktop_paths;
use crate::script_runner;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum VideoFoodMapRouteSource {
    Local,
    #[default]
    Cloud,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFoodMapRouteSetting {
    pub route_source: VideoFoodMapRouteSource,
    pub connector_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFoodMapSettings {
    pub stt: VideoFoodMapRouteSetting,
    pub text: VideoFoodMapRouteSetting,
}

impl Default for VideoFoodMapRouteSetting {
    fn default() -> Self {
        Self {
            route_source: VideoFoodMapRouteSource::Cloud,
            connector_id: String::new(),
            model: String::new(),
        }
    }
}

impl Default for VideoFoodMapSettings {
    fn default() -> Self {
        Self {
            stt: VideoFoodMapRouteSetting::default(),
            text: VideoFoodMapRouteSetting::default(),
        }
    }
}

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

fn settings_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("settings.json"))
}

fn normalize_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_route_setting(value: VideoFoodMapRouteSetting) -> VideoFoodMapRouteSetting {
    VideoFoodMapRouteSetting {
        route_source: value.route_source,
        connector_id: normalize_text(&value.connector_id),
        model: normalize_text(&value.model),
    }
}

pub fn normalize_settings(value: VideoFoodMapSettings) -> VideoFoodMapSettings {
    VideoFoodMapSettings {
        stt: normalize_route_setting(value.stt),
        text: normalize_route_setting(value.text),
    }
}

pub fn load_settings() -> Result<VideoFoodMapSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(VideoFoodMapSettings::default());
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read video-food-map settings ({}): {error}",
            path.display()
        )
    })?;
    let parsed = serde_json::from_str::<VideoFoodMapSettings>(&raw).unwrap_or_default();
    Ok(normalize_settings(parsed))
}

pub fn save_settings(settings: &VideoFoodMapSettings) -> Result<VideoFoodMapSettings, String> {
    let path = settings_path()?;
    let normalized = normalize_settings(settings.clone());
    let serialized = serde_json::to_string_pretty(&normalized)
        .map_err(|error| format!("failed to encode video-food-map settings: {error}"))?;
    fs::write(&path, serialized).map_err(|error| {
        format!(
            "failed to write video-food-map settings ({}): {error}",
            path.display()
        )
    })?;
    Ok(normalized)
}

pub fn load_runtime_options() -> Result<Value, String> {
    let repo_root = script_runner::repo_root()?;
    let command_path = script_runner::best_command_path()?;
    let script_path = repo_root.join("apps/video-food-map/scripts/list-runtime-route-options.mts");
    let grpc_addr = crate::runtime_daemon::ensure_running()?;
    let output = Command::new(&command_path)
        .arg(script_path.as_os_str())
        .current_dir(&repo_root)
        .env("PATH", script_runner::normalize_path_env())
        .env("NIMI_RUNTIME_GRPC_ADDR", grpc_addr)
        .output()
        .map_err(|error| format!("failed to start runtime options command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "runtime options command failed with status {}.\nstdout={}\nstderr={}",
            output.status,
            stdout.trim(),
            stderr.trim(),
        ));
    }

    serde_json::from_str::<Value>(&String::from_utf8_lossy(&output.stdout))
        .map_err(|error| format!("runtime options returned invalid json: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_settings, VideoFoodMapRouteSetting, VideoFoodMapRouteSource, VideoFoodMapSettings,
    };

    #[test]
    fn normalizes_whitespace_in_saved_settings() {
        let normalized = normalize_settings(VideoFoodMapSettings {
            stt: VideoFoodMapRouteSetting {
                route_source: VideoFoodMapRouteSource::Local,
                connector_id: "  connector-1 ".to_string(),
                model: "  local/whisper ".to_string(),
            },
            text: VideoFoodMapRouteSetting {
                route_source: VideoFoodMapRouteSource::Cloud,
                connector_id: " connector-2 ".to_string(),
                model: " qwen-plus ".to_string(),
            },
        });

        assert_eq!(normalized.stt.connector_id, "connector-1");
        assert_eq!(normalized.stt.model, "local/whisper");
        assert_eq!(normalized.text.connector_id, "connector-2");
        assert_eq!(normalized.text.model, "qwen-plus");
    }
}
