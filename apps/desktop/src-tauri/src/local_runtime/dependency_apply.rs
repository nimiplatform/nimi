use super::service_lifecycle::preflight_dependency;
use super::types::{
    LocalAiDependencyApplyStageResult, LocalAiDependencyDescriptor, LocalAiDeviceProfile,
    LocalAiPreflightDecision,
};

#[derive(Debug, Clone)]
pub struct DependencyApplyProgress {
    pub stage_results: Vec<LocalAiDependencyApplyStageResult>,
    pub preflight_decisions: Vec<LocalAiPreflightDecision>,
}

impl DependencyApplyProgress {
    pub fn new() -> Self {
        Self {
            stage_results: Vec::new(),
            preflight_decisions: Vec::new(),
        }
    }

    pub fn push_stage_ok(&mut self, stage: &str, detail: Option<String>) {
        self.stage_results.push(LocalAiDependencyApplyStageResult {
            stage: stage.to_string(),
            ok: true,
            reason_code: None,
            detail,
        });
    }

    pub fn push_stage_failed(&mut self, stage: &str, reason_code: String, detail: String) {
        self.stage_results.push(LocalAiDependencyApplyStageResult {
            stage: stage.to_string(),
            ok: false,
            reason_code: Some(reason_code),
            detail: Some(detail),
        });
    }
}

fn extract_reason_code(error: &str) -> String {
    error
        .split(':')
        .next()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "LOCAL_AI_DEPENDENCY_APPLY_FAILED".to_string())
}

pub fn run_preflight_all(
    selected_dependencies: &[LocalAiDependencyDescriptor],
    device_profile: &LocalAiDeviceProfile,
) -> Result<Vec<LocalAiPreflightDecision>, String> {
    let mut decisions = Vec::<LocalAiPreflightDecision>::new();
    for dependency in selected_dependencies {
        let rows = preflight_dependency(
            Some(dependency.dependency_id.as_str()),
            &dependency.kind,
            dependency.service_id.as_deref(),
            dependency.engine.as_deref(),
            dependency.node_id.as_deref(),
            dependency.workflow_id.as_deref(),
            device_profile,
        )?;
        if rows.iter().any(|item| !item.ok) {
            let failed = rows
                .iter()
                .find(|item| !item.ok)
                .cloned()
                .unwrap_or(LocalAiPreflightDecision {
                    dependency_id: Some(dependency.dependency_id.clone()),
                    target: "dependency".to_string(),
                    check: "unknown".to_string(),
                    ok: false,
                    reason_code: "LOCAL_AI_DEPENDENCY_PREFLIGHT_FAILED".to_string(),
                    detail: "preflight failed".to_string(),
                });
            let reason = failed.reason_code;
            let detail = failed.detail;
            return Err(format!("{reason}: {detail}"));
        }
        decisions.extend(rows);
    }
    Ok(decisions)
}

pub fn fail_progress(
    progress: &mut DependencyApplyProgress,
    stage: &str,
    error: String,
) -> String {
    let reason_code = extract_reason_code(error.as_str());
    progress.push_stage_failed(stage, reason_code, error.clone());
    error
}

pub fn mark_capability_matrix_refresh(
    progress: &mut DependencyApplyProgress,
    refreshed_entries: usize,
) {
    progress.push_stage_ok(
        "capability-matrix-refresh",
        Some(format!("entries={refreshed_entries}")),
    );
}
