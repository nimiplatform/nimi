use std::path::Path;
use std::process::Command;

use super::ProbeResult;

fn spawn_probe_command(url: &str) -> Result<String, String> {
    let repo_root = crate::script_runner::repo_root()?;
    let command_path = crate::script_runner::best_command_path()?;
    let script_path =
        repo_root.join("apps/video-food-map/scripts/run-bilibili-food-video-probe.mts");
    let grpc_addr = crate::runtime_daemon::ensure_running()?;
    let settings_json = serde_json::to_string(
        &crate::settings::load_settings().unwrap_or_default(),
    )
    .map_err(|error| format!("failed to encode video-food-map settings for probe: {error}"))?;
    let output = Command::new(&command_path)
        .arg(script_path.as_os_str())
        .arg("--url")
        .arg(url)
        .current_dir(&repo_root)
        .env("PATH", crate::script_runner::normalize_path_env())
        .env("NIMI_RUNTIME_GRPC_ADDR", grpc_addr)
        .env("NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON", settings_json)
        .output()
        .map_err(|error| format!("failed to start probe command: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "probe command failed with status {}.\nstdout={}\nstderr={}",
            output.status,
            stdout.trim(),
            stderr.trim(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn run_probe(url: &str) -> Result<ProbeResult, String> {
    let stdout = spawn_probe_command(url)?;
    serde_json::from_str::<ProbeResult>(&stdout)
        .map_err(|error| format!("probe returned invalid json: {error}"))
}

pub fn path_display(path: &Path) -> String {
    path.display().to_string()
}
