use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use super::channel_pool::invalidate_channel;
use super::error_map::bridge_error;

const DEFAULT_GRPC_ADDR: &str = "127.0.0.1:46371";
const DEFAULT_HTTP_ADDR: &str = "127.0.0.1:46372";
const DEFAULT_RUNTIME_BINARY: &str = "nimi";

static DAEMON_CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static DAEMON_LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeDaemonStatus {
    pub running: bool,
    pub managed: bool,
    pub grpc_addr: String,
    pub pid: Option<u32>,
    pub last_error: Option<String>,
}

fn daemon_child() -> &'static Mutex<Option<Child>> {
    DAEMON_CHILD.get_or_init(|| Mutex::new(None))
}

fn daemon_last_error() -> &'static Mutex<Option<String>> {
    DAEMON_LAST_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_last_error(value: Option<String>) {
    let mut guard = daemon_last_error()
        .lock()
        .expect("runtime daemon last-error lock poisoned");
    *guard = value;
}

fn read_last_error() -> Option<String> {
    daemon_last_error()
        .lock()
        .expect("runtime daemon last-error lock poisoned")
        .clone()
}

pub(crate) fn grpc_addr() -> String {
    std::env::var("NIMI_RUNTIME_GRPC_ADDR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_GRPC_ADDR.to_string())
}

fn http_addr() -> String {
    std::env::var("NIMI_RUNTIME_HTTP_ADDR")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_HTTP_ADDR.to_string())
}

fn runtime_binary() -> String {
    std::env::var("NIMI_RUNTIME_BINARY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_RUNTIME_BINARY.to_string())
}

fn probe_running(addr: &str) -> bool {
    let parsed = match addr.parse::<SocketAddr>() {
        Ok(value) => value,
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&parsed, Duration::from_millis(120)).is_ok()
}

fn wait_until_running(addr: &str) -> bool {
    for _ in 0..20 {
        if probe_running(addr) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

pub fn status() -> RuntimeBridgeDaemonStatus {
    let mut pid = None;
    let managed = {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_)) => {
                    *guard = None;
                    false
                }
                Ok(None) => {
                    pid = Some(child.id());
                    true
                }
                Err(_) => {
                    pid = Some(child.id());
                    true
                }
            }
        } else {
            false
        }
    };

    let addr = grpc_addr();
    let running = probe_running(addr.as_str());
    let mut last_error = read_last_error();
    if running && last_error.is_some() {
        set_last_error(None);
        last_error = None;
    }

    RuntimeBridgeDaemonStatus {
        running,
        managed,
        grpc_addr: addr,
        pid,
        last_error,
    }
}

pub fn start() -> Result<RuntimeBridgeDaemonStatus, String> {
    let current = status();
    if current.running {
        set_last_error(None);
        return Ok(current);
    }

    let binary = runtime_binary();
    let grpc = grpc_addr();
    let http = http_addr();
    let mut command = Command::new(binary.as_str());
    command
        .arg("serve")
        .arg("--grpc-addr")
        .arg(grpc.as_str())
        .arg("--http-addr")
        .arg(http.as_str())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());

    let child = command.spawn().map_err(|error| {
        let message = error.to_string();
        set_last_error(Some(message.clone()));
        bridge_error("RUNTIME_BRIDGE_DAEMON_START_FAILED", message.as_str())
    })?;

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        *guard = Some(child);
    }
    invalidate_channel();

    let ready = wait_until_running(grpc.as_str());
    if ready {
        set_last_error(None);
        return Ok(status());
    }

    let message = format!("runtime daemon did not become ready at {}", grpc);
    set_last_error(Some(message.clone()));

    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }

    Err(bridge_error(
        "RUNTIME_BRIDGE_DAEMON_START_TIMEOUT",
        message.as_str(),
    ))
}

pub fn stop() -> Result<RuntimeBridgeDaemonStatus, String> {
    {
        let mut guard = daemon_child().lock().expect("runtime daemon lock poisoned");
        if let Some(child) = guard.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *guard = None;
    }
    invalidate_channel();
    set_last_error(None);

    Ok(status())
}

pub fn restart() -> Result<RuntimeBridgeDaemonStatus, String> {
    let _ = stop()?;
    start()
}

#[cfg(test)]
mod tests {
    use super::{start, status, stop};

    fn with_env_var(name: &str, value: &str, run: impl FnOnce()) {
        let previous = std::env::var(name).ok();
        std::env::set_var(name, value);
        run();
        match previous {
            Some(old) => std::env::set_var(name, old),
            None => std::env::remove_var(name),
        }
    }

    #[test]
    fn start_failure_sets_status_last_error() {
        let _ = stop();

        with_env_var(
            "NIMI_RUNTIME_BINARY",
            "/__nimi_runtime_missing_binary__",
            || {
                with_env_var("NIMI_RUNTIME_GRPC_ADDR", "127.0.0.1:46379", || {
                    let result = start();
                    let error = result.err().unwrap_or_default();
                    assert!(error.contains("RUNTIME_BRIDGE_DAEMON_START_FAILED"));

                    let snapshot = status();
                    assert!(snapshot.last_error.is_some());
                });
            },
        );

        let _ = stop();
        let snapshot = status();
        assert!(snapshot.last_error.is_none());
    }
}
