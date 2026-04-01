use super::engine_pack::{ensure_llama_cpp_binary, resolve_existing_llama_cpp_binary};
use super::types::{
    resolved_model_dir, LocalAiAssetHealth, LocalAiAssetRecord, LocalAiAssetStatus,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

mod qwen;

#[cfg(test)]
use self::qwen::preflight_engine_install_with;
use self::qwen::QwenTtsPythonAdapter;

#[derive(Debug, Clone)]
pub struct EngineHealthResult {
    pub healthy: bool,
    pub detail: String,
    pub status: LocalAiAssetStatus,
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
    fn start(&self, model: &LocalAiAssetRecord) -> EngineHealthResult;
    fn stop(&self, model: &LocalAiAssetRecord) -> EngineHealthResult;
    fn health(&self, model: &LocalAiAssetRecord) -> EngineHealthResult;
}

fn normalize_engine(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn is_supervised_llama_engine(value: &str) -> bool {
    matches!(normalize_engine(value).as_str(), "llama" | "llama-cpp")
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

    fn endpoint_health(model: &LocalAiAssetRecord) -> EngineHealthResult {
        let endpoint = model.endpoint.trim();
        let probe_result = Self::probe_endpoint(endpoint);
        if let Err(error) = probe_result {
            return EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiAssetStatus::Unhealthy,
            };
        }
        let status = if model.status == LocalAiAssetStatus::Active {
            LocalAiAssetStatus::Active
        } else {
            LocalAiAssetStatus::Installed
        };
        EngineHealthResult {
            healthy: true,
            detail: format!("openai-compatible endpoint ready: {endpoint}"),
            status,
        }
    }
}

impl EngineAdapter for OpenAiCompatibleAdapter {
    fn start(&self, model: &LocalAiAssetRecord) -> EngineHealthResult {
        let endpoint = model.endpoint.trim();
        let probe_result = Self::probe_endpoint(endpoint);
        if let Err(error) = probe_result {
            return EngineHealthResult {
                healthy: false,
                detail: error,
                status: LocalAiAssetStatus::Unhealthy,
            };
        }
        EngineHealthResult {
            healthy: true,
            detail: format!("openai-compatible endpoint ready: {endpoint}"),
            status: LocalAiAssetStatus::Active,
        }
    }

    fn stop(&self, _model: &LocalAiAssetRecord) -> EngineHealthResult {
        EngineHealthResult {
            healthy: true,
            detail: "openai-compatible endpoint stop requested".to_string(),
            status: LocalAiAssetStatus::Installed,
        }
    }

    fn health(&self, model: &LocalAiAssetRecord) -> EngineHealthResult {
        Self::endpoint_health(model)
    }
}

static LLAMA_CPP_PROCESS_REGISTRY: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
static LLAMA_CPP_ASSET_OP_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
static QWEN_TTS_PROCESS_REGISTRY: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn process_registry() -> &'static Mutex<HashMap<String, Child>> {
    LLAMA_CPP_PROCESS_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn qwen_process_registry() -> &'static Mutex<HashMap<String, Child>> {
    QWEN_TTS_PROCESS_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn asset_operation_locks() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    LLAMA_CPP_ASSET_OP_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn with_asset_operation_lock<T>(
    local_asset_id: &str,
    task: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let asset_key = local_asset_id.trim().to_string();
    let asset_lock = {
        let mut locks = asset_operation_locks()
            .lock()
            .map_err(|_| "local-ai asset lock registry lock poisoned".to_string())?;
        locks
            .entry(asset_key.clone())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _guard = asset_lock
        .lock()
        .map_err(|_| format!("local-ai asset operation lock poisoned: {asset_key}"))?;
    task()
}

struct LlamaCppProcessAdapter;

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

    fn start_args(model: &LocalAiAssetRecord) -> Result<Vec<String>, String> {
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
        Ok(args)
    }

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

    fn resolve_existing_binary_path() -> Result<Option<String>, String> {
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

    fn probe_endpoint(endpoint: &str) -> Result<(), String> {
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

    fn shutdown_child_process(child: &mut Child, grace_timeout: Duration) {
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

    fn process_running(model: &LocalAiAssetRecord) -> Result<bool, String> {
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

fn adapter_for(model: &LocalAiAssetRecord) -> Box<dyn EngineAdapter + Send + Sync> {
    let engine = normalize_engine(&model.engine);
    if is_supervised_llama_engine(engine.as_str()) {
        return Box::new(LlamaCppProcessAdapter);
    }
    if engine == "qwen-tts-python" {
        return Box::new(QwenTtsPythonAdapter);
    }
    Box::new(OpenAiCompatibleAdapter)
}

pub fn restart_engine(model: &LocalAiAssetRecord) -> EngineHealthResult {
    let adapter = adapter_for(model);
    let stop_result = adapter.stop(model);
    if !stop_result.healthy {
        return stop_result;
    }
    adapter.start(model)
}

pub fn start_engine(model: &LocalAiAssetRecord) -> EngineHealthResult {
    adapter_for(model).start(model)
}

pub fn stop_engine(model: &LocalAiAssetRecord) -> EngineHealthResult {
    adapter_for(model).stop(model)
}

pub fn check_engine_health(model: &LocalAiAssetRecord) -> LocalAiAssetHealth {
    let outcome = adapter_for(model).health(model);
    LocalAiAssetHealth {
        local_asset_id: model.local_asset_id.clone(),
        status: outcome.status,
        detail: outcome.detail,
        endpoint: model.endpoint.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        check_engine_health, is_supervised_llama_engine, preflight_engine_install_with,
        start_engine, LlamaCppProcessAdapter,
    };
    use crate::local_runtime::types::{
        LocalAiAssetRecord, LocalAiAssetSource, LocalAiAssetStatus, LocalAiIntegrityMode,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};

    fn model_fixture(engine: &str, status: LocalAiAssetStatus) -> LocalAiAssetRecord {
        LocalAiAssetRecord {
            local_asset_id: "local:test-model".to_string(),
            asset_id: "hf:test/model".to_string(),
            kind: super::super::types::LocalAiAssetKind::Chat,
            logical_model_id: "nimi/test-model".to_string(),
            capabilities: vec!["chat".to_string()],
            engine: engine.to_string(),
            entry: "model.gguf".to_string(),
            files: vec!["model.gguf".to_string()],
            license: "apache-2.0".to_string(),
            source: LocalAiAssetSource {
                repo: "hf://test/model".to_string(),
                revision: "main".to_string(),
            },
            integrity_mode: Some(LocalAiIntegrityMode::Verified),
            hashes: HashMap::new(),
            tags: Vec::new(),
            known_total_size_bytes: Some(1_024),
            endpoint: "http://127.0.0.1:1234/v1".to_string(),
            status,
            installed_at: "0".to_string(),
            updated_at: "0".to_string(),
            health_detail: None,
            artifact_roles: vec!["llm".to_string(), "tokenizer".to_string()],
            preferred_engine: Some("llama".to_string()),
            fallback_engines: Vec::new(),
            engine_config: None,
            recommendation: None,
            metadata: None,
        }
    }

    fn unreachable_endpoint_fixture() -> String {
        let listener = TcpListener::bind("127.0.0.1:0")
            .expect("bind ephemeral localhost port for unreachable fixture");
        let port = listener
            .local_addr()
            .expect("resolve ephemeral localhost port")
            .port();
        drop(listener);
        format!("http://127.0.0.1:{port}/v1")
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "nimi-engine-host-{label}-{}",
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&dir).expect("create temp engine host dir");
        dir
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn bundle_manifest_fixture(runtime_files: &[&str]) -> String {
        let binary_name = if cfg!(target_os = "windows") {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        let encoded = serde_json::json!({
            "binary_name": binary_name,
            "runtime_files": runtime_files,
        });
        serde_json::to_string_pretty(&encoded).expect("encode bundle manifest fixture")
    }

    #[test]
    fn llama_cpp_without_binary_only_fails_on_start() {
        let _guard = env_lock().lock().expect("lock env");
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        std::env::remove_var("NIMI_LOCAL_AI_RUNTIME_ROOT");
        let model = model_fixture("llama-cpp", LocalAiAssetStatus::Installed);
        let started = start_engine(&model);
        assert!(!started.healthy);
        assert_eq!(started.status, LocalAiAssetStatus::Unhealthy);
        assert!(
            started.detail.contains("LOCAL_AI_ENGINE_PACK")
                || started.detail.to_ascii_lowercase().contains("llama.cpp")
        );

        let health = check_engine_health(&model);
        assert_eq!(health.status, LocalAiAssetStatus::Installed);
        assert!(
            health.detail.contains("start required")
                || health.detail.to_ascii_lowercase().contains("llama.cpp")
        );
    }

    #[test]
    fn canonical_llama_engine_uses_supervised_adapter() {
        assert!(is_supervised_llama_engine("llama"));
        assert!(is_supervised_llama_engine("LLAMA"));
        assert!(is_supervised_llama_engine("llama-cpp"));
        assert!(!is_supervised_llama_engine("speech"));
    }

    #[test]
    fn canonical_llama_without_running_process_stays_installed() {
        let _guard = env_lock().lock().expect("lock env");
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        std::env::remove_var("NIMI_LOCAL_AI_RUNTIME_ROOT");
        let model = model_fixture("llama", LocalAiAssetStatus::Installed);
        let health = check_engine_health(&model);
        assert_eq!(health.status, LocalAiAssetStatus::Installed);
        assert!(health.detail.contains("start required") || health.detail.contains("not started"));
    }

    #[test]
    fn canonical_llama_unhealthy_without_running_process_recovers_to_installed() {
        let _guard = env_lock().lock().expect("lock env");
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        std::env::remove_var("NIMI_LOCAL_AI_RUNTIME_ROOT");
        let model = model_fixture("llama", LocalAiAssetStatus::Unhealthy);
        let health = check_engine_health(&model);
        assert_eq!(health.status, LocalAiAssetStatus::Installed);
    }

    #[test]
    fn canonical_llama_with_invalid_bundle_is_unhealthy() {
        let _guard = env_lock().lock().expect("lock env");
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        let runtime_root = temp_dir("invalid-bundle");
        std::env::set_var(
            "NIMI_LOCAL_AI_RUNTIME_ROOT",
            runtime_root.display().to_string(),
        );
        let bundle_dir = runtime_root.join("engine-packs/llama-cpp").join(format!(
            "{}-{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
        fs::create_dir_all(&bundle_dir).expect("create bundle dir");
        let binary_name = if cfg!(target_os = "windows") {
            "llama-server.exe"
        } else {
            "llama-server"
        };
        fs::write(bundle_dir.join(binary_name), b"#!/bin/sh\n").expect("write cached binary");
        fs::write(
            bundle_dir.join("bundle-manifest.json"),
            bundle_manifest_fixture(&[binary_name, "libmtmd.0.dylib"]),
        )
        .expect("write invalid bundle manifest");

        let model = model_fixture("llama", LocalAiAssetStatus::Installed);
        let health = check_engine_health(&model);
        assert_eq!(health.status, LocalAiAssetStatus::Unhealthy);
        assert!(health
            .detail
            .contains("LOCAL_AI_ENGINE_PACK_BUNDLE_INVALID"));

        let _ = fs::remove_dir_all(runtime_root);
        std::env::remove_var("NIMI_LOCAL_AI_RUNTIME_ROOT");
    }

    #[test]
    fn canonical_llama_start_args_use_resolved_model_path_and_endpoint_bind() {
        let _guard = env_lock().lock().expect("lock env");
        let models_root = temp_dir("llama-models-root");
        std::env::set_var(
            "NIMI_LOCAL_AI_MODELS_DIR",
            models_root.display().to_string(),
        );
        let model = model_fixture("llama", LocalAiAssetStatus::Installed);

        let args = LlamaCppProcessAdapter::start_args(&model).expect("build llama start args");
        let expected_model_path = crate::local_runtime::types::resolved_model_dir(
            models_root.as_path(),
            model.logical_model_id.as_str(),
        )
        .join(model.entry.as_str())
        .to_string_lossy()
        .to_string();
        let model_index = args
            .iter()
            .position(|item| item == "--model")
            .expect("start args include --model");
        let host_index = args
            .iter()
            .position(|item| item == "--host")
            .expect("start args include --host");
        let port_index = args
            .iter()
            .position(|item| item == "--port")
            .expect("start args include --port");

        assert_eq!(args.get(model_index + 1), Some(&expected_model_path));
        assert_eq!(args.get(host_index + 1), Some(&"127.0.0.1".to_string()));
        assert_eq!(args.get(port_index + 1), Some(&"1234".to_string()));

        std::env::remove_var("NIMI_LOCAL_AI_MODELS_DIR");
        let _ = fs::remove_dir_all(models_root);
    }

    #[test]
    fn canonical_llama_active_without_running_process_is_unhealthy() {
        std::env::remove_var("NIMI_LLAMA_CPP_BIN");
        let model = model_fixture("llama", LocalAiAssetStatus::Active);
        let health = check_engine_health(&model);
        assert_eq!(health.status, LocalAiAssetStatus::Unhealthy);
        assert!(health.detail.contains("exited unexpectedly"));
    }

    #[test]
    fn openai_compatible_engine_reports_unhealthy_when_endpoint_unreachable() {
        let mut model = model_fixture("openai-compatible", LocalAiAssetStatus::Installed);
        model.endpoint = unreachable_endpoint_fixture();
        let started = start_engine(&model);
        assert!(!started.healthy);
        assert_eq!(started.status, LocalAiAssetStatus::Unhealthy);
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
