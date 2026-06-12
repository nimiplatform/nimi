//! Agent canonical memory export save command.
//!
//! The export envelope is assembled in the typed SDK helper
//! (`createNimiRuntimeAgentMemoryExport`, S-SURFACE-015/016 non-authoritative
//! posture); this command only persists the caller-provided artifact into the
//! operating-system Downloads directory and reveals it, mirroring the
//! `desktop_logs_export` artifact shape so the user can immediately locate
//! their memory export.
//!
//! Fail-closed: an empty payload, invalid JSON, a payload without the export
//! `schemaVersion` marker, or any filesystem error yields a typed `Err` —
//! never a fabricated artifact path or a pseudo-success result. The command
//! never reads, mutates, or deletes memory state; it is a pure sink for the
//! SDK-assembled envelope.

use std::fs;
use std::path::Path;

use serde::Serialize;

const EXPORT_FILE_PREFIX: &str = "nimi-agent-memory-export-";

/// Typed result of a successful memory-export save. Surfaced to the renderer
/// so the memory sovereignty surface can show where the artifact landed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryExportSaveResult {
    /// Absolute path of the produced `.json` artifact.
    pub artifact_path: String,
    /// Byte size of the persisted envelope.
    pub byte_size: u64,
    /// UTC RFC3339 timestamp the artifact was persisted at.
    pub saved_at: String,
}

#[tauri::command]
pub async fn desktop_agent_memory_export_save(
    envelope_json: String,
) -> Result<AgentMemoryExportSaveResult, String> {
    tauri::async_runtime::spawn_blocking(move || save_envelope(&envelope_json))
        .await
        .map_err(|join_error| {
            format!("agent memory export save task failed to complete: {join_error}")
        })?
}

fn save_envelope(envelope_json: &str) -> Result<AgentMemoryExportSaveResult, String> {
    if envelope_json.trim().is_empty() {
        return Err("agent memory export envelope is empty".to_string());
    }
    let parsed: serde_json::Value = serde_json::from_str(envelope_json)
        .map_err(|error| format!("agent memory export envelope is not valid JSON: {error}"))?;
    if parsed
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .is_none()
    {
        return Err("agent memory export envelope is missing the schemaVersion marker".to_string());
    }
    let downloads_dir = crate::desktop_logs_export::resolve_downloads_dir()?;
    let saved_at = chrono::Utc::now();
    let file_name = format!(
        "{EXPORT_FILE_PREFIX}{}.json",
        saved_at.format("%Y%m%dT%H%M%SZ"),
    );
    let artifact_path = downloads_dir.join(file_name);
    fs::write(&artifact_path, envelope_json.as_bytes()).map_err(|error| {
        format!(
            "agent memory export could not be written to {}: {error}",
            artifact_path.display(),
        )
    })?;
    crate::desktop_logs_export::reveal_in_os(Path::new(&artifact_path));
    Ok(AgentMemoryExportSaveResult {
        artifact_path: artifact_path.display().to_string(),
        byte_size: envelope_json.len() as u64,
        saved_at: saved_at.to_rfc3339(),
    })
}

#[cfg(test)]
mod tests {
    use super::save_envelope;

    #[test]
    fn rejects_empty_envelope() {
        let error = save_envelope("   ").expect_err("empty envelope must fail closed");
        assert!(error.contains("empty"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_invalid_json() {
        let error = save_envelope("{not json").expect_err("invalid JSON must fail closed");
        assert!(
            error.contains("not valid JSON"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn rejects_envelope_without_schema_version() {
        let error =
            save_envelope("{\"records\":[]}").expect_err("missing schemaVersion must fail closed");
        assert!(error.contains("schemaVersion"), "unexpected error: {error}");
    }
}
