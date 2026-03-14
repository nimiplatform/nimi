use tauri::AppHandle;

use super::store::{load_state, save_state};
use super::types::{
    now_iso_timestamp, LocalAiArtifactRecord, LocalAiArtifactStatus, LocalAiRuntimeState,
};

fn find_artifact_index(state: &LocalAiRuntimeState, local_artifact_id: &str) -> Option<usize> {
    let normalized = local_artifact_id.trim().to_ascii_lowercase();
    state
        .artifacts
        .iter()
        .position(|item| item.local_artifact_id.trim().to_ascii_lowercase() == normalized)
}

fn find_artifact_identity_index(
    state: &LocalAiRuntimeState,
    artifact_id: &str,
    kind: &super::types::LocalAiArtifactKind,
    engine: &str,
) -> Option<usize> {
    let artifact_id = artifact_id.trim();
    let engine = engine.trim();
    state.artifacts.iter().position(|item| {
        item.status != LocalAiArtifactStatus::Removed
            && item.artifact_id.trim() == artifact_id
            && &item.kind == kind
            && item.engine.trim().eq_ignore_ascii_case(engine)
    })
}

pub fn list_artifacts(app: &AppHandle) -> Result<Vec<LocalAiArtifactRecord>, String> {
    let state = load_state(app)?;
    Ok(state.artifacts)
}

pub fn find_installed_artifact_by_identity(
    app: &AppHandle,
    artifact_id: &str,
    kind: &super::types::LocalAiArtifactKind,
    engine: &str,
) -> Result<Option<LocalAiArtifactRecord>, String> {
    let state = load_state(app)?;
    Ok(find_artifact_identity_index(&state, artifact_id, kind, engine)
        .map(|index| state.artifacts[index].clone()))
}

pub fn upsert_artifact(
    app: &AppHandle,
    mut record: LocalAiArtifactRecord,
) -> Result<LocalAiArtifactRecord, String> {
    let mut state = load_state(app)?;
    let now = now_iso_timestamp();
    record.updated_at = now;

    if let Some(index) = find_artifact_index(&state, &record.local_artifact_id) {
        state.artifacts[index] = record.clone();
    } else if let Some(index) = find_artifact_identity_index(
        &state,
        &record.artifact_id,
        &record.kind,
        &record.engine,
    ) {
        record.local_artifact_id = state.artifacts[index].local_artifact_id.clone();
        state.artifacts[index] = record.clone();
    } else {
        state.artifacts.push(record.clone());
    }
    save_state(app, &state)?;
    Ok(record)
}

pub fn mark_artifact_status(
    app: &AppHandle,
    local_artifact_id: &str,
    status: LocalAiArtifactStatus,
    detail: Option<String>,
) -> Result<LocalAiArtifactRecord, String> {
    let mut state = load_state(app)?;
    let index = find_artifact_index(&state, local_artifact_id)
        .ok_or_else(|| format!("artifact 不存在: {local_artifact_id}"))?;
    let artifact = &mut state.artifacts[index];
    artifact.status = status;
    artifact.updated_at = now_iso_timestamp();
    artifact.health_detail = detail.filter(|value| !value.trim().is_empty());
    let snapshot = artifact.clone();
    save_state(app, &state)?;
    Ok(snapshot)
}

pub fn remove_artifact(
    app: &AppHandle,
    local_artifact_id: &str,
) -> Result<LocalAiArtifactRecord, String> {
    mark_artifact_status(
        app,
        local_artifact_id,
        LocalAiArtifactStatus::Removed,
        Some("artifact removed".to_string()),
    )
}
