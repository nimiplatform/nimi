use super::*;
use std::fs;

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn require_absolute_path(path: &str, field: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is required"));
    }
    let path_buf = PathBuf::from(trimmed);
    if !path_buf.is_absolute() {
        return Err(format!("{field} must be absolute"));
    }
    Ok(path_buf)
}

fn require_enabled_macos_smoke_override(
) -> Result<crate::desktop_e2e_fixture::DesktopE2EMacosSmokeOverride, String> {
    let Some(override_payload) = crate::desktop_e2e_fixture::macos_smoke_override()? else {
        return Err("desktop macOS smoke is not enabled".to_string());
    };
    if !override_payload.enabled {
        return Err("desktop macOS smoke is not enabled".to_string());
    }
    Ok(override_payload)
}

fn sanitize_avatar_evidence_component(input: &str) -> String {
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

pub(crate) fn append_macos_smoke_backend_stage(
    stage: &str,
    details: Option<&serde_json::Value>,
) -> Result<(), String> {
    let _override_payload = require_enabled_macos_smoke_override()?;
    let normalized_stage = stage.trim();
    if normalized_stage.is_empty() {
        return Err("stage is required".to_string());
    }
    let detail_text = details
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("serialize details failed: {error}"))?
        .unwrap_or_else(|| "{}".to_string());
    eprintln!(
        "macos_smoke_ping stage={} details={}",
        normalized_stage, detail_text
    );
    crate::desktop_e2e_fixture::append_backend_log_message(&format!(
        "macos_smoke_ping stage={} details={}",
        normalized_stage, detail_text
    ));
    Ok(())
}

#[tauri::command]
pub(crate) fn desktop_macos_smoke_avatar_evidence_read(
    payload: DesktopMacosSmokeAvatarEvidenceReadPayload,
) -> Result<DesktopMacosSmokeAvatarEvidenceReadResult, String> {
    let _override_payload = require_enabled_macos_smoke_override()?;
    let avatar_instance_id = payload.avatar_instance_id.trim();
    if avatar_instance_id.is_empty() {
        return Err("avatarInstanceId is required".to_string());
    }
    let evidence_path = crate::desktop_paths::resolve_nimi_data_dir()?
        .join("avatar-carrier-evidence")
        .join(format!(
            "{}.json",
            sanitize_avatar_evidence_component(avatar_instance_id)
        ));
    let raw = fs::read_to_string(&evidence_path).map_err(|error| {
        format!(
            "read avatar carrier evidence failed ({}): {error}",
            evidence_path.display()
        )
    })?;
    let evidence = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
        format!(
            "parse avatar carrier evidence failed ({}): {error}",
            evidence_path.display()
        )
    })?;
    Ok(DesktopMacosSmokeAvatarEvidenceReadResult {
        evidence_path: evidence_path.display().to_string(),
        evidence,
    })
}

#[tauri::command]
pub(crate) fn desktop_macos_smoke_context_get() -> Result<DesktopMacosSmokeContextResult, String> {
    let Some(override_payload) = crate::desktop_e2e_fixture::macos_smoke_override()? else {
        return Ok(DesktopMacosSmokeContextResult {
            enabled: false,
            scenario_id: None,
            report_path: None,
            artifacts_dir: None,
            disable_runtime_bootstrap: false,
            bootstrap_timeout_ms: None,
        });
    };

    Ok(DesktopMacosSmokeContextResult {
        enabled: override_payload.enabled,
        scenario_id: normalize_optional(override_payload.scenario_id),
        report_path: normalize_optional(override_payload.report_path),
        artifacts_dir: normalize_optional(override_payload.artifacts_dir),
        disable_runtime_bootstrap: override_payload.disable_runtime_bootstrap.unwrap_or(false),
        bootstrap_timeout_ms: override_payload.bootstrap_timeout_ms,
    })
}

#[tauri::command]
pub(crate) fn desktop_macos_smoke_report_write(
    payload: DesktopMacosSmokeReportPayload,
) -> Result<DesktopMacosSmokeReportResult, String> {
    let override_payload = require_enabled_macos_smoke_override()?;

    let report_path = require_absolute_path(
        override_payload.report_path.as_deref().unwrap_or_default(),
        "reportPath",
    )?;
    let artifacts_dir = require_absolute_path(
        override_payload
            .artifacts_dir
            .as_deref()
            .unwrap_or_default(),
        "artifactsDir",
    )?;
    let scenario_id = normalize_optional(override_payload.scenario_id)
        .unwrap_or_else(|| "unknown-scenario".to_string());
    fs::create_dir_all(
        report_path
            .parent()
            .ok_or_else(|| "reportPath parent is missing".to_string())?,
    )
    .map_err(|error| format!("create report parent failed: {error}"))?;
    fs::create_dir_all(&artifacts_dir)
        .map_err(|error| format!("create artifactsDir failed: {error}"))?;

    let html_snapshot_path = payload
        .html_snapshot
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|html| -> Result<String, String> {
            let html_path = artifacts_dir.join(format!("{scenario_id}.dom.html"));
            fs::write(&html_path, html)
                .map_err(|error| format!("write html snapshot failed: {error}"))?;
            Ok(html_path.display().to_string())
        })
        .transpose()?;

    let fixture_manifest_path = crate::desktop_e2e_fixture::fixture_manifest_path();
    let report = json!({
        "generatedAt": chrono_like_now_iso(),
        "ok": payload.ok,
        "scenarioId": scenario_id,
        "steps": payload.steps,
        "failedStep": normalize_optional(payload.failed_step),
        "errorMessage": normalize_optional(payload.error_message),
        "errorName": normalize_optional(payload.error_name),
        "errorStack": normalize_optional(payload.error_stack),
        "errorCause": normalize_optional(payload.error_cause),
        "route": normalize_optional(payload.route),
        "htmlSnapshotPath": html_snapshot_path,
        "details": payload.details,
        "fixtureManifestPath": fixture_manifest_path,
        "failureSource": "renderer",
    });
    fs::write(
        &report_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| format!("write report failed: {error}"))?;

    Ok(DesktopMacosSmokeReportResult {
        report_path: report_path.display().to_string(),
        html_snapshot_path,
    })
}

#[tauri::command]
pub(crate) fn desktop_macos_smoke_ping(
    payload: DesktopMacosSmokePingPayload,
) -> Result<(), String> {
    append_macos_smoke_backend_stage(payload.stage.as_str(), payload.details.as_ref())
}

fn chrono_like_now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::{
        append_macos_smoke_backend_stage, desktop_macos_smoke_context_get,
        desktop_macos_smoke_report_write, DesktopMacosSmokeReportPayload,
    };
    use crate::test_support::test_guard;
    use serde_json::json;
    use std::{fs, path::PathBuf};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-desktop-macos-smoke-{}-{}",
            prefix,
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn desktop_macos_smoke_context_returns_disabled_without_fixture() {
        let _guard = test_guard();
        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::remove_var("NIMI_E2E_FIXTURE_PATH");
        let result = desktop_macos_smoke_context_get().expect("context");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert!(!result.enabled);
        assert!(result.report_path.is_none());
    }

    #[test]
    fn desktop_macos_smoke_context_reads_fixture_override() {
        let _guard = test_guard();
        let temp = make_temp_dir("context");
        let fixture_path = temp.join("fixture.json");
        fs::write(
            &fixture_path,
            format!(
                r#"{{
  "tauriFixture": {{
    "macosSmoke": {{
      "enabled": true,
      "scenarioId": "chat.memory-standard-bind",
      "reportPath": "{}",
      "artifactsDir": "{}",
      "disableRuntimeBootstrap": true,
      "bootstrapTimeoutMs": 90000
    }}
  }}
}}"#,
                temp.join("report.json").display(),
                temp.join("artifacts").display()
            ),
        )
        .expect("write fixture");

        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        let result = desktop_macos_smoke_context_get().expect("context");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert!(result.enabled);
        assert_eq!(
            result.scenario_id.as_deref(),
            Some("chat.memory-standard-bind")
        );
        assert!(result.report_path.is_some());
        assert!(result.artifacts_dir.is_some());
        assert!(result.disable_runtime_bootstrap);
        assert_eq!(result.bootstrap_timeout_ms, Some(90000));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn desktop_macos_smoke_report_write_persists_report_and_html_dump() {
        let _guard = test_guard();
        let temp = make_temp_dir("report");
        let report_path = temp.join("report.json");
        let artifacts_dir = temp.join("artifacts");
        let fixture_path = temp.join("fixture.json");
        fs::write(
            &fixture_path,
            format!(
                r#"{{
  "tauriFixture": {{
    "macosSmoke": {{
      "enabled": true,
      "scenarioId": "chat.memory-standard-bind",
      "reportPath": "{}",
      "artifactsDir": "{}"
    }}
  }}
}}"#,
                report_path.display(),
                artifacts_dir.display()
            ),
        )
        .expect("write fixture");

        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        let result = desktop_macos_smoke_report_write(DesktopMacosSmokeReportPayload {
            ok: true,
            failed_step: None,
            steps: vec!["open-chat".to_string(), "upgrade-memory".to_string()],
            error_message: None,
            error_name: None,
            error_stack: None,
            error_cause: None,
            route: Some("/chat".to_string()),
            html_snapshot: Some("<html>ok</html>".to_string()),
            details: Some(json!({
                "live2d": {
                    "framingMode": "full-body-tall"
                }
            })),
        })
        .expect("write report");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert_eq!(result.report_path, report_path.display().to_string());
        let report_raw = fs::read_to_string(&report_path).expect("read report");
        assert!(report_raw.contains("\"scenarioId\": \"chat.memory-standard-bind\""));
        assert!(report_raw.contains("\"fixtureManifestPath\""));
        assert!(report_raw.contains("\"failureSource\": \"renderer\""));
        assert!(report_raw.contains("\"details\""));
        let html_path = result
            .html_snapshot_path
            .expect("html snapshot path should be present");
        assert!(fs::read_to_string(html_path)
            .expect("read html")
            .contains("<html>ok</html>"));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn desktop_macos_smoke_report_write_rejects_relative_paths() {
        let _guard = test_guard();
        let temp = make_temp_dir("relative");
        let fixture_path = temp.join("fixture.json");
        fs::write(
            &fixture_path,
            r#"{
  "tauriFixture": {
    "macosSmoke": {
      "enabled": true,
      "scenarioId": "chat.memory-standard-bind",
      "reportPath": "relative/report.json",
      "artifactsDir": "relative/artifacts"
    }
  }
}"#,
        )
        .expect("write fixture");

        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        let err = desktop_macos_smoke_report_write(DesktopMacosSmokeReportPayload {
            ok: false,
            failed_step: Some("bootstrap".to_string()),
            steps: vec!["bootstrap".to_string()],
            error_message: Some("relative path".to_string()),
            error_name: None,
            error_stack: None,
            error_cause: None,
            route: Some("/chat".to_string()),
            html_snapshot: None,
            details: None,
        })
        .expect_err("relative path should fail");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert_eq!(err, "reportPath must be absolute");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn append_macos_smoke_backend_stage_rejects_when_smoke_is_disabled() {
        let _guard = test_guard();
        let previous = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        std::env::remove_var("NIMI_E2E_FIXTURE_PATH");
        let err = append_macos_smoke_backend_stage("renderer-root-mounted", None)
            .expect_err("disabled smoke should fail");
        match previous {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }

        assert_eq!(err, "desktop macOS smoke is not enabled");
    }

    #[test]
    fn append_macos_smoke_backend_stage_appends_to_backend_log() {
        let _guard = test_guard();
        let temp = make_temp_dir("ping");
        let fixture_path = temp.join("fixture.json");
        let backend_log_path = temp.join("backend.log");
        fs::write(
            &fixture_path,
            format!(
                r#"{{
  "tauriFixture": {{
    "macosSmoke": {{
      "enabled": true,
      "scenarioId": "chat.memory-standard-bind",
      "reportPath": "{}",
      "artifactsDir": "{}"
    }}
  }}
}}"#,
                temp.join("report.json").display(),
                temp.join("artifacts").display()
            ),
        )
        .expect("write fixture");

        let previous_fixture = std::env::var("NIMI_E2E_FIXTURE_PATH").ok();
        let previous_backend = std::env::var("NIMI_E2E_BACKEND_LOG_PATH").ok();
        std::env::set_var("NIMI_E2E_FIXTURE_PATH", fixture_path.as_os_str());
        std::env::set_var("NIMI_E2E_BACKEND_LOG_PATH", backend_log_path.as_os_str());
        append_macos_smoke_backend_stage(
            "renderer-root-mounted",
            Some(&json!({ "scenarioId": "chat.memory-standard-bind" })),
        )
        .expect("append stage");
        match previous_fixture {
            Some(value) => std::env::set_var("NIMI_E2E_FIXTURE_PATH", value),
            None => std::env::remove_var("NIMI_E2E_FIXTURE_PATH"),
        }
        match previous_backend {
            Some(value) => std::env::set_var("NIMI_E2E_BACKEND_LOG_PATH", value),
            None => std::env::remove_var("NIMI_E2E_BACKEND_LOG_PATH"),
        }

        let log_raw = fs::read_to_string(backend_log_path).expect("read backend log");
        assert!(log_raw.contains("macos_smoke_ping stage=renderer-root-mounted"));
        assert!(log_raw.contains("\"scenarioId\":\"chat.memory-standard-bind\""));
        let _ = fs::remove_dir_all(temp);
    }
}
