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
    #[serde(default)]
    pub route_source: VideoFoodMapRouteSource,
    #[serde(default)]
    pub connector_id: String,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFoodMapDiningProfile {
    #[serde(default)]
    pub dietary_restrictions: Vec<String>,
    #[serde(default)]
    pub taboo_ingredients: Vec<String>,
    #[serde(default)]
    pub flavor_preferences: Vec<String>,
    #[serde(default)]
    pub cuisine_preferences: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VideoFoodMapSettings {
    #[serde(default)]
    pub stt: VideoFoodMapRouteSetting,
    #[serde(default)]
    pub text: VideoFoodMapRouteSetting,
    #[serde(default)]
    pub dining_profile: VideoFoodMapDiningProfile,
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
            dining_profile: VideoFoodMapDiningProfile::default(),
        }
    }
}

impl Default for VideoFoodMapDiningProfile {
    fn default() -> Self {
        Self {
            dietary_restrictions: Vec::new(),
            taboo_ingredients: Vec::new(),
            flavor_preferences: Vec::new(),
            cuisine_preferences: Vec::new(),
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

fn normalize_string_list(values: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let trimmed = normalize_text(&value);
        if trimmed.is_empty() || normalized.contains(&trimmed) {
            continue;
        }
        normalized.push(trimmed);
    }
    normalized
}

fn normalize_dining_profile(value: VideoFoodMapDiningProfile) -> VideoFoodMapDiningProfile {
    VideoFoodMapDiningProfile {
        dietary_restrictions: normalize_string_list(value.dietary_restrictions),
        taboo_ingredients: normalize_string_list(value.taboo_ingredients),
        flavor_preferences: normalize_string_list(value.flavor_preferences),
        cuisine_preferences: normalize_string_list(value.cuisine_preferences),
    }
}

pub fn normalize_settings(value: VideoFoodMapSettings) -> VideoFoodMapSettings {
    VideoFoodMapSettings {
        stt: normalize_route_setting(value.stt),
        text: normalize_route_setting(value.text),
        dining_profile: normalize_dining_profile(value.dining_profile),
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
        normalize_settings, VideoFoodMapDiningProfile, VideoFoodMapRouteSetting,
        VideoFoodMapRouteSource, VideoFoodMapSettings,
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
            dining_profile: VideoFoodMapDiningProfile::default(),
        });

        assert_eq!(normalized.stt.connector_id, "connector-1");
        assert_eq!(normalized.stt.model, "local/whisper");
        assert_eq!(normalized.text.connector_id, "connector-2");
        assert_eq!(normalized.text.model, "qwen-plus");
    }

    #[test]
    fn normalizes_and_deduplicates_dining_profile_values() {
        let normalized = normalize_settings(VideoFoodMapSettings {
            stt: VideoFoodMapRouteSetting::default(),
            text: VideoFoodMapRouteSetting::default(),
            dining_profile: VideoFoodMapDiningProfile {
                dietary_restrictions: vec![
                    " no_beef ".to_string(),
                    "no_beef".to_string(),
                    "".to_string(),
                ],
                taboo_ingredients: vec![" no_coriander ".to_string()],
                flavor_preferences: vec![" prefer_light ".to_string()],
                cuisine_preferences: vec![" cuisine_bbq ".to_string()],
            },
        });

        assert_eq!(
            normalized.dining_profile.dietary_restrictions,
            vec!["no_beef"]
        );
        assert_eq!(
            normalized.dining_profile.taboo_ingredients,
            vec!["no_coriander"]
        );
        assert_eq!(
            normalized.dining_profile.flavor_preferences,
            vec!["prefer_light"]
        );
        assert_eq!(
            normalized.dining_profile.cuisine_preferences,
            vec!["cuisine_bbq"]
        );
    }
}
