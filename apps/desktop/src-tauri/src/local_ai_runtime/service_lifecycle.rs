use super::engine_pack::{ensure_localai_binary, ensure_nexa_binary};
use super::reason_codes::{
    normalize_local_ai_reason_code, LOCAL_AI_PROVIDER_INTERNAL_ERROR, LOCAL_AI_PROVIDER_TIMEOUT,
    LOCAL_AI_SERVICE_UNREACHABLE,
};
use super::service_artifacts::{find_service_artifact, service_artifact_registry};
use super::types::{
    now_iso_timestamp, LocalAiDependencyKind, LocalAiDeviceProfile, LocalAiPreflightDecision,
    LocalAiServiceArtifact, LocalAiServiceArtifactType, LocalAiServiceDescriptor,
    LocalAiServiceStatus, DEFAULT_LOCAL_RUNTIME_ENDPOINT,
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
type ManagedStrategyBootstrapFn = fn(&LocalAiServiceArtifact, &str) -> Result<Option<String>, String>;
type ManagedStrategyEnabledFn = fn() -> bool;

#[derive(Clone, Copy)]
struct ManagedProviderStrategy {
    provider: &'static str,
    enabled: ManagedStrategyEnabledFn,
    start: ManagedStrategyStartFn,
    stop: ManagedStrategyStopFn,
    bootstrap: ManagedStrategyBootstrapFn,
}

fn normalize_non_empty(value: Option<&str>) -> Option<String> {
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
    if let Some(value) = normalize_non_empty(std::env::var(LOCALAI_RUNTIME_API_KEY_ENV).ok().as_deref()) {
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

fn managed_service_provider(service_id: &str) -> Option<String> {
    find_service_artifact(service_id)
        .and_then(|artifact| managed_service_provider_from_artifact(&artifact))
}

fn managed_service_artifact(
    service_id: &str,
    provider: &str,
) -> Result<LocalAiServiceArtifact, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let resolved_provider = managed_service_provider_from_artifact(&artifact)
        .unwrap_or_else(|| "unknown".to_string());
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

fn managed_provider_strategy(provider: &str) -> Option<ManagedProviderStrategy> {
    let normalized = provider.trim().to_ascii_lowercase();
    managed_provider_strategies()
        .into_iter()
        .find(|strategy| strategy.provider.eq_ignore_ascii_case(normalized.as_str()))
}

fn bootstrap_marker_provider(marker: &str) -> Option<&'static str> {
    if marker.eq_ignore_ascii_case("engine-pack:localai") {
        return Some("localai");
    }
    if marker.eq_ignore_ascii_case("engine-pack:nexa") {
        return Some("nexa");
    }
    None
}

fn parse_version_parts(version: &str) -> Option<(u32, u32)> {
    let mut iter = version
        .trim()
        .split('.')
        .map(|item| item.trim().parse::<u32>().ok());
    let major = iter.next().flatten()?;
    let minor = iter.next().flatten().unwrap_or(0);
    Some((major, minor))
}

fn port_available(profile: &LocalAiDeviceProfile, port: u16) -> bool {
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

fn default_loopback_endpoint_for_artifact(artifact: &LocalAiServiceArtifact) -> String {
    if let Some(port) = preflight_port_hint(artifact) {
        return format!("http://127.0.0.1:{port}/v1");
    }
    DEFAULT_LOCAL_RUNTIME_ENDPOINT.to_string()
}

fn resolve_effective_endpoint(
    artifact: &LocalAiServiceArtifact,
    endpoint: Option<&str>,
) -> Option<String> {
    let explicit = normalize_non_empty(endpoint);
    if explicit.is_some() {
        return explicit;
    }
    Some(default_loopback_endpoint_for_artifact(artifact))
}

pub fn normalize_service_descriptor(descriptor: &mut LocalAiServiceDescriptor) {
    let Some(artifact) = find_service_artifact(descriptor.service_id.as_str())
        .or_else(|| find_service_artifact(descriptor.engine.as_str()))
    else {
        return;
    };
    if descriptor.engine.trim().is_empty() {
        descriptor.engine = artifact.engine.clone();
    }
    if descriptor.artifact_type.is_none() {
        descriptor.artifact_type = Some(artifact.artifact_type.clone());
    }
    if descriptor.endpoint.as_deref().unwrap_or_default().trim().is_empty()
        && artifact.artifact_type == LocalAiServiceArtifactType::AttachedEndpoint
    {
        descriptor.endpoint = Some(default_loopback_endpoint_for_artifact(&artifact));
    }
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

fn is_loopback_endpoint(endpoint: &str) -> bool {
    let normalized = endpoint.trim();
    if normalized.is_empty() {
        return false;
    }
    if let Ok(url) = reqwest::Url::parse(normalized) {
        return url
            .host_str()
            .map(is_loopback_host)
            .unwrap_or(false);
    }
    false
}

fn build_service_health_url(endpoint: &str, health_endpoint: &str) -> Result<String, String> {
    let endpoint = normalize_non_empty(Some(endpoint))
        .ok_or_else(|| "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: service endpoint is missing".to_string())?;
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

fn maybe_authenticate_request(
    request: reqwest::blocking::RequestBuilder,
    service_id: &str,
) -> reqwest::blocking::RequestBuilder {
    if managed_service_provider(service_id).as_deref() == Some("localai") {
        let api_key = resolve_or_initialize_runtime_api_key();
        if !api_key.trim().is_empty() {
            return request.bearer_auth(api_key.clone()).header("X-Api-Key", api_key);
        }
    }
    request
}

fn parse_endpoint_host_port(endpoint: &str) -> Result<(String, u16), String> {
    let normalized = normalize_non_empty(Some(endpoint))
        .ok_or_else(|| "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: service endpoint is missing".to_string())?;
    let url = reqwest::Url::parse(normalized.as_str())
        .map_err(|error| format!("LOCAL_AI_SERVICE_ENDPOINT_INVALID: invalid endpoint URL: {error}"))?;
    let host = url
        .host_str()
        .ok_or_else(|| "LOCAL_AI_SERVICE_ENDPOINT_INVALID: endpoint host is required".to_string())?;
    if !is_loopback_host(host) {
        return Err(format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: endpoint host must be loopback: {host}"
        ));
    }
    let port = url
        .port_or_known_default()
        .filter(|value| *value > 0)
        .ok_or_else(|| "LOCAL_AI_SERVICE_ENDPOINT_INVALID: endpoint port is required".to_string())?;
    Ok(("127.0.0.1".to_string(), port))
}

fn normalize_managed_error(error: String, fallback: &str) -> String {
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
    let mut registry = localai_process_registry()
        .lock()
        .map_err(|_| "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string())?;
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
    let mut registry = localai_process_registry()
        .lock()
        .map_err(|_| "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string())?;
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
        let last_error = match probe_service_endpoint_health(service_id, endpoint) {
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
        format!(
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: failed to start managed localai binary: {error}"
        )
    })?;
    {
        let mut registry = localai_process_registry()
            .lock()
            .map_err(|_| "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string())?;
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
    let bootstrap = ensure_nexa_binary().map_err(|error| {
        normalize_managed_error(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR)
    })?;
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

    let bootstrap = ensure_nexa_binary().map_err(|error| {
        normalize_managed_error(error, LOCAL_AI_PROVIDER_INTERNAL_ERROR)
    })?;
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
        let mut registry = localai_process_registry()
            .lock()
            .map_err(|_| "LOCAL_AI_PROVIDER_INTERNAL_ERROR: process registry lock poisoned".to_string())?;
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

pub fn start_managed_service(
    service_id: &str,
    endpoint: &str,
) -> Result<Option<String>, String> {
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

fn evaluate_preflight_check(
    check: &str,
    reason_code: &str,
    params: Option<&serde_json::Value>,
    endpoint: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> LocalAiPreflightDecision {
    let normalized = check.trim().to_ascii_lowercase();
    if normalized == "python-version" {
        let min_version = params
            .and_then(|value| value.get("minVersion"))
            .and_then(|value| value.as_str())
            .unwrap_or("3.10");
        let has_python = profile.python.available;
        let current = profile.python.version.clone().unwrap_or_default();
        let ok = has_python
            && match (parse_version_parts(current.as_str()), parse_version_parts(min_version)) {
                (Some((major, minor)), Some((min_major, min_minor))) => {
                    major > min_major || (major == min_major && minor >= min_minor)
                }
                _ => false,
            };
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!("python-version check passed: current={current}, min={min_version}")
            } else {
                format!("python-version check failed: current={current}, min={min_version}")
            },
        };
    }
    if normalized == "nvidia-gpu" {
        let vendor = profile.gpu.vendor.clone().unwrap_or_default();
        let ok = profile.gpu.available && vendor.to_ascii_lowercase().contains("nvidia");
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!(
                    "nvidia-gpu check passed: vendor={}, model={}",
                    vendor,
                    profile.gpu.model.clone().unwrap_or_default()
                )
            } else {
                format!(
                    "nvidia-gpu check failed: vendor={}, available={}",
                    vendor,
                    profile.gpu.available
                )
            },
        };
    }
    if normalized == "port-available" {
        let port = params
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u16;
        let ok = port > 0 && port_available(profile, port);
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!("port-available check passed: port={port}")
            } else {
                format!("port-available check failed: port={port}")
            },
        };
    }
    if normalized == "disk-space" {
        let min_bytes = params
            .and_then(|value| value.get("minBytes"))
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let ok = profile.disk_free_bytes >= min_bytes;
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!(
                    "disk-space check passed: freeBytes={} requiredBytes={min_bytes}",
                    profile.disk_free_bytes
                )
            } else {
                format!(
                    "disk-space check failed: freeBytes={} requiredBytes={min_bytes}",
                    profile.disk_free_bytes
                )
            },
        };
    }
    if normalized == "endpoint-loopback" {
        let endpoint = normalize_non_empty(endpoint).unwrap_or_default();
        let ok = is_loopback_endpoint(endpoint.as_str());
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!("endpoint-loopback check passed: endpoint={endpoint}")
            } else if endpoint.is_empty() {
                "endpoint-loopback check failed: endpoint is required".to_string()
            } else {
                format!("endpoint-loopback check failed: endpoint={endpoint}")
            },
        };
    }

    LocalAiPreflightDecision {
        dependency_id: None,
        target: "service".to_string(),
        check: check.to_string(),
        ok: true,
        reason_code: "LOCAL_AI_PREFLIGHT_OK".to_string(),
        detail: "unknown preflight check skipped".to_string(),
    }
}

pub fn preflight_service_artifact(
    dependency_id: Option<&str>,
    service_id: &str,
    endpoint: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> Result<Vec<LocalAiPreflightDecision>, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let effective_endpoint = resolve_effective_endpoint(&artifact, endpoint);
    let mut decisions = Vec::<LocalAiPreflightDecision>::new();
    for rule in artifact.preflight {
        let mut decision = evaluate_preflight_check(
            rule.check.as_str(),
            rule.reason_code.as_str(),
            rule.params.as_ref(),
            effective_endpoint.as_deref(),
            profile,
        );
        decision.dependency_id = dependency_id.map(|value| value.to_string());
        decisions.push(decision);
    }
    Ok(decisions)
}

pub fn resolve_node_host_service(node_id: &str) -> Option<(String, String)> {
    let normalized_node_id = node_id.trim();
    if normalized_node_id.is_empty() {
        return None;
    }
    for artifact in service_artifact_registry() {
        for node in artifact.nodes {
            if node
                .node_id
                .trim()
                .eq_ignore_ascii_case(normalized_node_id)
            {
                return Some((artifact.service_id, node.capability));
            }
        }
    }
    None
}

pub fn preflight_dependency(
    dependency_id: Option<&str>,
    kind: &LocalAiDependencyKind,
    service_id: Option<&str>,
    engine: Option<&str>,
    node_id: Option<&str>,
    workflow_id: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> Result<Vec<LocalAiPreflightDecision>, String> {
    if *kind == LocalAiDependencyKind::Service {
        let service_id = normalize_non_empty(service_id).ok_or_else(|| {
            "LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING: selected service dependency missing serviceId"
                .to_string()
        })?;
        return preflight_service_artifact(dependency_id, service_id.as_str(), None, profile);
    }

    if *kind == LocalAiDependencyKind::Model {
        let engine =
            normalize_non_empty(engine).unwrap_or_else(|| "localai".to_string());
        if let Some(artifact) = find_service_artifact(engine.as_str()) {
            return preflight_service_artifact(
                dependency_id,
                artifact.service_id.as_str(),
                None,
                profile,
            );
        }
    }

    if *kind == LocalAiDependencyKind::Node {
        let node_id = normalize_non_empty(node_id).ok_or_else(|| {
            "LOCAL_AI_DEPENDENCY_NODE_ID_MISSING: selected node dependency missing nodeId"
                .to_string()
        })?;
        let mapped_service = resolve_node_host_service(node_id.as_str());
        let resolved_service_id = if let Some(explicit_service_id) = normalize_non_empty(service_id)
        {
            if let Some((artifact_service_id, _)) = mapped_service.as_ref() {
                if !artifact_service_id.eq_ignore_ascii_case(explicit_service_id.as_str()) {
                    return Err(format!(
                        "LOCAL_AI_NODE_SERVICE_MISMATCH: nodeId={} dependencyServiceId={} artifactServiceId={}",
                        node_id, explicit_service_id, artifact_service_id
                    ));
                }
            }
            explicit_service_id
        } else if let Some((artifact_service_id, _)) = mapped_service {
            artifact_service_id
        } else {
            return Err(format!(
                "LOCAL_AI_NODE_SERVICE_REQUIRED: nodeId={} requires serviceId or catalog mapping",
                node_id
            ));
        };
        return preflight_service_artifact(
            dependency_id,
            resolved_service_id.as_str(),
            None,
            profile,
        );
    }

    if *kind == LocalAiDependencyKind::Workflow {
        let workflow_id = normalize_non_empty(workflow_id).ok_or_else(|| {
            "LOCAL_AI_DEPENDENCY_WORKFLOW_ID_MISSING: selected workflow dependency missing workflowId"
                .to_string()
        })?;
        return Ok(vec![LocalAiPreflightDecision {
            dependency_id: dependency_id.map(|value| value.to_string()),
            target: "workflow".to_string(),
            check: "workflow-declaration".to_string(),
            ok: true,
            reason_code: "LOCAL_AI_PREFLIGHT_OK".to_string(),
            detail: format!("workflow dependency declared: workflowId={workflow_id}"),
        }]);
    }

    Ok(Vec::new())
}

pub fn build_service_descriptor(
    service_id: &str,
    title: Option<&str>,
    endpoint: Option<&str>,
    capabilities: &[String],
    local_model_id: Option<&str>,
) -> Result<LocalAiServiceDescriptor, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let now = now_iso_timestamp();
    let title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| service_id.to_string());
    let endpoint = resolve_effective_endpoint(&artifact, endpoint);
    if artifact.artifact_type == LocalAiServiceArtifactType::AttachedEndpoint
        && endpoint.as_deref().unwrap_or_default().trim().is_empty()
    {
        return Err(format!(
            "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={} requires endpoint for attached-endpoint artifact",
            service_id
        ));
    }
    let local_model_id = local_model_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(LocalAiServiceDescriptor {
        service_id: service_id.to_string(),
        title,
        engine: artifact.engine,
        artifact_type: Some(artifact.artifact_type),
        endpoint,
        capabilities: capabilities.to_vec(),
        local_model_id,
        status: LocalAiServiceStatus::Installed,
        detail: Some("service installed".to_string()),
        installed_at: now.clone(),
        updated_at: now,
    })
}

pub fn bootstrap_service_artifact(service_id: &str) -> Result<Option<String>, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let marker = artifact
        .install
        .bootstrap
        .as_deref()
        .map(|value| value.trim())
        .unwrap_or_default();
    if marker.is_empty() {
        return Ok(None);
    }
    if let Some(provider) = bootstrap_marker_provider(marker) {
        let Some(strategy) = managed_provider_strategy(provider) else {
            return Err(format!(
                "LOCAL_AI_CAPABILITY_MISSING: unsupported bootstrap marker serviceId={} marker={marker}",
                artifact.service_id
            ));
        };
        if !(strategy.enabled)() {
            return Err(format!(
                "LOCAL_AI_CAPABILITY_MISSING: bootstrap marker requires enabled {} strategy serviceId={} marker={marker}",
                strategy.provider, artifact.service_id
            ));
        }
        return (strategy.bootstrap)(&artifact, marker);
    }
    if marker.eq_ignore_ascii_case("python-venv") {
        return Ok(Some(format!(
            "python bootstrap marker acknowledged: serviceId={}",
            artifact.service_id
        )));
    }
    Err(format!(
        "LOCAL_AI_CAPABILITY_MISSING: unsupported bootstrap marker serviceId={} marker={marker}",
        artifact.service_id
    ))
}

pub fn probe_service_endpoint_health(service_id: &str, endpoint: &str) -> Result<String, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let effective_endpoint = resolve_effective_endpoint(&artifact, Some(endpoint))
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={service_id}"))?;
    let health_url = build_service_health_url(
        effective_endpoint.as_str(),
        artifact.health.endpoint.as_str(),
    )?;
    let timeout_ms = artifact.health.timeout_ms.clamp(250, 10_000);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            format!(
                "LOCAL_AI_SERVICE_HEALTH_HTTP_CLIENT_FAILED: serviceId={} error={error}",
                artifact.service_id
            )
        })?;
    let request = maybe_authenticate_request(client.get(health_url.as_str()), artifact.service_id.as_str());
    match request.send() {
        Ok(response) if response.status().is_success() => Ok(format!(
            "service endpoint healthy: serviceId={} endpoint={}",
            artifact.service_id, health_url
        )),
        Ok(response) => Err(format!(
            "LOCAL_AI_SERVICE_HEALTH_UNREACHABLE: serviceId={} endpoint={} status={}",
            artifact.service_id,
            health_url,
            response.status().as_u16()
        )),
        Err(error) => Err(format!(
            "LOCAL_AI_SERVICE_HEALTH_UNREACHABLE: serviceId={} endpoint={} error={error}",
            artifact.service_id, health_url
        )),
    }
}

pub fn probe_service_capability_models(
    service_id: &str,
    endpoint: &str,
) -> Result<serde_json::Value, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let probe_endpoint = artifact
        .health
        .capability_probe_endpoint
        .as_deref()
        .unwrap_or("/v1/models");
    let effective_endpoint = resolve_effective_endpoint(&artifact, Some(endpoint))
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={service_id}"))?;
    let probe_url = build_service_health_url(effective_endpoint.as_str(), probe_endpoint)?;
    let timeout_ms = artifact.health.timeout_ms.clamp(250, 10_000);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            format!(
                "LOCAL_AI_SERVICE_HEALTH_HTTP_CLIENT_FAILED: serviceId={} error={error}",
                artifact.service_id
            )
        })?;

    let request = maybe_authenticate_request(client.get(probe_url.as_str()), artifact.service_id.as_str());
    let response = request.send().map_err(|error| {
        format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: serviceId={} endpoint={} error={error}",
            artifact.service_id, probe_url
        )
    })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(format!(
            "LOCAL_AI_AUTH_FAILED: serviceId={} endpoint={} status={}",
            artifact.service_id,
            probe_url,
            response.status().as_u16()
        ));
    }
    if !response.status().is_success() {
        return Err(format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: serviceId={} endpoint={} status={}",
            artifact.service_id,
            probe_url,
            response.status().as_u16()
        ));
    }
    let body = response.text().map_err(|error| {
        format!(
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: serviceId={} endpoint={} error={error}",
            artifact.service_id, probe_url
        )
    })?;
    serde_json::from_str::<serde_json::Value>(body.as_str()).map_err(|error| {
        format!(
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: serviceId={} endpoint={} error={error}",
            artifact.service_id, probe_url
        )
    })
}
