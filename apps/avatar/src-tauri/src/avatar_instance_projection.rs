use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::avatar_instance_registry::AvatarInstanceRegistryEntry;
use crate::avatar_launch_context::AvatarLaunchContext;
use crate::avatar_paths::resolve_avatar_app_data_dir;

const AVATAR_INSTANCE_PROJECTION_DIR: &str = "avatar-instance-registry";
const AVATAR_INSTANCE_PROJECTION_FILE: &str = "instances.json";
const AVATAR_INSTANCE_PROJECTION_SCHEMA_VERSION: u32 = 4;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarInstanceProjectionRecord {
    pub avatar_instance_id: String,
    pub agent_handle: String,
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
    let root = resolve_avatar_app_data_dir()?.join(AVATAR_INSTANCE_PROJECTION_DIR);
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
            schema_version: AVATAR_INSTANCE_PROJECTION_SCHEMA_VERSION,
            publisher_pid,
            published_at_ms,
            instances: records,
        },
    )
}

pub fn projection_record_from_launch_context(
    context: &AvatarLaunchContext,
    fallback_avatar_instance_id: &str,
) -> Option<AvatarInstanceProjectionRecord> {
    let agent_handle = context.agent_handle.trim();
    if agent_handle.is_empty() {
        return None;
    }
    let avatar_instance_id = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or(fallback_avatar_instance_id)
        .trim();
    if avatar_instance_id.is_empty() {
        return None;
    }
    Some(AvatarInstanceProjectionRecord {
        avatar_instance_id: avatar_instance_id.to_string(),
        agent_handle: agent_handle.to_string(),
        launch_source: context.launch_source.clone(),
    })
}

pub fn projection_record_from_registry_entry(
    entry: &AvatarInstanceRegistryEntry,
) -> Option<AvatarInstanceProjectionRecord> {
    projection_record_from_launch_context(&entry.context, &entry.window_label)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        persist_projection_to_path, projection_record_from_launch_context,
        projection_record_from_registry_entry, AvatarInstanceProjectionFile,
        AvatarInstanceProjectionRecord, AVATAR_INSTANCE_PROJECTION_SCHEMA_VERSION,
    };
    use crate::avatar_instance_registry::AvatarInstanceRegistryEntry;
    use crate::avatar_launch_context::AvatarLaunchContext;

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
            schema_version: AVATAR_INSTANCE_PROJECTION_SCHEMA_VERSION,
            publisher_pid: 42,
            published_at_ms: 123,
            instances: vec![AvatarInstanceProjectionRecord {
                avatar_instance_id: "instance-1".to_string(),
                agent_handle: format!("agent_ref_{}", "a".repeat(43)),
                launch_source: Some("desktop-agent-chat".to_string()),
            }],
        };

        persist_projection_to_path(&path, &payload).expect("persist projection");

        let raw = fs::read_to_string(&path).expect("read projection");
        assert!(raw.contains("\"schemaVersion\": 4"));
        assert!(raw.contains("\"publisherPid\": 42"));
        assert!(raw.contains("\"avatarInstanceId\": \"instance-1\""));
        assert!(raw.contains(&format!(
            "\"agentHandle\": \"agent_ref_{}\"",
            "a".repeat(43)
        )));
        assert!(!raw.contains("local-agent:opaque-1"));
        assert!(!raw.contains("ownerUserId"));
        assert!(!raw.contains("runtimeSourceRef"));
        assert!(!raw.contains("localAgentRef"));
        assert!(raw.contains("\"publishedAtMs\": 123"));
    }

    #[test]
    fn projection_record_from_launch_context_requires_canonical_handle() {
        let bare_context = AvatarLaunchContext {
            agent_handle: String::new(),
            conversation_anchor_id: "anchor-1".to_string(),
            avatar_instance_id: Some("instance-1".to_string()),
            launch_source: Some("desktop-agent-chat".to_string()),
        };
        assert!(projection_record_from_launch_context(&bare_context, "fallback").is_none());

        let local_context = AvatarLaunchContext {
            agent_handle: format!("agent_ref_{}", "a".repeat(43)),
            conversation_anchor_id: "anchor-1".to_string(),
            avatar_instance_id: Some("instance-1".to_string()),
            launch_source: Some("desktop-agent-chat".to_string()),
        };
        let record = projection_record_from_launch_context(&local_context, "fallback")
            .expect("local selector projection record");

        assert_eq!(record.avatar_instance_id, "instance-1");
        assert_eq!(record.agent_handle, format!("agent_ref_{}", "a".repeat(43)));
    }

    #[test]
    fn projection_record_uses_only_the_launch_selector() {
        let entry = AvatarInstanceRegistryEntry {
            window_label: "avatar-window".to_string(),
            context: AvatarLaunchContext {
                agent_handle: format!("agent_ref_{}", "b".repeat(43)),
                conversation_anchor_id: "anchor-1".to_string(),
                avatar_instance_id: Some("instance-1".to_string()),
                launch_source: Some("desktop-agent-chat".to_string()),
            },
        };

        let record = projection_record_from_registry_entry(&entry).expect("selector projection");

        assert_eq!(record.agent_handle, format!("agent_ref_{}", "b".repeat(43)));
    }
}
