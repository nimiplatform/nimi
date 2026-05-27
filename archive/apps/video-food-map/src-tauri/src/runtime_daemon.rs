use serde::Deserialize;
use std::env;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

const DEFAULT_GRPC_ADDR: &str = "127.0.0.1:46371";
const DEFAULT_RUNTIME_BINARY: &str = "nimi";
const DEFAULT_RUNTIME_MODE: &str = "RUNTIME";

static DAEMON_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFileConfig {
    grpc_addr: Option<String>,
}

#[derive(Debug, Clone)]
struct RuntimeCommandSpec {
    program: String,
    args: Vec<String>,
    current_dir: Option<PathBuf>,
}

fn daemon_child() -> &'static Mutex<Option<Child>> {
    DAEMON_CHILD.get_or_init(|| Mutex::new(None))
}

fn normalize_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn read_non_empty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .and_then(|value| normalize_non_empty(value.as_str()))
}

fn expand_home_path(raw: &str) -> PathBuf {
    if raw == "~" {
        if let Some(home) = read_non_empty_env("HOME") {
            return PathBuf::from(home);
        }
        return PathBuf::from(raw);
    }
    if !raw.starts_with("~/") {
        return PathBuf::from(raw);
    }
    if let Some(home) = read_non_empty_env("HOME") {
        return PathBuf::from(home).join(raw.trim_start_matches("~/"));
    }
    PathBuf::from(raw)
}

fn runtime_config_path() -> Option<PathBuf> {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_CONFIG_PATH") {
        return Some(expand_home_path(value.as_str()));
    }
    Some(
        crate::desktop_paths::resolve_nimi_dir()
            .ok()?
            .join("config.json"),
    )
}

fn runtime_file_config() -> Option<RuntimeFileConfig> {
    let path = runtime_config_path()?;
    let content = fs::read(path).ok()?;
    if content.is_empty() {
        return None;
    }
    serde_json::from_slice::<RuntimeFileConfig>(&content).ok()
}

pub fn grpc_addr() -> String {
    if let Some(value) = read_non_empty_env("NIMI_RUNTIME_GRPC_ADDR") {
        return value;
    }
    if let Some(value) = runtime_file_config()
        .and_then(|config| config.grpc_addr)
        .and_then(|value| normalize_non_empty(value.as_str()))
    {
        return value;
    }
    DEFAULT_GRPC_ADDR.to_string()
}

fn probe_running(addr: &str) -> bool {
    let parsed = match addr.parse::<SocketAddr>() {
        Ok(value) => value,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&parsed, Duration::from_millis(150)).is_ok()
}

fn wait_until_running(addr: &str) -> bool {
    for _ in 0..120 {
        if probe_running(addr) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn runtime_binary() -> String {
    read_non_empty_env("NIMI_RUNTIME_BINARY").unwrap_or_else(|| DEFAULT_RUNTIME_BINARY.to_string())
}

fn runtime_dev_root_dir() -> Option<PathBuf> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../runtime");
    if root.exists() {
        Some(root)
    } else {
        None
    }
}

fn is_executable_available(name: &str) -> bool {
    if name.contains(std::path::MAIN_SEPARATOR) || name.contains('/') || name.contains('\\') {
        return Path::new(name).exists();
    }

    let Some(raw_path) = env::var_os("PATH") else {
        return false;
    };

    for dir in env::split_paths(&raw_path) {
        let candidate = dir.join(name);
        if candidate.exists() {
            return true;
        }
    }

    false
}

fn normalize_path_env() -> String {
    let base = env::var("PATH").unwrap_or_default();
    let mut prefixes = vec![
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    if !base.trim().is_empty() {
        prefixes.push(base);
    }
    prefixes.join(":")
}

fn runtime_command_spec() -> Result<RuntimeCommandSpec, String> {
    let mode = read_non_empty_env("NIMI_RUNTIME_BRIDGE_MODE")
        .unwrap_or_else(|| DEFAULT_RUNTIME_MODE.to_string())
        .to_ascii_uppercase();
    if mode == "RUNTIME" {
        if !is_executable_available("go") {
            return Err("本地 runtime 启动失败：当前环境里找不到 go。".to_string());
        }
        let runtime_dir = runtime_dev_root_dir()
            .ok_or_else(|| "本地 runtime 启动失败：仓库里的 runtime 目录不存在。".to_string())?;
        return Ok(RuntimeCommandSpec {
            program: "go".to_string(),
            args: vec![
                "run".to_string(),
                "./cmd/nimi".to_string(),
                "serve".to_string(),
            ],
            current_dir: Some(runtime_dir),
        });
    }

    let binary = runtime_binary();
    if !is_executable_available(binary.as_str()) {
        return Err(format!(
            "本地 runtime 启动失败：找不到可执行文件 `{}`。",
            binary
        ));
    }
    Ok(RuntimeCommandSpec {
        program: binary,
        args: vec!["serve".to_string()],
        current_dir: None,
    })
}

pub fn ensure_running() -> Result<String, String> {
    let grpc = grpc_addr();
    if probe_running(grpc.as_str()) {
        return Ok(grpc);
    }

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                }
                Ok(None) => {
                    if wait_until_running(grpc.as_str()) {
                        return Ok(grpc);
                    }
                }
                Err(_) => {}
            }
        }
    }

    let spec = runtime_command_spec()?;
    let mut command = Command::new(spec.program.as_str());
    command
        .args(spec.args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .env("PATH", normalize_path_env());
    if let Some(current_dir) = spec.current_dir {
        command.current_dir(current_dir);
    }

    let child = command
        .spawn()
        .map_err(|error| format!("本地 runtime 启动失败：{error}"))?;

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        *guard = Some(child);
    }

    if wait_until_running(grpc.as_str()) {
        return Ok(grpc);
    }

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }

    Err(format!(
        "本地 runtime 没能在预期时间内启动完成（{}）。",
        grpc
    ))
}
