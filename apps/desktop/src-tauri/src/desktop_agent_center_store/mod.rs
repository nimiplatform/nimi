mod resources;
mod store;
mod types;

pub(crate) use resources::*;
pub(crate) use store::*;

pub(crate) async fn run_agent_center_resource_blocking<T, F>(
    operation: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{operation} background worker failed: {error}"))?
}

pub(crate) async fn active_agent_center_account_id() -> Result<String, String> {
    crate::desktop_product_control::authenticated_runtime_account_id().await
}
