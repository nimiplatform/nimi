use std::fs;
use std::path::{Path, PathBuf};

use nimi_kit_shell_tauri::desktop_paths::resolve_nimi_data_dir;
use serde::{Deserialize, Serialize};

const AVATAR_INSTANCE_PROJECTION_DIR: &str = "avatar-instance-registry";
const AVATAR_INSTANCE_PROJECTION_FILE: &str = "instances.json";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarInstanceProjectionRecord {
    pub avatar_instance_id: String,
    pub agent_id: String,
    pub launch_source: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarInstanceProjectionFile {
    pub schema_version: u32,
    pub publisher_pid: u32,
    pub published_at_ms: i64,
    #[serde(default)]
    pub instances: Vec<AvatarInstanceProjectionRecord>,
}

fn projection_root_dir() -> Result<PathBuf, String> {
    let root = resolve_nimi_data_dir()?.join(AVATAR_INSTANCE_PROJECTION_DIR);
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create avatar instance projection dir ({}): {error}",
            root.display()
        )
    })?;
    Ok(root)
}

fn projection_path() -> Result<PathBuf, String> {
    Ok(projection_root_dir()?.join(AVATAR_INSTANCE_PROJECTION_FILE))
}

fn persist_projection_to_path(
    path: &Path,
    payload: &AvatarInstanceProjectionFile,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(payload)
        .map_err(|error| format!("failed to serialize avatar instance projection: {error}"))?;
    let temp_path = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&temp_path, raw).map_err(|error| {
        format!(
            "failed to write avatar instance projection temp file ({}): {error}",
            temp_path.display()
        )
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "failed to persist avatar instance projection ({}): {error}",
            path.display()
        )
    })
}

pub fn persist_projection(
    publisher_pid: u32,
    published_at_ms: i64,
    records: Vec<AvatarInstanceProjectionRecord>,
) -> Result<(), String> {
    let path = projection_path()?;
    persist_projection_to_path(
        &path,
        &AvatarInstanceProjectionFile {
            schema_version: 1,
            publisher_pid,
            published_at_ms,
            instances: records,
        },
    )
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        persist_projection_to_path, AvatarInstanceProjectionFile, AvatarInstanceProjectionRecord,
    };
    fn temp_projection_path() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "nimi-avatar-instance-projection-{}-{}",
            std::process::id(),
            "projection"
        ));
        let _ = fs::create_dir_all(&root);
        root.join("instances.json")
    }

    #[test]
    fn persist_projection_writes_json_payload() {
        let path = temp_projection_path();
        let payload = AvatarInstanceProjectionFile {
            schema_version: 1,
            publisher_pid: 42,
            published_at_ms: 123,
            instances: vec![AvatarInstanceProjectionRecord {
                avatar_instance_id: "instance-1".to_string(),
                agent_id: "agent-1".to_string(),
                launch_source: Some("desktop-agent-chat".to_string()),
            }],
        };

        persist_projection_to_path(&path, &payload).expect("persist projection");

        let raw = fs::read_to_string(&path).expect("read projection");
        assert!(raw.contains("\"schemaVersion\": 1"));
        assert!(raw.contains("\"publisherPid\": 42"));
        assert!(raw.contains("\"avatarInstanceId\": \"instance-1\""));
        assert!(raw.contains("\"publishedAtMs\": 123"));
    }
}
