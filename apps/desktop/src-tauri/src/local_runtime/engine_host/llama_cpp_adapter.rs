use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use super::{
    process_registry, shared_engine_health_http_client, with_asset_operation_lock, EngineAdapter,
    EngineHealthResult, LLAMA_CPP_HEALTH_POLL_INTERVAL_MS, LLAMA_CPP_START_TIMEOUT_MS_DEFAULT,
    LLAMA_CPP_STOP_GRACE_MS_DEFAULT,
};
use crate::local_runtime::engine_pack::{
    ensure_llama_cpp_binary, resolve_existing_llama_cpp_binary,
};
use crate::local_runtime::types::{resolved_model_dir, LocalAiAssetRecord, LocalAiAssetStatus};

pub(super) struct LlamaCppProcessAdapter;

impl LlamaCppProcessAdapter {
    fn models_root_path() -> Result<PathBuf, String> {
        let value = std::env::var("NIMI_LOCAL_AI_MODELS_DIR")
            .ok()
            .map(|item| item.trim().to_string())
            .unwrap_or_default();
        if value.is_empty() {
            return Err(
                "LOCAL_AI_LLAMA_MODELS_ROOT_MISSING: NIMI_LOCAL_AI_MODELS_DIR is not configured"
                    .to_string(),
            );
        }
        Ok(PathBuf::from(value))
    }

    fn runnable_asset_entry_path(model: &LocalAiAssetRecord) -> Result<PathBuf, String> {
        let entry = model.entry.trim();
        if entry.is_empty() {
            return Err(
                "LOCAL_AI_ENGINE_MODEL_ENTRY_REQUIRED: llama.cpp model entry is empty".to_string(),
            );
        }
        let entry_path = PathBuf::from(entry);
        if entry_path.is_absolute() {
            return Ok(entry_path);
        }
        let models_root = Self::models_root_path()?;
        let model_dir = resolved_model_dir(models_root.as_path(), model.logical_model_id.as_str());
        Ok(model_dir.join(entry_path))
    }

    fn configured_mmproj_path(model: &LocalAiAssetRecord) -> Result<Option<PathBuf>, String> {
        let mmproj = model
            .engine_config
            .as_ref()
            .and_then(|value| value.as_object())
            .and_then(|engine_config| engine_config.get("llama"))
            .and_then(|value| value.as_object())
            .and_then(|llama| llama.get("mmproj"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(mmproj) = mmproj else {
            return Ok(None);
        };

        let models_root = Self::models_root_path()?;
        let candidate = {
            let path = PathBuf::from(mmproj.as_str());
            if path.is_absolute() {
                path
            } else {
                models_root.join(path)
            }
        };
        if !candidate.exists() || !candidate.is_file() {
            return Err(format!(
                "LOCAL_AI_ENGINE_MMPROJ_MISSING: configured mmproj file does not exist: {}",
                candidate.display()
            ));
        }
        let canonical_models_root = models_root.canonicalize().map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_MODELS_ROOT_RESOLVE_FAILED: cannot resolve models root: {error}"
            )
        })?;
        let canonical_candidate = candidate.canonicalize().map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_MMPROJ_RESOLVE_FAILED: cannot resolve mmproj path {}: {error}",
                candidate.display()
            )
        })?;
        if !canonical_candidate.starts_with(&canonical_models_root) {
            return Err(format!(
                "LOCAL_AI_ENGINE_MMPROJ_OUTSIDE_MODELS_ROOT: configured mmproj path must stay under runtime models root: {}",
                canonical_candidate.display()
            ));
        }
        Ok(Some(canonical_candidate))
    }

    fn parse_endpoint_bind(endpoint: &str) -> Result<(String, u16), String> {
        let parsed = reqwest::Url::parse(endpoint.trim()).map_err(|error| {
            format!("LOCAL_AI_ENGINE_ENDPOINT_INVALID: invalid llama.cpp endpoint: {error}")
        })?;
        let host = parsed.host_str().ok_or_else(|| {
            "LOCAL_AI_ENGINE_ENDPOINT_INVALID: endpoint host is missing".to_string()
        })?;
        let port = parsed.port_or_known_default().ok_or_else(|| {
            "LOCAL_AI_ENGINE_ENDPOINT_INVALID: endpoint port is missing".to_string()
        })?;
        Ok((host.to_string(), port))
    }

    pub(super) fn start_args(model: &LocalAiAssetRecord) -> Result<Vec<String>, String> {
        let mut args = Self::parse_extra_args();
        if !args.iter().any(|item| item == "--model") {
            args.push("--model".to_string());
            args.push(
                Self::runnable_asset_entry_path(model)?
                    .to_string_lossy()
                    .to_string(),
            );
        }
        if !args.iter().any(|item| item == "--host") || !args.iter().any(|item| item == "--port") {
            let (host, port) = Self::parse_endpoint_bind(model.endpoint.as_str())?;
            if !args.iter().any(|item| item == "--host") {
                args.push("--host".to_string());
                args.push(host);
            }
            if !args.iter().any(|item| item == "--port") {
                args.push("--port".to_string());
                args.push(port.to_string());
            }
        }
        if !args.iter().any(|item| item == "--mmproj") {
            if let Some(mmproj_path) = Self::configured_mmproj_path(model)? {
                args.push("--mmproj".to_string());
                args.push(mmproj_path.to_string_lossy().to_string());
            }
        }
        Ok(args)
    }

    pub(super) fn resolve_binary_path() -> Result<String, String> {
        let override_path = std::env::var("NIMI_LLAMA_CPP_BIN")
            .ok()
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if !override_path.is_empty() {
            if Path::new(&override_path).exists() {
                return Ok(override_path);
            }
            return Err(format!(
                "LOCAL_AI_ENGINE_PACK_OVERRIDE_NOT_FOUND: override binary not found: {override_path}"
            ));
        }

        let bootstrap = ensure_llama_cpp_binary()?;
        std::env::set_var("NIMI_LLAMA_CPP_BIN", bootstrap.binary_path.clone());
        Ok(bootstrap.binary_path)
    }

    pub(super) fn resolve_existing_binary_path() -> Result<Option<String>, String> {
        resolve_existing_llama_cpp_binary()
    }

    fn parse_extra_args() -> Vec<String> {
        std::env::var("NIMI_LLAMA_CPP_ARGS")
            .ok()
            .map(|value| {
                value
                    .split_whitespace()
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    }

    fn start_timeout() -> Duration {
        let timeout_ms = std::env::var("NIMI_LLAMA_CPP_START_TIMEOUT_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(LLAMA_CPP_START_TIMEOUT_MS_DEFAULT)
            .clamp(5_000, 180_000);
        Duration::from_millis(timeout_ms)
    }

    fn stop_grace_timeout() -> Duration {
        let timeout_ms = std::env::var("NIMI_LLAMA_CPP_STOP_GRACE_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .unwrap_or(LLAMA_CPP_STOP_GRACE_MS_DEFAULT)
            .clamp(500, 30_000);
        Duration::from_millis(timeout_ms)
    }

    fn health_probe_endpoint(endpoint: &str) -> Option<String> {
        let normalized = endpoint.trim().trim_end_matches('/');
        if normalized.is_empty() {
            return None;
        }
        if normalized.ends_with("/v1/models") {
            return Some(normalized.to_string());
        }
        if normalized.ends_with("/v1") {
            return Some(format!("{normalized}/models"));
        }
        if normalized.ends_with("/models") {
            return Some(normalized.to_string());
        }
        Some(format!("{normalized}/v1/models"))
    }

    fn wait_for_endpoint_ready(endpoint: &str, timeout: Duration) -> Result<(), String> {
        let health_url = Self::health_probe_endpoint(endpoint).ok_or_else(|| {
            "LOCAL_AI_ENGINE_ENDPOINT_INVALID: llama.cpp endpoint is empty".to_string()
        })?;
        let client = shared_engine_health_http_client()?;
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
                    "LOCAL_AI_ENGINE_START_TIMEOUT: llama.cpp health check timed out after {} ms ({health_url}): {}",
                    timeout.as_millis(),
                    last_error
                ));
            }
            thread::sleep(Duration::from_millis(LLAMA_CPP_HEALTH_POLL_INTERVAL_MS));
        }
    }

    pub(super) fn probe_endpoint(endpoint: &str) -> Result<(), String> {
        let health_url = Self::health_probe_endpoint(endpoint).ok_or_else(|| {
            "LOCAL_AI_ENGINE_ENDPOINT_INVALID: llama.cpp endpoint is empty".to_string()
        })?;
        let client = shared_engine_health_http_client()?;
        match client.get(&health_url).send() {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => Err(format!(
                "LOCAL_AI_ENGINE_ENDPOINT_UNREACHABLE: status={} endpoint={health_url}",
                response.status().as_u16()
            )),
            Err(error) => Err(format!(
                "LOCAL_AI_ENGINE_ENDPOINT_UNREACHABLE: endpoint={health_url} error={error}"
            )),
        }
    }

    #[cfg(unix)]
    fn send_terminate_signal(child: &Child) {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(child.id().to_string())
            .status();
    }

    #[cfg(not(unix))]
    fn send_terminate_signal(_child: &Child) {}

    fn wait_for_exit(child: &mut Child, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return true,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        return false;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => return false,
            }
        }
    }

    pub(super) fn shutdown_child_process(child: &mut Child, grace_timeout: Duration) {
        Self::send_terminate_signal(child);
        if Self::wait_for_exit(child, grace_timeout) {
            return;
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    fn start_process(model: &LocalAiAssetRecord) -> Result<(), String> {
        with_asset_operation_lock(model.local_asset_id.as_str(), || {
            let binary = Self::resolve_binary_path()?;
            if !Path::new(&binary).exists() {
                return Err(format!("llama.cpp binary not found: {binary}"));
            }
            let args = Self::start_args(model)?;

            let child = Command::new(&binary)
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| format!("llama.cpp spawn failed: {error}"))?;

            let mut registry = process_registry()
                .lock()
                .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
            registry.insert(model.local_asset_id.clone(), child);
            drop(registry);

            if let Err(error) =
                Self::wait_for_endpoint_ready(model.endpoint.as_str(), Self::start_timeout())
            {
                let mut registry = process_registry()
                    .lock()
                    .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
                if let Some(mut child) = registry.remove(&model.local_asset_id) {
                    Self::shutdown_child_process(&mut child, Self::stop_grace_timeout());
                }
                return Err(error);
            }

            Ok(())
        })
    }

    pub(super) fn process_running(model: &LocalAiAssetRecord) -> Result<bool, String> {
        with_asset_operation_lock(model.local_asset_id.as_str(), || {
            let mut registry = process_registry()
                .lock()
                .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
            if let Some(child) = registry.get_mut(&model.local_asset_id) {
                match child.try_wait() {
                    Ok(None) => return Ok(true),
                    Ok(Some(_)) => {
                        registry.remove(&model.local_asset_id);
                        return Ok(false);
                    }
                    Err(error) => {
                        registry.remove(&model.local_asset_id);
                        return Err(format!("llama.cpp process check failed: {error}"));
                    }
                }
            }
            Ok(false)
        })
    }

    fn stop_process(model: &LocalAiAssetRecord) -> Result<bool, String> {
        with_asset_operation_lock(model.local_asset_id.as_str(), || {
            let mut registry = process_registry()
                .lock()
                .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
            let mut child = match registry.remove(&model.local_asset_id) {
                Some(value) => value,
                None => return Ok(false),
            };
            Self::shutdown_child_process(&mut child, Self::stop_grace_timeout());
            Ok(true)
        })
    }
}

impl EngineAdapter for LlamaCppProcessAdapter {
    fn start(&self, model: &LocalAiAssetRecord) -> EngineHealthResult {
        let binary = match Self::resolve_binary_path() {
            Ok(value) => value,
            Err(error) => {
                return EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiAssetStatus::Unhealthy,
                }
            }
        };
        if !Path::new(&binary).exists() {
            return EngineHealthResult {
                healthy: false,
                detail: format!("llama.cpp binary not found: {binary}"),
                status: LocalAiAssetStatus::Unhealthy,
            };
        }

        match Self::process_running(model) {
            Ok(true) => match Self::probe_endpoint(model.endpoint.as_str()) {
                Ok(()) => EngineHealthResult {
                    healthy: true,
                    detail: format!("llama.cpp already running: {binary}"),
                    status: LocalAiAssetStatus::Active,
                },
                Err(error) => EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiAssetStatus::Unhealthy,
                },
            },
            Ok(false) => match Self::start_process(model) {
                Ok(()) => EngineHealthResult {
                    healthy: true,
                    detail: format!("llama.cpp started: {binary}"),
                    status: LocalAiAssetStatus::Active,
                },
                Err(error) => EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiAssetStatus::Unhealthy,
                },
            },
            Err(error) => EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiAssetStatus::Unhealthy,
            },
        }
    }

    fn stop(&self, model: &LocalAiAssetRecord) -> EngineHealthResult {
        match Self::stop_process(model) {
            Ok(true) => EngineHealthResult {
                healthy: true,
                detail: "llama.cpp stop requested".to_string(),
                status: LocalAiAssetStatus::Installed,
            },
            Ok(false) => EngineHealthResult {
                healthy: true,
                detail: "llama.cpp process not running".to_string(),
                status: LocalAiAssetStatus::Installed,
            },
            Err(error) => EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiAssetStatus::Unhealthy,
            },
        }
    }

    fn health(&self, model: &LocalAiAssetRecord) -> EngineHealthResult {
        match Self::process_running(model) {
            Ok(true) => match Self::probe_endpoint(model.endpoint.as_str()) {
                Ok(()) => {
                    let detail = match Self::resolve_existing_binary_path() {
                        Ok(Some(binary)) => format!("llama.cpp running: {binary}"),
                        Ok(None) => "llama.cpp running".to_string(),
                        Err(error) => error,
                    };
                    EngineHealthResult {
                        healthy: true,
                        detail,
                        status: LocalAiAssetStatus::Active,
                    }
                }
                Err(error) => EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiAssetStatus::Unhealthy,
                },
            },
            Ok(false) => {
                if model.status == LocalAiAssetStatus::Active {
                    EngineHealthResult {
                        healthy: false,
                        detail: "llama.cpp process exited unexpectedly".to_string(),
                        status: LocalAiAssetStatus::Unhealthy,
                    }
                } else {
                    match Self::resolve_existing_binary_path() {
                        Ok(Some(binary)) => EngineHealthResult {
                            healthy: true,
                            detail: format!("llama.cpp ready (not started): {binary}"),
                            status: LocalAiAssetStatus::Installed,
                        },
                        Ok(None) => EngineHealthResult {
                            healthy: true,
                            detail: "llama.cpp engine pack missing; start required to bootstrap"
                                .to_string(),
                            status: LocalAiAssetStatus::Installed,
                        },
                        Err(error) => EngineHealthResult {
                            healthy: false,
                            detail: error,
                            status: LocalAiAssetStatus::Unhealthy,
                        },
                    }
                }
            }
            Err(error) => EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiAssetStatus::Unhealthy,
            },
        }
    }
}
