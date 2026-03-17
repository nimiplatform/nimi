use crate::local_runtime::device_profile::collect_device_profile_from_env;
use crate::local_runtime::service_artifacts::find_service_artifact;
use crate::local_runtime::service_lifecycle::preflight_service_artifact;
use crate::local_runtime::types::LocalAiServiceArtifact;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(test)]
use super::normalize_engine;
use super::{
    qwen_process_registry, with_model_operation_lock, EngineAdapter, EngineHealthResult,
    LlamaCppProcessAdapter, LocalAiModelRecord, LocalAiModelStatus, QWEN_TTS_GATEWAY_SCRIPT_NAME,
    QWEN_TTS_GATEWAY_TEMPLATE, QWEN_TTS_HEALTH_POLL_INTERVAL_MS, QWEN_TTS_START_TIMEOUT_MS_DEFAULT,
    QWEN_TTS_STOP_GRACE_MS_DEFAULT, QWEN_TTS_VENV_DIR_NAME,
};

pub(super) struct QwenTtsPythonAdapter;

impl QwenTtsPythonAdapter {
    fn parse_python_version(raw: &str) -> Option<(u32, u32, u32)> {
        let normalized = raw.trim().replace('\n', " ");
        let version = normalized
            .split_whitespace()
            .find(|item| item.chars().filter(|ch| *ch == '.').count() >= 2)
            .unwrap_or_default();
        let mut parts = version.split('.').collect::<Vec<_>>();
        if parts.len() < 3 {
            return None;
        }
        parts.truncate(3);
        let major = parts[0].parse::<u32>().ok()?;
        let minor = parts[1].parse::<u32>().ok()?;
        let patch = parts[2]
            .chars()
            .take_while(|ch| ch.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok()?;
        Some((major, minor, patch))
    }

    fn resolve_python_binary() -> Result<String, String> {
        let mut candidates = Vec::<String>::new();
        let env_candidate = std::env::var("NIMI_QWEN_PYTHON_BIN")
            .ok()
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if !env_candidate.is_empty() {
            candidates.push(env_candidate);
        }
        candidates.push("python3".to_string());
        candidates.push("python".to_string());

        for candidate in candidates {
            let output = Command::new(candidate.as_str())
                .arg("--version")
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output();
            let Ok(output) = output else {
                continue;
            };
            if !output.status.success() {
                continue;
            }
            let version_text = String::from_utf8_lossy(&output.stdout).to_string()
                + String::from_utf8_lossy(&output.stderr).as_ref();
            let Some((major, minor, _patch)) = Self::parse_python_version(version_text.as_str())
            else {
                continue;
            };
            if major > 3 || (major == 3 && minor >= 10) {
                return Ok(candidate);
            }
            return Err(format!(
                "LOCAL_AI_QWEN_PYTHON_VERSION_UNSUPPORTED: Python >= 3.10 required, detected {}.{}",
                major, minor
            ));
        }
        Err("LOCAL_AI_QWEN_PYTHON_REQUIRED: Python 3.10+ is required".to_string())
    }

    pub(super) fn preflight(endpoint: &str) -> Result<String, String> {
        let profile = collect_device_profile_from_env();
        let decisions =
            preflight_service_artifact(None, "qwen-tts-python", Some(endpoint), &profile)?;
        if let Some(failed) = decisions.iter().find(|item| !item.ok) {
            return Err(format!("{}: {}", failed.reason_code, failed.detail));
        }
        let python_binary = Self::resolve_python_binary()?;
        Ok(python_binary)
    }

    fn start_timeout() -> Duration {
        let timeout_ms = std::env::var("NIMI_QWEN_TTS_START_TIMEOUT_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(QWEN_TTS_START_TIMEOUT_MS_DEFAULT)
            .clamp(10_000, 300_000);
        Duration::from_millis(timeout_ms)
    }

    fn stop_grace_timeout() -> Duration {
        let timeout_ms = std::env::var("NIMI_QWEN_TTS_STOP_GRACE_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(QWEN_TTS_STOP_GRACE_MS_DEFAULT)
            .clamp(500, 30_000);
        Duration::from_millis(timeout_ms)
    }

    fn health_probe_endpoint(endpoint: &str) -> Option<String> {
        let normalized = endpoint.trim().trim_end_matches('/');
        if normalized.is_empty() {
            return None;
        }
        if normalized.ends_with("/v1/catalog") {
            return Some(normalized.to_string());
        }
        if normalized.ends_with("/v1/models") {
            return Some(format!("{}{}", normalized.trim_end_matches("/v1/models"), "/v1/catalog"));
        }
        if normalized.ends_with("/v1") {
            return Some(format!("{normalized}/catalog"));
        }
        if normalized.ends_with("/catalog") {
            return Some(normalized.to_string());
        }
        Some(format!("{normalized}/v1/catalog"))
    }

    fn wait_for_endpoint_ready(endpoint: &str, timeout: Duration) -> Result<(), String> {
        let health_url = Self::health_probe_endpoint(endpoint)
            .ok_or_else(|| "LOCAL_AI_QWEN_ENDPOINT_INVALID: qwen endpoint is empty".to_string())?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|error| {
                format!(
                    "LOCAL_AI_ENGINE_HTTP_CLIENT_FAILED: failed to create health client: {error}"
                )
            })?;
        let deadline = Instant::now() + timeout;
        loop {
            let last_error = match client.get(&health_url).send() {
                Ok(response) if response.status().is_success() => {
                    return Ok(());
                }
                Ok(response) => format!("status={}", response.status().as_u16()),
                Err(error) => error.to_string(),
            };
            if Instant::now() >= deadline {
                return Err(format!(
                    "LOCAL_AI_ENGINE_START_TIMEOUT: qwen-tts-python health check timed out after {} ms ({health_url}): {}",
                    timeout.as_millis(),
                    last_error
                ));
            }
            std::thread::sleep(Duration::from_millis(QWEN_TTS_HEALTH_POLL_INTERVAL_MS));
        }
    }

    fn parse_endpoint_host_port(endpoint: &str) -> Result<(String, u16), String> {
        let parsed = reqwest::Url::parse(endpoint).map_err(|error| {
            format!("LOCAL_AI_QWEN_ENDPOINT_INVALID: invalid endpoint URL: {error}")
        })?;
        let host = parsed
            .host_str()
            .ok_or_else(|| "LOCAL_AI_QWEN_ENDPOINT_INVALID: endpoint host missing".to_string())?
            .to_string();
        if host != "127.0.0.1" && host != "localhost" && host != "::1" {
            return Err(format!(
                "LOCAL_AI_QWEN_ENDPOINT_NOT_LOOPBACK: endpoint host must be loopback: {host}"
            ));
        }
        let port = parsed.port_or_known_default().ok_or_else(|| {
            "LOCAL_AI_QWEN_ENDPOINT_INVALID: endpoint port is missing".to_string()
        })?;
        Ok((host, port))
    }

    fn runtime_root_path() -> Result<std::path::PathBuf, String> {
        let value = std::env::var("NIMI_LOCAL_AI_RUNTIME_ROOT")
            .ok()
            .map(|item| item.trim().to_string())
            .unwrap_or_default();
        if value.is_empty() {
            return Err(
                "LOCAL_AI_QWEN_RUNTIME_ROOT_MISSING: NIMI_LOCAL_AI_RUNTIME_ROOT is not configured"
                    .to_string(),
            );
        }
        Ok(std::path::PathBuf::from(value))
    }

    fn models_root_path() -> Result<std::path::PathBuf, String> {
        let value = std::env::var("NIMI_LOCAL_AI_MODELS_DIR")
            .ok()
            .map(|item| item.trim().to_string())
            .unwrap_or_default();
        if value.is_empty() {
            return Err(
                "LOCAL_AI_QWEN_MODELS_ROOT_MISSING: NIMI_LOCAL_AI_MODELS_DIR is not configured"
                    .to_string(),
            );
        }
        Ok(std::path::PathBuf::from(value))
    }

    fn model_install_dir(model: &LocalAiModelRecord) -> Result<std::path::PathBuf, String> {
        let models_root = Self::models_root_path()?;
        Ok(models_root.join(model.local_model_id.replace(':', "-")))
    }

    fn ensure_gateway_script() -> Result<std::path::PathBuf, String> {
        let runtime_root = Self::runtime_root_path()?;
        let script_path = runtime_root.join(QWEN_TTS_GATEWAY_SCRIPT_NAME);
        let write_required = match fs::read_to_string(&script_path) {
            Ok(current) => current != QWEN_TTS_GATEWAY_TEMPLATE,
            Err(_) => true,
        };
        if write_required {
            fs::write(&script_path, QWEN_TTS_GATEWAY_TEMPLATE).map_err(|error| {
                format!(
                    "LOCAL_AI_QWEN_BOOTSTRAP_FAILED: failed to write qwen gateway script ({}): {error}",
                    script_path.display()
                )
            })?;
        }
        Ok(script_path)
    }

    fn run_command(
        binary: &Path,
        args: &[&str],
        cwd: Option<&Path>,
        error_code: &str,
    ) -> Result<(), String> {
        let mut command = Command::new(binary);
        command.args(args);
        if let Some(path) = cwd {
            command.current_dir(path);
        }
        let output = command
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("{error_code}: failed to execute command: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(format!("{error_code}: {detail}"))
    }

    fn qwen_process_artifact() -> Result<LocalAiServiceArtifact, String> {
        find_service_artifact("qwen-tts-python").ok_or_else(|| {
            "LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId=qwen-tts-python".to_string()
        })
    }

    fn qwen_requirements_from_artifact() -> Result<Vec<String>, String> {
        let artifact = Self::qwen_process_artifact()?;
        let requirements = artifact
            .install
            .requirements
            .into_iter()
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect::<Vec<_>>();
        if requirements.is_empty() {
            return Err(
                "LOCAL_AI_SERVICE_ARTIFACT_REQUIREMENTS_EMPTY: serviceId=qwen-tts-python"
                    .to_string(),
            );
        }
        Ok(requirements)
    }

    fn resolve_qwen_process_args(
        artifact: &LocalAiServiceArtifact,
        script_path: &Path,
        host: &str,
        port: u16,
        model_dir: &Path,
        model_id: &str,
    ) -> Result<Vec<String>, String> {
        if artifact.process.args.is_empty() {
            return Err(
                "LOCAL_AI_SERVICE_PROCESS_ARGS_EMPTY: serviceId=qwen-tts-python".to_string(),
            );
        }
        let port_value = port.to_string();
        let script_value = script_path.to_string_lossy().to_string();
        let model_dir_value = model_dir.to_string_lossy().to_string();
        let args = artifact
            .process
            .args
            .iter()
            .map(|arg| {
                arg.replace("${GATEWAY_SCRIPT}", script_value.as_str())
                    .replace("${HOST}", host)
                    .replace("${PORT}", port_value.as_str())
                    .replace("${MODEL_DIR}", model_dir_value.as_str())
                    .replace("${MODEL_ID}", model_id)
            })
            .collect::<Vec<_>>();
        Ok(args)
    }

    fn bootstrap_venv(python_binary: &str) -> Result<std::path::PathBuf, String> {
        let runtime_root = Self::runtime_root_path()?;
        let venv_root = runtime_root.join(QWEN_TTS_VENV_DIR_NAME);
        if !venv_root.exists() {
            fs::create_dir_all(&venv_root).map_err(|error| {
                format!(
                    "LOCAL_AI_QWEN_BOOTSTRAP_FAILED: failed to create venv root ({}): {error}",
                    venv_root.display()
                )
            })?;
        }
        #[cfg(target_os = "windows")]
        let venv_python = venv_root.join(".venv").join("Scripts").join("python.exe");
        #[cfg(not(target_os = "windows"))]
        let venv_python = venv_root.join(".venv").join("bin").join("python");

        if !venv_python.exists() {
            Self::run_command(
                Path::new(python_binary),
                &["-m", "venv", ".venv"],
                Some(venv_root.as_path()),
                "LOCAL_AI_QWEN_BOOTSTRAP_FAILED",
            )?;
        }

        let skip_bootstrap = matches!(
            std::env::var("NIMI_QWEN_SKIP_BOOTSTRAP").ok().as_deref(),
            Some("1" | "true" | "TRUE")
        );
        if !skip_bootstrap {
            let requirements = Self::qwen_requirements_from_artifact()?;
            Self::run_command(
                venv_python.as_path(),
                &["-m", "pip", "install", "--upgrade", "pip"],
                Some(venv_root.as_path()),
                "LOCAL_AI_QWEN_BOOTSTRAP_FAILED",
            )?;
            let mut install_requirements_args =
                vec!["-m".to_string(), "pip".to_string(), "install".to_string()];
            install_requirements_args.extend(requirements);
            let install_requirements_refs = install_requirements_args
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            Self::run_command(
                venv_python.as_path(),
                install_requirements_refs.as_slice(),
                Some(venv_root.as_path()),
                "LOCAL_AI_QWEN_BOOTSTRAP_FAILED",
            )?;
        }

        Ok(venv_python)
    }

    fn process_running(model: &LocalAiModelRecord) -> Result<bool, String> {
        with_model_operation_lock(model.local_model_id.as_str(), || {
            let mut registry = qwen_process_registry()
                .lock()
                .map_err(|_| "qwen process registry lock poisoned".to_string())?;
            if let Some(child) = registry.get_mut(&model.local_model_id) {
                match child.try_wait() {
                    Ok(None) => return Ok(true),
                    Ok(Some(_)) => {
                        registry.remove(&model.local_model_id);
                        return Ok(false);
                    }
                    Err(error) => {
                        registry.remove(&model.local_model_id);
                        return Err(format!("qwen process check failed: {error}"));
                    }
                }
            }
            Ok(false)
        })
    }

    fn stop_process(model: &LocalAiModelRecord) -> Result<bool, String> {
        with_model_operation_lock(model.local_model_id.as_str(), || {
            let mut registry = qwen_process_registry()
                .lock()
                .map_err(|_| "qwen process registry lock poisoned".to_string())?;
            let mut child = match registry.remove(&model.local_model_id) {
                Some(value) => value,
                None => return Ok(false),
            };
            LlamaCppProcessAdapter::shutdown_child_process(&mut child, Self::stop_grace_timeout());
            Ok(true)
        })
    }

    fn start_process(model: &LocalAiModelRecord) -> Result<(), String> {
        with_model_operation_lock(model.local_model_id.as_str(), || {
            let python_binary = Self::preflight(model.endpoint.as_str())?;
            let model_dir = Self::model_install_dir(model)?;
            if !model_dir.exists() {
                return Err(format!(
                    "LOCAL_AI_QWEN_MODEL_DIR_MISSING: model directory is missing: {}",
                    model_dir.display()
                ));
            }
            if !model.entry.trim().is_empty() {
                let entry_path = model_dir.join(model.entry.trim());
                if !entry_path.exists() {
                    return Err(format!(
                        "LOCAL_AI_QWEN_MODEL_ENTRY_MISSING: model entry is missing: {}",
                        entry_path.display()
                    ));
                }
            }

            let script_path = Self::ensure_gateway_script()?;
            let venv_python = Self::bootstrap_venv(python_binary.as_str())?;
            let (host, port) = Self::parse_endpoint_host_port(model.endpoint.as_str())?;
            let artifact = Self::qwen_process_artifact()?;
            let spawn_args = Self::resolve_qwen_process_args(
                &artifact,
                script_path.as_path(),
                host.as_str(),
                port,
                model_dir.as_path(),
                model.model_id.as_str(),
            )?;
            let mut command = Command::new(venv_python.as_path());
            command.args(spawn_args.iter().map(String::as_str));
            for (key, value) in artifact.process.env {
                command.env(key, value);
            }

            let child = command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| {
                    format!("LOCAL_AI_QWEN_BOOTSTRAP_FAILED: failed to spawn qwen gateway: {error}")
                })?;

            let mut registry = qwen_process_registry()
                .lock()
                .map_err(|_| "qwen process registry lock poisoned".to_string())?;
            registry.insert(model.local_model_id.clone(), child);
            drop(registry);

            if let Err(error) =
                Self::wait_for_endpoint_ready(model.endpoint.as_str(), Self::start_timeout())
            {
                let mut registry = qwen_process_registry()
                    .lock()
                    .map_err(|_| "qwen process registry lock poisoned".to_string())?;
                if let Some(mut child) = registry.remove(&model.local_model_id) {
                    LlamaCppProcessAdapter::shutdown_child_process(
                        &mut child,
                        Self::stop_grace_timeout(),
                    );
                }
                return Err(error);
            }

            Ok(())
        })
    }
}

#[cfg(test)]
pub(super) fn preflight_engine_install_with<F>(
    engine: &str,
    qwen_preflight: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    if normalize_engine(engine) != "qwen-tts-python" {
        return Ok(());
    }
    qwen_preflight()
}

impl EngineAdapter for QwenTtsPythonAdapter {
    fn start(&self, model: &LocalAiModelRecord) -> EngineHealthResult {
        match Self::process_running(model) {
            Ok(true) => EngineHealthResult {
                healthy: true,
                detail: "qwen-tts-python already running".to_string(),
                status: LocalAiModelStatus::Active,
            },
            Ok(false) => match Self::start_process(model) {
                Ok(()) => EngineHealthResult {
                    healthy: true,
                    detail: "qwen-tts-python started".to_string(),
                    status: LocalAiModelStatus::Active,
                },
                Err(error) => EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiModelStatus::Unhealthy,
                },
            },
            Err(error) => EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiModelStatus::Unhealthy,
            },
        }
    }

    fn stop(&self, model: &LocalAiModelRecord) -> EngineHealthResult {
        match Self::stop_process(model) {
            Ok(true) => EngineHealthResult {
                healthy: true,
                detail: "qwen-tts-python stop requested".to_string(),
                status: LocalAiModelStatus::Installed,
            },
            Ok(false) => EngineHealthResult {
                healthy: true,
                detail: "qwen-tts-python process not running".to_string(),
                status: LocalAiModelStatus::Installed,
            },
            Err(error) => EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiModelStatus::Unhealthy,
            },
        }
    }

    fn health(&self, model: &LocalAiModelRecord) -> EngineHealthResult {
        match Self::process_running(model) {
            Ok(true) => EngineHealthResult {
                healthy: true,
                detail: "qwen-tts-python running".to_string(),
                status: LocalAiModelStatus::Active,
            },
            Ok(false) => {
                if model.status == LocalAiModelStatus::Active {
                    EngineHealthResult {
                        healthy: false,
                        detail: "qwen-tts-python process exited unexpectedly".to_string(),
                        status: LocalAiModelStatus::Unhealthy,
                    }
                } else {
                    EngineHealthResult {
                        healthy: true,
                        detail: "qwen-tts-python ready (not started)".to_string(),
                        status: LocalAiModelStatus::Installed,
                    }
                }
            }
            Err(error) => EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiModelStatus::Unhealthy,
            },
        }
    }
}
