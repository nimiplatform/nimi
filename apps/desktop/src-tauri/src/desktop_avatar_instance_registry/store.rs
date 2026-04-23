use super::types::{DesktopAvatarInstanceRegistryFile, DesktopAvatarInstanceRegistryRecord};
use crate::desktop_paths::resolve_nimi_data_dir;
use std::fs;
use std::path::{Path, PathBuf};
use sysinfo::{Pid, ProcessesToUpdate, System};

const AVATAR_INSTANCE_REGISTRY_DIR: &str = "avatar-instance-registry";
const AVATAR_INSTANCE_REGISTRY_FILE: &str = "instances.json";
const PROCESS_START_TIME_SKEW_MS: i64 = 1_000;

fn registry_path() -> Result<PathBuf, String> {
    Ok(resolve_nimi_data_dir()?
        .join(AVATAR_INSTANCE_REGISTRY_DIR)
        .join(AVATAR_INSTANCE_REGISTRY_FILE))
}

fn load_registry_from_path(path: &Path) -> Result<DesktopAvatarInstanceRegistryFile, String> {
    if !path.exists() {
        return Ok(DesktopAvatarInstanceRegistryFile::default());
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read avatar instance registry ({}): {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<DesktopAvatarInstanceRegistryFile>(&raw).map_err(|error| {
        format!(
            "failed to parse avatar instance registry ({}): {error}",
            path.display()
        )
    })
}

fn process_start_time_ms(pid: u32) -> Option<i64> {
    if pid == 0 {
        return None;
    }
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let process = system.process(Pid::from(pid as usize))?;
    Some((process.start_time() as i64).saturating_mul(1000))
}

fn process_start_time_matches_projection(process_started_at_ms: i64, published_at_ms: i64) -> bool {
    process_started_at_ms <= published_at_ms.saturating_add(PROCESS_START_TIME_SKEW_MS)
}

fn is_projection_owned_by_live_process(publisher_pid: u32, published_at_ms: i64) -> bool {
    let Some(process_started_at_ms) = process_start_time_ms(publisher_pid) else {
        return false;
    };
    process_start_time_matches_projection(process_started_at_ms, published_at_ms)
}

fn list_instances_from_file(
    file: DesktopAvatarInstanceRegistryFile,
    agent_id: Option<&str>,
) -> Result<Vec<DesktopAvatarInstanceRegistryRecord>, String> {
    if !is_projection_owned_by_live_process(file.publisher_pid, file.published_at_ms) {
        return Ok(Vec::new());
    }
    let filter = agent_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(file
        .instances
        .into_iter()
        .filter(|record| {
            filter
                .as_ref()
                .map(|expected| record.agent_id == *expected)
                .unwrap_or(true)
        })
        .collect())
}

pub(crate) fn list_instances(
    agent_id: Option<&str>,
) -> Result<Vec<DesktopAvatarInstanceRegistryRecord>, String> {
    let path = registry_path()?;
    let file = load_registry_from_path(&path)?;
    list_instances_from_file(file, agent_id)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        list_instances_from_file, load_registry_from_path, process_start_time_matches_projection,
        DesktopAvatarInstanceRegistryFile,
    };

    fn temp_registry_path() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "nimi-desktop-avatar-instance-registry-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&root);
        root.join("instances.json")
    }

    #[test]
    fn load_registry_from_missing_path_returns_empty_file() {
        let path = temp_registry_path();
        let _ = fs::remove_file(&path);

        let loaded = load_registry_from_path(&path).expect("load empty registry");

        assert!(loaded.instances.is_empty());
    }

    #[test]
    fn load_registry_from_path_parses_instances() {
        let path = temp_registry_path();
        fs::write(
            &path,
            r#"{
  "schemaVersion": 1,
  "publisherPid": 7,
  "publishedAtMs": 100,
  "instances": [
    {
      "avatarInstanceId": "instance-1",
      "agentId": "agent-1",
      "conversationAnchorId": "anchor-1",
      "anchorMode": "existing",
      "launchedBy": "desktop",
      "sourceSurface": "desktop-agent-chat"
    }
  ]
}"#,
        )
        .expect("write registry");

        let loaded = load_registry_from_path(&path).expect("parse registry");

        assert_eq!(loaded.instances.len(), 1);
        assert_eq!(loaded.instances[0].avatar_instance_id, "instance-1");
    }

    #[test]
    fn list_instances_returns_empty_when_publisher_pid_is_stale() {
        let listed = list_instances_from_file(
            DesktopAvatarInstanceRegistryFile {
                schema_version: 1,
                publisher_pid: 999999,
                published_at_ms: 100,
                instances: vec![super::DesktopAvatarInstanceRegistryRecord {
                    avatar_instance_id: "instance-1".to_string(),
                    agent_id: "agent-1".to_string(),
                    conversation_anchor_id: Some("anchor-1".to_string()),
                    anchor_mode: "existing".to_string(),
                    launched_by: "desktop".to_string(),
                    source_surface: Some("desktop-agent-chat".to_string()),
                }],
            },
            None,
        )
        .expect("list instances");

        assert!(listed.is_empty());
    }

    #[test]
    fn list_instances_returns_empty_when_publisher_pid_is_zero() {
        let listed = list_instances_from_file(
            DesktopAvatarInstanceRegistryFile {
                schema_version: 1,
                publisher_pid: 0,
                published_at_ms: 100,
                instances: vec![super::DesktopAvatarInstanceRegistryRecord {
                    avatar_instance_id: "instance-1".to_string(),
                    agent_id: "agent-1".to_string(),
                    conversation_anchor_id: Some("anchor-1".to_string()),
                    anchor_mode: "existing".to_string(),
                    launched_by: "desktop".to_string(),
                    source_surface: Some("desktop-agent-chat".to_string()),
                }],
            },
            None,
        )
        .expect("list instances");

        assert!(listed.is_empty());
    }

    #[test]
    fn projection_ownership_rejects_processes_started_after_projection() {
        assert!(process_start_time_matches_projection(10_000, 10_500));
        assert!(!process_start_time_matches_projection(12_000, 10_000));
    }
}
