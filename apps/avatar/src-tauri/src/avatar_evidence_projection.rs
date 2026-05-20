use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::avatar_launch_context::AvatarLaunchContext;
use crate::avatar_paths::resolve_avatar_nimi_data_dir;

const AVATAR_EVIDENCE_DIR: &str = "avatar-carrier-evidence";
const AVATAR_EVIDENCE_SCHEMA_VERSION: u32 = 1;
const MAX_EVIDENCE_RECORDS: usize = 200;
const MAX_VISUAL_ARTIFACT_BYTES: usize = 8 * 1024 * 1024;
static AVATAR_EVIDENCE_WRITE_LOCK: Mutex<()> = Mutex::new(());

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
    pub avatar_instance_id: String,
    pub conversation_anchor_id: String,
    pub local_agent_ref: String,
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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvatarEvidenceArtifactInput {
    pub artifact_id: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarEvidenceArtifactWriteResult {
    pub artifact_path: String,
    pub artifact_mime_type: String,
    pub artifact_byte_length: usize,
}

fn evidence_root_dir() -> Result<PathBuf, String> {
    let root = resolve_avatar_nimi_data_dir()?.join(AVATAR_EVIDENCE_DIR);
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
    let instance_id = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or("avatar-instance");
    Ok(evidence_root_dir()?.join(format!("{}.json", sanitize_path_component(instance_id))))
}

fn artifact_dir_for_context(context: &AvatarLaunchContext) -> Result<PathBuf, String> {
    let instance_id = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or("avatar-instance");
    let dir = evidence_root_dir()?
        .join("artifacts")
        .join(sanitize_path_component(instance_id));
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "failed to create avatar carrier evidence artifact dir ({}): {error}",
            dir.display()
        )
    })?;
    Ok(dir)
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

fn read_json_string(value: &Value, field: &str) -> String {
    value
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
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

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let trimmed = data_url.trim();
    let Some(encoded) = trimmed.strip_prefix("data:image/png;base64,") else {
        return Err("avatar carrier visual artifact must be a PNG data URL".to_string());
    };
    let bytes = general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("avatar carrier visual artifact base64 decode failed: {error}"))?;
    if bytes.is_empty() {
        return Err("avatar carrier visual artifact is empty".to_string());
    }
    if bytes.len() > MAX_VISUAL_ARTIFACT_BYTES {
        return Err(format!(
            "avatar carrier visual artifact exceeds {} bytes",
            MAX_VISUAL_ARTIFACT_BYTES
        ));
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("avatar carrier visual artifact is not a PNG payload".to_string());
    }
    Ok(bytes)
}

pub fn write_visual_artifact(
    context: AvatarLaunchContext,
    input: AvatarEvidenceArtifactInput,
) -> Result<AvatarEvidenceArtifactWriteResult, String> {
    if input.artifact_id.trim().is_empty() {
        return Err("avatar carrier visual artifact_id is required".to_string());
    }
    let artifact_id = sanitize_path_component(&input.artifact_id);
    let bytes = decode_png_data_url(&input.data_url)?;
    let dir = artifact_dir_for_context(&context)?;
    let path = dir.join(format!("{artifact_id}.png"));
    let temp_path = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&temp_path, &bytes).map_err(|error| {
        format!(
            "failed to write avatar carrier visual artifact temp file ({}): {error}",
            temp_path.display()
        )
    })?;
    fs::rename(&temp_path, &path).map_err(|error| {
        format!(
            "failed to persist avatar carrier visual artifact ({}): {error}",
            path.display()
        )
    })?;
    Ok(AvatarEvidenceArtifactWriteResult {
        artifact_path: path.display().to_string(),
        artifact_mime_type: "image/png".to_string(),
        artifact_byte_length: bytes.len(),
    })
}

pub fn append_evidence_record(
    context: AvatarLaunchContext,
    input: AvatarEvidenceRecordInput,
) -> Result<PathBuf, String> {
    let _write_guard = AVATAR_EVIDENCE_WRITE_LOCK
        .lock()
        .map_err(|_| "avatar carrier evidence write lock is poisoned".to_string())?;
    let kind = input.kind.trim().to_string();
    if kind.is_empty() {
        return Err("avatar carrier evidence kind is required".to_string());
    }
    let recorded_at = input.recorded_at.trim().to_string();
    if recorded_at.is_empty() {
        return Err("avatar carrier evidence recorded_at is required".to_string());
    }
    let path = evidence_path_for_context(&context)?;
    let avatar_instance_id = context
        .avatar_instance_id
        .as_deref()
        .unwrap_or("avatar-instance")
        .to_string();
    let conversation_anchor_id = read_json_string(&input.consume, "conversationAnchorId");
    let local_agent_ref = read_json_string(&input.consume, "agentId");
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
        avatar_instance_id,
        conversation_anchor_id,
        local_agent_ref,
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

    use super::{
        append_evidence_record, write_visual_artifact, AvatarEvidenceArtifactInput,
        AvatarEvidenceRecordInput,
    };
    use crate::avatar_launch_context::AvatarLaunchContext;

    fn context() -> AvatarLaunchContext {
        AvatarLaunchContext {
            agent_id: "agent-1".to_string(),
            avatar_instance_id: Some("instance-1".to_string()),
            launch_source: Some("desktop-agent-chat".to_string()),
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
                consume: json!({
                    "mode": "sdk",
                    "authority": "runtime",
                    "agentId": "local-agent:owner-1:agent-1",
                    "conversationAnchorId": "anchor-1"
                }),
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
        assert!(raw.contains("\"localAgentRef\": \"local-agent:owner-1:agent-1\""));
        assert!(raw.contains("\"launchSource\": \"desktop-agent-chat\""));
        assert!(raw.contains("\"kind\": \"avatar.model.load\""));
        let _ = fs::remove_dir_all(temp_home);
    }

    #[test]
    fn write_visual_artifact_persists_png_under_instance_artifacts() {
        let _guard = crate::test_env_guard();
        let temp_home = std::env::temp_dir().join(format!(
            "nimi-avatar-evidence-artifact-{}",
            std::process::id()
        ));
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &temp_home);

        let result = write_visual_artifact(
            context(),
            AvatarEvidenceArtifactInput {
                artifact_id: "live2d-visible-frame".to_string(),
                data_url: "data:image/png;base64,iVBORw0KGgo=".to_string(),
            },
        )
        .expect("write artifact");

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        assert_eq!(result.artifact_mime_type, "image/png");
        assert_eq!(result.artifact_byte_length, 8);
        assert!(result
            .artifact_path
            .ends_with("avatar-carrier-evidence/artifacts/instance-1/live2d-visible-frame.png"));
        assert!(
            fs::metadata(&result.artifact_path)
                .expect("artifact metadata")
                .len()
                > 0
        );
        let _ = fs::remove_dir_all(temp_home);
    }

    #[test]
    fn write_visual_artifact_rejects_non_png_data_url() {
        let _guard = crate::test_env_guard();
        let temp_home = std::env::temp_dir().join(format!(
            "nimi-avatar-evidence-artifact-reject-{}",
            std::process::id()
        ));
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &temp_home);

        let error = write_visual_artifact(
            context(),
            AvatarEvidenceArtifactInput {
                artifact_id: "frame".to_string(),
                data_url: "data:text/plain;base64,aGVsbG8=".to_string(),
            },
        )
        .expect_err("reject artifact");

        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        assert!(error.contains("PNG data URL"));
        let _ = fs::remove_dir_all(temp_home);
    }
}
