use std::fs;
use std::path::{Path, PathBuf};

use nimi_kit_shell_tauri::desktop_paths::resolve_nimi_data_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::avatar_launch_context::AvatarLaunchContext;

const AVATAR_EVIDENCE_DIR: &str = "avatar-carrier-evidence";
const AVATAR_EVIDENCE_SCHEMA_VERSION: u32 = 1;
const MAX_EVIDENCE_RECORDS: usize = 200;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarEvidenceRecordInput {
    pub kind: String,
    pub recorded_at: String,
    #[serde(default)]
    pub detail: Value,
    #[serde(default)]
    pub consume: Value,
    #[serde(default)]
    pub model: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarEvidenceRecord {
    pub kind: String,
    pub recorded_at: String,
    pub detail: Value,
    pub consume: Value,
    pub model: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarEvidenceProjection {
    pub schema_version: u32,
    pub publisher_pid: u32,
    pub updated_at: String,
    pub launch_context: AvatarLaunchContext,
    pub records: Vec<AvatarEvidenceRecord>,
}

fn evidence_root_dir() -> Result<PathBuf, String> {
    let root = resolve_nimi_data_dir()?.join(AVATAR_EVIDENCE_DIR);
    fs::create_dir_all(&root).map_err(|error| {
        format!(
            "failed to create avatar carrier evidence dir ({}): {error}",
            root.display()
        )
    })?;
    Ok(root)
}

fn sanitize_path_component(input: &str) -> String {
    let mut out = String::new();
    for ch in input.trim().chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    let trimmed = out.trim_matches('_').to_string();
    if trimmed.is_empty() {
        "avatar-instance".to_string()
    } else {
        trimmed
    }
}

fn evidence_path_for_context(context: &AvatarLaunchContext) -> Result<PathBuf, String> {
    Ok(evidence_root_dir()?.join(format!(
        "{}.json",
        sanitize_path_component(&context.avatar_instance_id)
    )))
}

fn read_projection(path: &Path) -> Result<Option<AvatarEvidenceProjection>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "failed to read avatar carrier evidence ({}): {error}",
            path.display()
        )
    })?;
    let projection = serde_json::from_str::<AvatarEvidenceProjection>(&raw).map_err(|error| {
        format!(
            "failed to parse avatar carrier evidence ({}): {error}",
            path.display()
        )
    })?;
    Ok(Some(projection))
}

fn persist_projection(path: &Path, projection: &AvatarEvidenceProjection) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(projection)
        .map_err(|error| format!("failed to serialize avatar carrier evidence: {error}"))?;
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
            "failed to write avatar carrier evidence temp file ({}): {error}",
            temp_path.display()
        )
    })?;
    fs::rename(&temp_path, path).map_err(|error| {
        format!(
            "failed to persist avatar carrier evidence ({}): {error}",
            path.display()
        )
    })
}

pub fn append_evidence_record(
    context: AvatarLaunchContext,
    input: AvatarEvidenceRecordInput,
) -> Result<PathBuf, String> {
    let kind = input.kind.trim().to_string();
    if kind.is_empty() {
        return Err("avatar carrier evidence kind is required".to_string());
    }
    let recorded_at = input.recorded_at.trim().to_string();
    if recorded_at.is_empty() {
        return Err("avatar carrier evidence recorded_at is required".to_string());
    }
    let path = evidence_path_for_context(&context)?;
    let mut projection = read_projection(&path)?.unwrap_or_else(|| AvatarEvidenceProjection {
        schema_version: AVATAR_EVIDENCE_SCHEMA_VERSION,
        publisher_pid: std::process::id(),
        updated_at: recorded_at.clone(),
        launch_context: context.clone(),
        records: Vec::new(),
    });
    projection.schema_version = AVATAR_EVIDENCE_SCHEMA_VERSION;
    projection.publisher_pid = std::process::id();
    projection.updated_at = recorded_at.clone();
    projection.launch_context = context;
    projection.records.push(AvatarEvidenceRecord {
        kind,
        recorded_at,
        detail: input.detail,
        consume: input.consume,
        model: input.model,
    });
    if projection.records.len() > MAX_EVIDENCE_RECORDS {
        let drop_count = projection.records.len() - MAX_EVIDENCE_RECORDS;
        projection.records.drain(0..drop_count);
    }
    persist_projection(&path, &projection)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::{append_evidence_record, AvatarEvidenceRecordInput};
    use crate::avatar_launch_context::{AvatarLaunchContext, AvatarScopedBindingProjection};

    fn context() -> AvatarLaunchContext {
        AvatarLaunchContext {
            agent_id: "agent-1".to_string(),
            avatar_package_kind: "live2d".to_string(),
            avatar_package_id: "live2d_ab12cd34ef56".to_string(),
            avatar_package_schema_version: 1,
            avatar_instance_id: "instance-1".to_string(),
            conversation_anchor_id: "anchor-1".to_string(),
            launched_by: "nimi.desktop".to_string(),
            runtime_app_id: Some("nimi.desktop".to_string()),
            source_surface: Some("desktop-agent-chat".to_string()),
            world_id: Some("world-1".to_string()),
            scoped_binding: AvatarScopedBindingProjection {
                binding_id: "binding-1".to_string(),
                binding_handle: None,
                runtime_app_id: "nimi.desktop".to_string(),
                app_instance_id: "nimi.desktop.local-first-party".to_string(),
                window_id: "desktop-agent-chat".to_string(),
                avatar_instance_id: "instance-1".to_string(),
                agent_id: "agent-1".to_string(),
                conversation_anchor_id: "anchor-1".to_string(),
                world_id: Some("world-1".to_string()),
                purpose: "avatar.interaction.consume".to_string(),
                scopes: vec![
                    "runtime.agent.turn.read".to_string(),
                    "runtime.agent.presentation.read".to_string(),
                    "runtime.agent.state.read".to_string(),
                ],
                issued_at: None,
                expires_at: None,
                state: "active".to_string(),
                reason_code: "action_executed".to_string(),
            },
        }
    }

    #[test]
    fn append_evidence_record_writes_context_and_records() {
        let _guard = crate::test_env_guard();
        let temp_home =
            std::env::temp_dir().join(format!("nimi-avatar-evidence-{}", std::process::id()));
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &temp_home);

        let path = append_evidence_record(
            context(),
            AvatarEvidenceRecordInput {
                kind: "avatar.model.load".to_string(),
                recorded_at: "2026-04-26T00:00:00.000Z".to_string(),
                detail: json!({ "model_id": "ren", "compatibility_tier": "enhanced" }),
                consume: json!({ "mode": "sdk", "authority": "runtime" }),
                model: json!({ "modelId": "ren" }),
            },
        )
        .expect("write evidence");

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        let raw = fs::read_to_string(path).expect("read evidence");
        assert!(raw.contains("\"avatarInstanceId\": \"instance-1\""));
        assert!(raw.contains("\"conversationAnchorId\": \"anchor-1\""));
        assert!(raw.contains("\"kind\": \"avatar.model.load\""));
        let _ = fs::remove_dir_all(temp_home);
    }
}
