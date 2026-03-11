use super::super::engine_pack::{ensure_localai_binary, ensure_nexa_binary};
use super::super::reason_codes::{
    normalize_local_ai_reason_code, LOCAL_AI_PROVIDER_INTERNAL_ERROR, LOCAL_AI_PROVIDER_TIMEOUT,
    LOCAL_AI_SERVICE_UNREACHABLE,
};
use super::super::service_artifacts::find_service_artifact;
use super::super::types::{
    LocalAiDeviceProfile, LocalAiServiceArtifact, LocalAiServiceArtifactType,
    DEFAULT_LOCAL_ENDPOINT,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const LOCALAI_RUNTIME_API_KEY_ENV: &str = "NIMI_LOCAL_OPENAI_API_KEY";
const LOCALAI_START_TIMEOUT_MS_DEFAULT: u64 = 90_000;
const LOCALAI_STOP_GRACE_MS_DEFAULT: u64 = 8_000;
const LOCALAI_HEALTH_POLL_INTERVAL_MS: u64 = 400;

static LOCALAI_PROCESS_REGISTRY: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();
static LOCALAI_RUNTIME_API_KEY: OnceLock<String> = OnceLock::new();

type ManagedStrategyStartFn = fn(&str, &str) -> Result<String, String>;
type ManagedStrategyStopFn = fn(&str) -> Result<String, String>;
type ManagedStrategyBootstrapFn =
    fn(&LocalAiServiceArtifact, &str) -> Result<Option<String>, String>;
type ManagedStrategyEnabledFn = fn() -> bool;

#[derive(Clone, Copy)]
pub(super) struct ManagedProviderStrategy {
    pub(super) provider: &'static str,
    pub(super) enabled: ManagedStrategyEnabledFn,
    pub(super) start: ManagedStrategyStartFn,
    pub(super) stop: ManagedStrategyStopFn,
    pub(super) bootstrap: ManagedStrategyBootstrapFn,
}

pub(super) fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn localai_process_registry() -> &'static Mutex<HashMap<String, Child>> {
    LOCALAI_PROCESS_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn localai_start_timeout() -> Duration {
    let timeout_ms = std::env::var("NIMI_LOCALAI_START_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(LOCALAI_START_TIMEOUT_MS_DEFAULT)
        .clamp(3_000, 240_000);
    Duration::from_millis(timeout_ms)
}

fn localai_stop_grace_timeout() -> Duration {
    let timeout_ms = std::env::var("NIMI_LOCALAI_STOP_GRACE_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(LOCALAI_STOP_GRACE_MS_DEFAULT)
        .clamp(500, 60_000);
    Duration::from_millis(timeout_ms)
}

fn generate_runtime_api_key() -> String {
    let seed = format!(
        "nimi-localai:{}:{}:{}",
        std::process::id(),
        now_nanos(),
        std::env::var("NIMI_TARGET_ACCOUNT_ID").unwrap_or_default()
    );
    let digest = Sha256::digest(seed.as_bytes());
    let suffix = digest[..12]
        .iter()
        .map(|value| format!("{value:02x}"))
        .collect::<String>();
    format!("nimi-localai-{suffix}")
}

pub(crate) fn resolve_or_initialize_runtime_api_key() -> String {
    if let Some(value) =
        normalize_non_empty(std::env::var(LOCALAI_RUNTIME_API_KEY_ENV).ok().as_deref())
    {
        return value;
    }
    let generated = LOCALAI_RUNTIME_API_KEY
        .get_or_init(generate_runtime_api_key)
        .clone();
    std::env::set_var(LOCALAI_RUNTIME_API_KEY_ENV, generated.clone());
    generated
}

fn managed_service_provider_from_artifact(artifact: &LocalAiServiceArtifact) -> Option<String> {
    if artifact.artifact_type != LocalAiServiceArtifactType::Binary {
        return None;
    }
    let provider = artifact.engine.trim().to_ascii_lowercase();
    if provider == "localai" || provider == "nexa" {
        return Some(provider);
    }
    None
}

pub(super) fn managed_service_provider(service_id: &str) -> Option<String> {
    find_service_artifact(service_id)
        .and_then(|artifact| managed_service_provider_from_artifact(&artifact))
}

fn managed_service_artifact(
    service_id: &str,
    provider: &str,
) -> Result<LocalAiServiceArtifact, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let resolved_provider =
        managed_service_provider_from_artifact(&artifact).unwrap_or_else(|| "unknown".to_string());
    if !resolved_provider.eq_ignore_ascii_case(provider) {
        return Err(format!(
            "LOCAL_AI_ADAPTER_MISMATCH: serviceId={} managed provider mismatch expected={} actual={}",
            artifact.service_id, provider, resolved_provider
        ));
    }
    Ok(artifact)
}

fn localai_managed_strategy_enabled() -> bool {
    true
}

fn managed_provider_strategies() -> [ManagedProviderStrategy; 2] {
    [
        ManagedProviderStrategy {
            provider: "localai",
            enabled: localai_managed_strategy_enabled,
            start: start_managed_localai_service,
            stop: stop_managed_localai_service,
            bootstrap: bootstrap_localai_service_artifact,
        },
        ManagedProviderStrategy {
            provider: "nexa",
            enabled: nexa_managed_strategy_enabled,
            start: start_managed_nexa_service,
            stop: stop_managed_nexa_service,
            bootstrap: bootstrap_nexa_service_artifact,
        },
    ]
}

pub(super) fn managed_provider_strategy(provider: &str) -> Option<ManagedProviderStrategy> {
    let normalized = provider.trim().to_ascii_lowercase();
    managed_provider_strategies()
        .into_iter()
        .find(|strategy| strategy.provider.eq_ignore_ascii_case(normalized.as_str()))
}

pub(super) fn bootstrap_marker_provider(marker: &str) -> Option<&'static str> {
    if marker.eq_ignore_ascii_case("engine-pack:localai") {
        return Some("localai");
    }
    if marker.eq_ignore_ascii_case("engine-pack:nexa") {
        return Some("nexa");
    }
    None
}

pub(super) fn parse_version_parts(version: &str) -> Option<(u32, u32)> {
    let mut iter = version
        .trim()
        .split('.')
        .map(|item| item.trim().parse::<u32>().ok());
    let major = iter.next().flatten()?;
    let minor = iter.next().flatten().unwrap_or(0);
    Some((major, minor))
}

pub(super) fn port_available(profile: &LocalAiDeviceProfile, port: u16) -> bool {
    profile
        .ports
        .iter()
        .find(|item| item.port == port)
        .map(|item| item.available)
        .unwrap_or(false)
}

fn preflight_port_hint(artifact: &LocalAiServiceArtifact) -> Option<u16> {
    artifact.preflight.iter().find_map(|rule| {
        if !rule.check.trim().eq_ignore_ascii_case("port-available") {
            return None;
        }
        rule.params
            .as_ref()
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .and_then(|value| u16::try_from(value).ok())
            .filter(|value| *value > 0)
    })
}

pub(super) fn default_loopback_endpoint_for_artifact(artifact: &LocalAiServiceArtifact) -> String {
    if let Some(port) = preflight_port_hint(artifact) {
        return format!("http://127.0.0.1:{port}/v1");
    }
    DEFAULT_LOCAL_ENDPOINT.to_string()
}

pub(super) fn resolve_effective_endpoint(
    artifact: &LocalAiServiceArtifact,
    endpoint: Option<&str>,
) -> Option<String> {
    let explicit = normalize_non_empty(endpoint);
    if explicit.is_some() {
        return explicit;
    }
    Some(default_loopback_endpoint_for_artifact(artifact))
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

pub(super) fn is_loopback_endpoint(endpoint: &str) -> bool {
    let normalized = endpoint.trim();
    if normalized.is_empty() {
        return false;
    }
    if let Ok(url) = reqwest::Url::parse(normalized) {
        return url.host_str().map(is_loopback_host).unwrap_or(false);
    }
    false
}

pub(super) fn build_service_health_url(
    endpoint: &str,
    health_endpoint: &str,
) -> Result<String, String> {
    let endpoint = normalize_non_empty(Some(endpoint)).ok_or_else(|| {
        "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: service endpoint is missing".to_string()
    })?;
    let health_endpoint =
        normalize_non_empty(Some(health_endpoint)).unwrap_or_else(|| "/readyz".to_string());
    if let Ok(url) = reqwest::Url::parse(health_endpoint.as_str()) {
        return Ok(url.to_string());
    }
    let mut url = reqwest::Url::parse(endpoint.as_str()).map_err(|error| {
        format!("LOCAL_AI_SERVICE_ENDPOINT_INVALID: invalid service endpoint URL: {error}")
    })?;
    if health_endpoint.starts_with('/') {
        url.set_path(health_endpoint.as_str());
        url.set_query(None);
        url.set_fragment(None);
        return Ok(url.to_string());
    }

    let joined_path = format!(
        "{}/{}",
        url.path().trim_end_matches('/'),
        health_endpoint.trim_start_matches('/')
    );
    url.set_path(joined_path.as_str());
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.to_string())
}

pub(super) fn maybe_authenticate_request(
    request: reqwest::blocking::RequestBuilder,
    service_id: &str,
) -> reqwest::blocking::RequestBuilder {
    if managed_service_provider(service_id).as_deref() == Some("localai") {
        let api_key = resolve_or_initialize_runtime_api_key();
        if !api_key.trim().is_empty() {
            return request
                .bearer_auth(api_key.clone())
                .header("X-Api-Key", api_key);
        }
    }
    request
}

fn parse_endpoint_host_port(endpoint: &str) -> Result<(String, u16), String> {
    let normalized = normalize_non_empty(Some(endpoint)).ok_or_else(|| {
        "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: service endpoint is missing".to_string()
    })?;
    let url = reqwest::Url::parse(normalized.as_str()).map_err(|error| {
        format!("LOCAL_AI_SERVICE_ENDPOINT_INVALID: invalid endpoint URL: {error}")
    })?;
    let host = url.host_str().ok_or_else(|| {
        "LOCAL_AI_SERVICE_ENDPOINT_INVALID: endpoint host is required".to_string()
    })?;
    if !is_loopback_host(host) {
        return Err(format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: endpoint host must be loopback: {host}"
        ));
    }
    let port = url
        .port_or_known_default()
        .filter(|value| *value > 0)
        .ok_or_else(|| {
            "LOCAL_AI_SERVICE_ENDPOINT_INVALID: endpoint port is required".to_string()
        })?;
    Ok(("127.0.0.1".to_string(), port))
}

pub(super) fn normalize_managed_error(error: String, fallback: &str) -> String {
    let reason = normalize_local_ai_reason_code(error.as_str(), fallback);
    format!("{reason}: {error}")
}

fn normalize_loopback_origin(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(
            "LOCAL_AI_SERVICE_UNREACHABLE: managed nexa origin entry cannot be empty".to_string(),
        );
    }
    if trimmed == "*" {
        return Err(
            "LOCAL_AI_SERVICE_UNREACHABLE: managed nexa CORS origins cannot be wildcard (*)"
                .to_string(),
        );
    }

    let parsed = reqwest::Url::parse(trimmed).map_err(|error| {
        format!("LOCAL_AI_SERVICE_UNREACHABLE: managed nexa origin URL invalid: {error}")
    })?;
    let host = parsed.host_str().ok_or_else(|| {
        "LOCAL_AI_SERVICE_UNREACHABLE: managed nexa origin host is required".to_string()
    })?;
    if !is_loopback_host(host) {
        return Err(format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: managed nexa origin must be loopback: {host}"
        ));
    }
    let scheme = parsed.scheme().to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: managed nexa origin scheme is unsupported: {scheme}"
        ));
    }

    let mut normalized = format!("{scheme}://{host}");
    if let Some(port) = parsed.port() {
        normalized = format!("{normalized}:{port}");
    }
    Ok(normalized)
}

fn resolve_nexa_origins() -> Result<String, String> {
    let explicit = std::env::var("NIMI_LOCAL_AI_NEXA_ORIGINS")
        .ok()
        .or_else(|| std::env::var("NEXA_ORIGINS").ok())
        .unwrap_or_else(|| "http://127.0.0.1".to_string());
    let mut origins = Vec::<String>::new();
    for item in explicit.split(',') {
        let normalized = item.trim();
        if normalized.is_empty() {
            continue;
        }
        origins.push(normalize_loopback_origin(normalized)?);
    }
    if origins.is_empty() {
        return Err(
            "LOCAL_AI_SERVICE_UNREACHABLE: managed nexa CORS origins must include at least one loopback origin"
                .to_string(),
        );
    }
    Ok(origins.join(","))
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

fn shutdown_process(child: &mut Child, grace_timeout: Duration) {
    send_terminate_signal(child);
    if wait_for_exit(child, grace_timeout) {
        return;
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn managed_localai_process_running(service_id: &str) -> Result<bool, String> {
    let normalized = service_id.trim().to_ascii_lowercase();
    let mut registry = localai_process_registry().lock().map_err(|_| {
        "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string()
    })?;
    if let Some(child) = registry.get_mut(normalized.as_str()) {
        return match child.try_wait() {
            Ok(None) => Ok(true),
            Ok(Some(_)) => {
                registry.remove(normalized.as_str());
                Ok(false)
            }
            Err(error) => {
                registry.remove(normalized.as_str());
                Err(format!(
                    "LOCAL_AI_PROVIDER_INTERNAL_ERROR: failed to inspect managed process: {error}"
                ))
            }
        };
    }
    Ok(false)
}

fn stop_managed_localai_process(service_id: &str) -> Result<bool, String> {
    let normalized = service_id.trim().to_ascii_lowercase();
    let mut registry = localai_process_registry().lock().map_err(|_| {
        "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string()
    })?;
    let mut child = match registry.remove(normalized.as_str()) {
        Some(value) => value,
        None => return Ok(false),
    };
    shutdown_process(&mut child, localai_stop_grace_timeout());
    Ok(true)
}

fn wait_for_localai_ready(service_id: &str, endpoint: &str) -> Result<String, String> {
    let timeout = localai_start_timeout();
    let deadline = Instant::now() + timeout;
    loop {
        let last_error = match super::probe_service_endpoint_health(service_id, endpoint) {
            Ok(detail) => return Ok(detail),
            Err(error) => error,
        };
        if Instant::now() >= deadline {
            return Err(format!(
                "LOCAL_AI_PROVIDER_TIMEOUT: serviceId={} endpoint={} timeoutMs={} detail={}",
                service_id,
                endpoint,
                timeout.as_millis(),
                last_error
            ));
        }
        thread::sleep(Duration::from_millis(LOCALAI_HEALTH_POLL_INTERVAL_MS));
    }
}

pub fn is_managed_service(service_id: &str) -> bool {
    managed_service_provider(service_id).is_some()
}

pub fn start_managed_localai_service(service_id: &str, endpoint: &str) -> Result<String, String> {
    let artifact = managed_service_artifact(service_id, "localai")?;
    let resolved_endpoint = resolve_effective_endpoint(&artifact, Some(endpoint))
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={service_id}"))?;
    let (host, port) = parse_endpoint_host_port(resolved_endpoint.as_str())?;

    if managed_localai_process_running(service_id)? {
        return wait_for_localai_ready(service_id, resolved_endpoint.as_str()).map(|detail| {
            format!(
                "managed localai already running: serviceId={} endpoint={} detail={detail}",
                artifact.service_id, resolved_endpoint
            )
        });
    }

    let bootstrap = ensure_localai_binary()?;
    let mut command = Command::new(bootstrap.binary_path.as_str());
    let mut args = artifact.process.args.clone();
    if args.is_empty() {
        args.push("run".to_string());
    }
    command.args(args);

    let runtime_api_key = resolve_or_initialize_runtime_api_key();
    command
        .env("LOCALAI_ADDRESS", format!("{host}:{port}"))
        .env("LOCALAI_API_KEY", runtime_api_key)
        .env("LOCALAI_DISABLE_WEBUI", "true")
        .env("LOCALAI_DISABLE_GALLERY_ENDPOINT", "true")
        .env("LOCALAI_DISABLE_RUNTIME_SETTINGS", "true")
        .env("LOCALAI_DISABLE_API_KEY_REQUIREMENT_FOR_HTTP_GET", "false")
        .env("LOCALAI_P2P", "false")
        .env("LOCALAI_FEDERATED", "false")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    for (key, value) in artifact.process.env {
        if let Some(normalized) = normalize_non_empty(Some(value.as_str())) {
            command.env(key.as_str(), normalized);
        }
    }

    let child = command.spawn().map_err(|error| {
        format!("LOCAL_AI_PROVIDER_INTERNAL_ERROR: failed to start managed localai binary: {error}")
    })?;
    {
        let mut registry = localai_process_registry().lock().map_err(|_| {
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string()
        })?;
        registry.insert(service_id.trim().to_ascii_lowercase(), child);
    }

    match wait_for_localai_ready(service_id, resolved_endpoint.as_str()) {
        Ok(detail) => Ok(format!(
            "managed localai service started: serviceId={} endpoint={} detail={detail}",
            artifact.service_id, resolved_endpoint
        )),
        Err(error) => {
            let _ = stop_managed_localai_process(service_id);
            Err(error)
        }
    }
}

pub fn stop_managed_localai_service(service_id: &str) -> Result<String, String> {
    let artifact = managed_service_artifact(service_id, "localai")?;
    let stopped = stop_managed_localai_process(artifact.service_id.as_str())?;
    if stopped {
        return Ok(format!(
            "managed localai service stopped: serviceId={}",
            artifact.service_id
        ));
    }
    Ok(format!(
        "managed localai service already stopped: serviceId={}",
        artifact.service_id
    ))
}

fn bootstrap_localai_service_artifact(
    artifact: &LocalAiServiceArtifact,
    _marker: &str,
) -> Result<Option<String>, String> {
    let bootstrap = ensure_localai_binary()?;
    Ok(Some(format!(
        "engine pack ready: serviceId={} binary={}",
        artifact.service_id, bootstrap.binary_path
    )))
}

fn bootstrap_nexa_service_artifact(
    artifact: &LocalAiServiceArtifact,
    _marker: &str,
) -> Result<Option<String>, String> {
    let bootstrap = ensure_nexa_binary()
        .map_err(|error| normalize_managed_error(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR))?;
    Ok(Some(format!(
        "engine pack ready: serviceId={} binary={}",
        artifact.service_id, bootstrap.binary_path
    )))
}

fn nexa_managed_strategy_enabled() -> bool {
    true
}

fn start_managed_nexa_service(service_id: &str, endpoint: &str) -> Result<String, String> {
    let artifact = managed_service_artifact(service_id, "nexa")?;
    let resolved_endpoint = resolve_effective_endpoint(&artifact, Some(endpoint))
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={service_id}"))?;
    let (host, port) = parse_endpoint_host_port(resolved_endpoint.as_str())?;
    let cors_origins = resolve_nexa_origins()
        .map_err(|error| normalize_managed_error(error, LOCAL_AI_SERVICE_UNREACHABLE))?;

    if managed_localai_process_running(service_id)? {
        return wait_for_localai_ready(service_id, resolved_endpoint.as_str()).map(|detail| {
            format!(
                "managed nexa already running: serviceId={} endpoint={} detail={detail}",
                artifact.service_id, resolved_endpoint
            )
        });
    }

    let bootstrap = ensure_nexa_binary()
        .map_err(|error| normalize_managed_error(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR))?;
    let mut command = Command::new(bootstrap.binary_path.as_str());
    let mut args = artifact.process.args.clone();
    if args.is_empty() {
        args.push("--skip-update".to_string());
        args.push("serve".to_string());
    } else {
        if !args
            .iter()
            .any(|arg| arg.trim().eq_ignore_ascii_case("--skip-update"))
        {
            args.insert(0, "--skip-update".to_string());
        }
        if !args
            .iter()
            .any(|arg| arg.trim().eq_ignore_ascii_case("serve"))
        {
            args.push("serve".to_string());
        }
    }

    command
        .args(args)
        .env("NEXA_HOST", format!("{host}:{port}"))
        .env("NEXA_ORIGINS", cors_origins)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    for (key, value) in artifact.process.env {
        let normalized_key = key.trim();
        if normalized_key.eq_ignore_ascii_case("NEXA_HOST")
            || normalized_key.eq_ignore_ascii_case("NEXA_ORIGINS")
        {
            continue;
        }
        if let Some(normalized_value) = normalize_non_empty(Some(value.as_str())) {
            command.env(normalized_key, normalized_value);
        }
    }

    let child = command.spawn().map_err(|error| {
        normalize_managed_error(
            format!("failed to start managed nexa binary: {error}"),
            LOCAL_AI_PROVIDER_INTERNAL_ERROR,
        )
    })?;
    {
        let mut registry = localai_process_registry().lock().map_err(|_| {
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string()
        })?;
        registry.insert(service_id.trim().to_ascii_lowercase(), child);
    }

    match wait_for_localai_ready(service_id, resolved_endpoint.as_str()) {
        Ok(detail) => Ok(format!(
            "managed nexa service started: serviceId={} endpoint={} detail={detail}",
            artifact.service_id, resolved_endpoint
        )),
        Err(error) => {
            let _ = stop_managed_localai_process(service_id);
            Err(normalize_managed_error(error, LOCAL_AI_PROVIDER_TIMEOUT))
        }
    }
}

fn stop_managed_nexa_service(service_id: &str) -> Result<String, String> {
    let artifact = managed_service_artifact(service_id, "nexa")?;
    let stopped = stop_managed_localai_process(artifact.service_id.as_str())?;
    if stopped {
        return Ok(format!(
            "managed nexa service stopped: serviceId={}",
            artifact.service_id
        ));
    }
    Ok(format!(
        "managed nexa service already stopped: serviceId={}",
        artifact.service_id
    ))
}

pub fn start_managed_service(service_id: &str, endpoint: &str) -> Result<Option<String>, String> {
    let provider = match managed_service_provider(service_id) {
        Some(value) => value,
        None => return Ok(None),
    };
    let Some(strategy) = managed_provider_strategy(provider.as_str()) else {
        return Err(format!(
            "LOCAL_AI_CAPABILITY_MISSING: serviceId={service_id} managed provider strategy not implemented provider={provider}"
        ));
    };
    if !(strategy.enabled)() {
        return Err(format!(
            "LOCAL_AI_CAPABILITY_MISSING: managed {} strategy is not enabled for serviceId={service_id}",
            strategy.provider
        ));
    }
    (strategy.start)(service_id, endpoint).map(Some)
}

pub fn stop_managed_service(service_id: &str) -> Result<Option<String>, String> {
    let provider = match managed_service_provider(service_id) {
        Some(value) => value,
        None => return Ok(None),
    };
    let Some(strategy) = managed_provider_strategy(provider.as_str()) else {
        return Err(format!(
            "LOCAL_AI_CAPABILITY_MISSING: serviceId={service_id} managed provider strategy not implemented provider={provider}"
        ));
    };
    if !(strategy.enabled)() {
        return Err(format!(
            "LOCAL_AI_CAPABILITY_MISSING: managed {} strategy is not enabled for serviceId={service_id}",
            strategy.provider
        ));
    }
    (strategy.stop)(service_id).map(Some)
}
