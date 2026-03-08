use super::engine_pack::ensure_llama_cpp_binary;
use super::types::{
    LocalAiModelHealth, LocalAiModelRecord, LocalAiModelStatus,
};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

mod qwen;

use self::qwen::QwenTtsPythonAdapter;
#[cfg(test)]
use self::qwen::preflight_engine_install_with;

#[derive(Debug, Clone)]
pub struct EngineHealthResult {
    pub healthy: bool,
    pub detail: String,
    pub status: LocalAiModelStatus,
}

const LLAMA_CPP_START_TIMEOUT_MS_DEFAULT: u64 = 45_000;
const LLAMA_CPP_STOP_GRACE_MS_DEFAULT: u64 = 5_000;
const LLAMA_CPP_HEALTH_POLL_INTERVAL_MS: u64 = 300;
const QWEN_TTS_START_TIMEOUT_MS_DEFAULT: u64 = 120_000;
const QWEN_TTS_STOP_GRACE_MS_DEFAULT: u64 = 8_000;
const QWEN_TTS_HEALTH_POLL_INTERVAL_MS: u64 = 500;
const QWEN_TTS_GATEWAY_SCRIPT_NAME: &str = "qwen_tts_server.py";
const QWEN_TTS_GATEWAY_TEMPLATE: &str = include_str!("../qwen_tts_server_template.py");
const QWEN_TTS_VENV_DIR_NAME: &str = "qwen-tts-python";

trait EngineAdapter {
    fn start(&self, model: &LocalAiModelRecord) -> EngineHealthResult;
    fn stop(&self, model: &LocalAiModelRecord) -> EngineHealthResult;
    fn health(&self, model: &LocalAiModelRecord) -> EngineHealthResult;
}

fn normalize_engine(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

struct OpenAiCompatibleAdapter;

impl OpenAiCompatibleAdapter {
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

    fn probe_endpoint(endpoint: &str) -> Result<(), String> {
        let health_url = Self::health_probe_endpoint(endpoint).ok_or_else(|| {
            "LOCAL_AI_OPENAI_ENDPOINT_EMPTY: local runtime endpoint is empty".to_string()
        })?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .map_err(|error| {
                format!(
                    "LOCAL_AI_ENGINE_HTTP_CLIENT_FAILED: failed to create health client: {error}"
                )
            })?;
        match client.get(&health_url).send() {
            Ok(response) if response.status().is_success() => Ok(()),
            Ok(response) => Err(format!(
                "LOCAL_AI_OPENAI_ENDPOINT_UNREACHABLE: status={} endpoint={health_url}",
                response.status().as_u16()
            )),
            Err(error) => Err(format!(
                "LOCAL_AI_OPENAI_ENDPOINT_UNREACHABLE: endpoint={health_url} error={error}"
            )),
        }
    }

    fn endpoint_health(model: &LocalAiModelRecord) -> EngineHealthResult {
        let endpoint = model.endpoint.trim();
        let probe_result = Self::probe_endpoint(endpoint);
        if let Err(error) = probe_result {
            return EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiModelStatus::Unhealthy,
            };
        }
        let status = if model.status == LocalAiModelStatus::Active {
            LocalAiModelStatus::Active
        } else {
            LocalAiModelStatus::Installed
        };
        EngineHealthResult {
            healthy: true,
            detail: format!("openai-compatible endpoint ready: {endpoint}"),
            status,
        }
    }
}

impl EngineAdapter for OpenAiCompatibleAdapter {
    fn start(&self, model: &LocalAiModelRecord) -> EngineHealthResult {
        let endpoint = model.endpoint.trim();
        let probe_result = Self::probe_endpoint(endpoint);
        if let Err(error) = probe_result {
            return EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiModelStatus::Unhealthy,
            };
        }
        EngineHealthResult {
            healthy: true,
            detail: format!("openai-compatible endpoint ready: {endpoint}"),
            status: LocalAiModelStatus::Active,
        }
    }

    fn stop(&self, _model: &LocalAiModelRecord) -> EngineHealthResult {
        EngineHealthResult {
            healthy: true,
            detail: "openai-compatible endpoint stop requested".to_string(),
            status: LocalAiModelStatus::Installed,
        }
    }

    fn health(&self, model: &LocalAiModelRecord) -> EngineHealthResult {
        Self::endpoint_health(model)
    }
}

static LLAMA_CPP_PROCESS_REGISTRY: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
static LLAMA_CPP_MODEL_OP_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
static QWEN_TTS_PROCESS_REGISTRY: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn process_registry() -> &'static Mutex<HashMap<String, Child>> {
    LLAMA_CPP_PROCESS_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn qwen_process_registry() -> &'static Mutex<HashMap<String, Child>> {
    QWEN_TTS_PROCESS_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn model_operation_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    LLAMA_CPP_MODEL_OP_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_model_operation_lock<T>(
    local_model_id: &str,
    task: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let model_key = local_model_id.trim().to_string();
    let model_lock = {
        let mut locks = model_operation_locks()
            .lock()
            .map_err(|_| "local-ai model lock registry lock poisoned".to_string())?;
        locks
            .entry(model_key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _guard = model_lock
        .lock()
        .map_err(|_| format!("local-ai model operation lock poisoned: {model_key}"))?;
    task()
}

struct LlamaCppProcessAdapter;

impl LlamaCppProcessAdapter {
    fn resolve_binary_path() -> Result<String, String> {
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
                    "LOCAL_AI_ENGINE_START_TIMEOUT: llama.cpp health check timed out after {} ms ({health_url}): {}",
                    timeout.as_millis(),
                    last_error
                ));
            }
            thread::sleep(Duration::from_millis(LLAMA_CPP_HEALTH_POLL_INTERVAL_MS));
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

    fn shutdown_child_process(child: &mut Child, grace_timeout: Duration) {
        Self::send_terminate_signal(child);
        if Self::wait_for_exit(child, grace_timeout) {
            return;
        }
        let _ = child.kill();
        let _ = child.wait();
    }

    fn start_process(model: &LocalAiModelRecord) -> Result<(), String> {
        with_model_operation_lock(model.local_model_id.as_str(), || {
            let binary = Self::resolve_binary_path()?;
            if !Path::new(&binary).exists() {
                return Err(format!("llama.cpp binary not found: {binary}"));
            }

            let mut args = Self::parse_extra_args();
            if !args.iter().any(|item| item == "--model") && !model.entry.trim().is_empty() {
                args.push("--model".to_string());
                args.push(model.entry.trim().to_string());
            }

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
            registry.insert(model.local_model_id.clone(), child);
            drop(registry);

            if let Err(error) =
                Self::wait_for_endpoint_ready(model.endpoint.as_str(), Self::start_timeout())
            {
                let mut registry = process_registry()
                    .lock()
                    .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
                if let Some(mut child) = registry.remove(&model.local_model_id) {
                    Self::shutdown_child_process(&mut child, Self::stop_grace_timeout());
                }
                return Err(error);
            }

            Ok(())
        })
    }

    fn process_running(model: &LocalAiModelRecord) -> Result<bool, String> {
        with_model_operation_lock(model.local_model_id.as_str(), || {
            let mut registry = process_registry()
                .lock()
                .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
            if let Some(child) = registry.get_mut(&model.local_model_id) {
                match child.try_wait() {
                    Ok(None) => return Ok(true),
                    Ok(Some(_)) => {
                        registry.remove(&model.local_model_id);
                        return Ok(false);
                    }
                    Err(error) => {
                        registry.remove(&model.local_model_id);
                        return Err(format!("llama.cpp process check failed: {error}"));
                    }
                }
            }
            Ok(false)
        })
    }

    fn stop_process(model: &LocalAiModelRecord) -> Result<bool, String> {
        with_model_operation_lock(model.local_model_id.as_str(), || {
            let mut registry = process_registry()
                .lock()
                .map_err(|_| "llama.cpp process registry lock poisoned".to_string())?;
            let mut child = match registry.remove(&model.local_model_id) {
                Some(value) => value,
                None => return Ok(false),
            };
            Self::shutdown_child_process(&mut child, Self::stop_grace_timeout());
            Ok(true)
        })
    }
}

impl EngineAdapter for LlamaCppProcessAdapter {
    fn start(&self, model: &LocalAiModelRecord) -> EngineHealthResult {
        let binary = match Self::resolve_binary_path() {
            Ok(value) => value,
            Err(error) => {
                return EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiModelStatus::Unhealthy,
                }
            }
        };
        if !Path::new(&binary).exists() {
            return EngineHealthResult {
                healthy: false,
                detail: format!("llama.cpp binary not found: {binary}"),
                status: LocalAiModelStatus::Unhealthy,
            };
        }

        match Self::process_running(model) {
            Ok(true) => EngineHealthResult {
                healthy: true,
                detail: format!("llama.cpp already running: {binary}"),
                status: LocalAiModelStatus::Active,
            },
            Ok(false) => match Self::start_process(model) {
                Ok(()) => EngineHealthResult {
                    healthy: true,
                    detail: format!("llama.cpp started: {binary}"),
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
                detail: "llama.cpp stop requested".to_string(),
                status: LocalAiModelStatus::Installed,
            },
            Ok(false) => EngineHealthResult {
                healthy: true,
                detail: "llama.cpp process not running".to_string(),
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
        let binary = match Self::resolve_binary_path() {
            Ok(value) => value,
            Err(error) => {
                return EngineHealthResult {
                    healthy: false,
                    detail: error,
                    status: LocalAiModelStatus::Unhealthy,
                }
            }
        };
        if !Path::new(&binary).exists() {
            return EngineHealthResult {
                healthy: false,
                detail: format!("llama.cpp binary not found: {binary}"),
                status: LocalAiModelStatus::Unhealthy,
            };
        }

        match Self::process_running(model) {
            Ok(true) => EngineHealthResult {
                healthy: true,
                detail: format!("llama.cpp running: {binary}"),
                status: LocalAiModelStatus::Active,
            },
            Ok(false) => {
                if model.status == LocalAiModelStatus::Active {
                    EngineHealthResult {
                        healthy: false,
                        detail: "llama.cpp process exited unexpectedly".to_string(),
                        status: LocalAiModelStatus::Unhealthy,
                    }
                } else {
                    EngineHealthResult {
                        healthy: true,
                        detail: "llama.cpp ready (not started)".to_string(),
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

fn adapter_for(model: &LocalAiModelRecord) -> Box<dyn EngineAdapter + Send + Sync> {
    let engine = normalize_engine(&model.engine);
    if engine == "llama-cpp" {
        return Box::new(LlamaCppProcessAdapter);
    }
    if engine == "qwen-tts-python" {
        return Box::new(QwenTtsPythonAdapter);
    }
    Box::new(OpenAiCompatibleAdapter)
}

pub fn restart_engine(model: &LocalAiModelRecord) -> EngineHealthResult {
    let adapter = adapter_for(model);
    let stop_result = adapter.stop(model);
    if !stop_result.healthy {
        return stop_result;
    }
    adapter.start(model)
}

pub fn start_engine(model: &LocalAiModelRecord) -> EngineHealthResult {
    adapter_for(model).start(model)
}

pub fn stop_engine(model: &LocalAiModelRecord) -> EngineHealthResult {
    adapter_for(model).stop(model)
}

pub fn check_engine_health(model: &LocalAiModelRecord) -> LocalAiModelHealth {
    let outcome = adapter_for(model).health(model);
    LocalAiModelHealth {
        local_model_id: model.local_model_id.clone(),
        status: outcome.status,
        detail: outcome.detail,
        endpoint: model.endpoint.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{check_engine_health, preflight_engine_install_with, start_engine};
    use crate::local_runtime::types::{LocalAiModelRecord, LocalAiModelSource, LocalAiModelStatus};
    use std::collections::HashMap;
    use std::net::TcpListener;

    fn model_fixture(engine: &str, status: LocalAiModelStatus) -> LocalAiModelRecord {
        LocalAiModelRecord {
            local_model_id: "local:test-model".to_string(),
            model_id: "hf:test/model".to_string(),
            capabilities: vec!["chat".to_string()],
            engine: engine.to_string(),
            entry: "model.gguf".to_string(),
            license: "apache-2.0".to_string(),
            source: LocalAiModelSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            hashes: HashMap::new(),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status,
            installed_at: "0".to_string(),
            updated_at: "0".to_string(),
            health_detail: None,
            engine_config: None,
        }
    }

    fn unreachable_endpoint_fixture() -> String {
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("bind ephemeral localhost port for unreachable fixture");
        let port = listener
            .local_addr()
            .expect("resolve ephemeral localhost port")
            .port();
        drop(listener);
        format!("http://127.0.0.1:{port}/v1")
    }

    #[test]
    fn llama_cpp_without_binary_is_unhealthy() {
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        let model = model_fixture("llama-cpp", LocalAiModelStatus::Installed);
        let started = start_engine(&model);
        assert!(!started.healthy);
        assert_eq!(started.status, LocalAiModelStatus::Unhealthy);
        assert!(
            started.detail.contains("LOCAL_AI_ENGINE_PACK")
                || started.detail.to_ascii_lowercase().contains("llama.cpp")
        );

        let health = check_engine_health(&model);
        assert_eq!(health.status, LocalAiModelStatus::Unhealthy);
        assert!(
            health.detail.contains("LOCAL_AI_ENGINE_PACK")
                || health.detail.to_ascii_lowercase().contains("llama.cpp")
        );
    }

    #[test]
    fn openai_compatible_engine_reports_unhealthy_when_endpoint_unreachable() {
        let mut model = model_fixture("openai-compatible", LocalAiModelStatus::Installed);
        model.endpoint = unreachable_endpoint_fixture();
        let started = start_engine(&model);
        assert!(!started.healthy);
        assert_eq!(started.status, LocalAiModelStatus::Unhealthy);
        assert!(started
            .detail
            .contains("LOCAL_AI_OPENAI_ENDPOINT_UNREACHABLE"));
    }

    #[test]
    fn preflight_engine_install_non_qwen_bypasses_gate() {
        let result = preflight_engine_install_with("openai-compatible", || {
            Err("LOCAL_AI_QWEN_GPU_REQUIRED: should not run".to_string())
        });
        assert!(result.is_ok());
    }

    #[test]
    fn preflight_engine_install_qwen_propagates_failure() {
        let result = preflight_engine_install_with("qwen-tts-python", || {
            Err("LOCAL_AI_QWEN_GPU_REQUIRED: gpu unavailable".to_string())
        });
        let error = result.expect_err("qwen preflight should fail");
        assert!(error.contains("LOCAL_AI_QWEN_GPU_REQUIRED"));
    }

    #[test]
    fn preflight_engine_install_qwen_accepts_success() {
        let result = preflight_engine_install_with("qwen-tts-python", || Ok(()));
        assert!(result.is_ok());
    }
}
