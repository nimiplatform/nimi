use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AgentCenterHostError {
    InvalidPayload(String),
    InvalidPath(String),
    HostInternal(String),
}

pub(crate) type AgentCenterHostResult<T> = Result<T, AgentCenterHostError>;

impl AgentCenterHostError {
    pub(crate) fn render(self, operation: &str) -> String {
        let (code, reason_code, cause) = match self {
            Self::InvalidPayload(cause) => (
                "invalid-payload",
                "tauri-agent-center-payload-invalid",
                cause,
            ),
            Self::InvalidPath(cause) => ("invalid-path", "tauri-agent-center-path-invalid", cause),
            Self::HostInternal(cause) => (
                "host-internal-error",
                "tauri-agent-center-host-operation-failed",
                cause,
            ),
        };
        crate::capabilities::standard_shell_error(
            code,
            reason_code,
            "inspect_agent_center_host_operation",
            "tauri",
            Some(serde_json::json!({
                "command": operation,
                "cause": cause,
            })),
        )
    }
}

async fn run_material_selection<T, F>(operation: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> AgentCenterHostResult<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(task).await {
        Ok(result) => result.map_err(|error| error.render(operation)),
        Err(error) => Err(crate::capabilities::standard_shell_error(
            "host-internal-error",
            "tauri-agent-center-blocking-task-failed",
            "inspect_agent_center_host_operation",
            "tauri",
            Some(serde_json::json!({
                "command": operation,
                "cause": error.to_string(),
            })),
        )),
    }
}

pub(crate) async fn avatar_material_select(
    payload: StandardAgentCenterAvatarMaterialSelectPayload,
    selected_path: PathBuf,
) -> Result<StandardAgentCenterAvatarMaterialSelectResult, String> {
    run_material_selection("agent_center_avatar_asset_import", move || {
        standard_agent_center_avatar_material_select_blocking(payload, selected_path)
    })
    .await
}

pub(crate) async fn background_material_select(
    payload: StandardAgentCenterBackgroundMaterialSelectPayload,
    selected_path: PathBuf,
) -> Result<StandardAgentCenterBackgroundMaterialSelectResult, String> {
    run_material_selection("agent_center_background_import", move || {
        standard_agent_center_background_material_select_blocking(payload, selected_path)
    })
    .await
}
