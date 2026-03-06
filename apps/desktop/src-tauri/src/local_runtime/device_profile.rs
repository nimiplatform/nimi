use std::net::TcpListener;
use std::process::Command;

use tauri::AppHandle;

use super::store::runtime_root_dir;
use super::types::{
    LocalAiDeviceProfile, LocalAiGpuProfile, LocalAiNpuProfile, LocalAiPortAvailability,
    LocalAiPythonProfile,
};

fn parse_python_version(raw: &str) -> Option<String> {
    let normalized = raw.trim().replace('\n', " ");
    let candidate = normalized
        .split_whitespace()
        .find(|item| item.chars().filter(|ch| *ch == '.').count() >= 1)
        .unwrap_or_default();
    let clean = candidate.trim().trim_matches(':').to_string();
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

fn collect_python_profile() -> LocalAiPythonProfile {
    let mut candidates = vec!["python3".to_string(), "python".to_string()];
    if let Ok(override_python) = std::env::var("NIMI_QWEN_PYTHON_BIN") {
        let normalized = override_python.trim().to_string();
        if !normalized.is_empty() {
            candidates.insert(0, normalized);
        }
    }

    for candidate in candidates {
        let output = Command::new(candidate.as_str())
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output();
        let Ok(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let mut text = String::from_utf8_lossy(&output.stdout).to_string();
        text.push_str(String::from_utf8_lossy(&output.stderr).as_ref());
        return LocalAiPythonProfile {
            available: true,
            version: parse_python_version(text.as_str()),
        };
    }

    LocalAiPythonProfile {
        available: false,
        version: None,
    }
}

fn collect_gpu_profile() -> LocalAiGpuProfile {
    let nvidia = Command::new("nvidia-smi")
        .arg("-L")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();
    if let Ok(output) = nvidia {
        if output.status.success() {
            let raw = String::from_utf8_lossy(&output.stdout).to_string();
            let model = raw
                .lines()
                .find(|line| line.trim().to_ascii_lowercase().contains("gpu"))
                .map(|line| line.trim().to_string())
                .filter(|line| !line.is_empty());
            return LocalAiGpuProfile {
                available: true,
                vendor: Some("NVIDIA".to_string()),
                model,
            };
        }
    }

    #[cfg(target_os = "macos")]
    {
        let chip = Command::new("sysctl")
            .arg("-n")
            .arg("machdep.cpu.brand_string")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(output) = chip {
            if output.status.success() {
                let model = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return LocalAiGpuProfile {
                    available: true,
                    vendor: Some("Apple".to_string()),
                    model: if model.is_empty() { None } else { Some(model) },
                };
            }
        }
    }

    LocalAiGpuProfile {
        available: false,
        vendor: None,
        model: None,
    }
}

fn parse_bool_env(value: Option<String>) -> Option<bool> {
    let raw = value.unwrap_or_default().trim().to_ascii_lowercase();
    if raw.is_empty() {
        return None;
    }
    if raw == "1" || raw == "true" || raw == "yes" || raw == "on" {
        return Some(true);
    }
    if raw == "0" || raw == "false" || raw == "no" || raw == "off" {
        return Some(false);
    }
    None
}

fn collect_npu_profile() -> LocalAiNpuProfile {
    let override_ready = parse_bool_env(std::env::var("NIMI_LOCAL_AI_HOST_NPU_READY").ok());
    let vendor_env = std::env::var("NIMI_LOCAL_AI_HOST_NPU_VENDOR")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let runtime_env = std::env::var("NIMI_LOCAL_AI_HOST_NPU_RUNTIME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let detail_env = std::env::var("NIMI_LOCAL_AI_HOST_NPU_DETAIL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(ready) = override_ready {
        return LocalAiNpuProfile {
            available: ready,
            ready,
            vendor: vendor_env.or(Some("env".to_string())),
            runtime: runtime_env,
            detail: detail_env.or(Some(format!(
                "npu host probe overridden via env (ready={ready})"
            ))),
        };
    }

    #[cfg(target_os = "macos")]
    {
        let output = Command::new("sysctl")
            .arg("-n")
            .arg("hw.optional.neuralengine")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let ready = raw == "1";
                return LocalAiNpuProfile {
                    available: ready,
                    ready,
                    vendor: Some("Apple".to_string()),
                    runtime: Some("ane".to_string()),
                    detail: if ready {
                        Some("Apple Neural Engine available".to_string())
                    } else {
                        Some(format!(
                            "Apple Neural Engine not reported by host (value={raw})"
                        ))
                    },
                };
            }
        }
    }

    LocalAiNpuProfile {
        available: false,
        ready: false,
        vendor: vendor_env,
        runtime: runtime_env,
        detail: detail_env.or(Some("NPU host probe unavailable".to_string())),
    }
}

fn parse_df_available_kbytes(output: &str) -> Option<u64> {
    // POSIX df -Pk output: Filesystem 1024-blocks Used Available Capacity Mounted on
    let line = output
        .lines()
        .skip(1)
        .find(|item| !item.trim().is_empty())?;
    let columns = line.split_whitespace().collect::<Vec<_>>();
    if columns.len() < 4 {
        return None;
    }
    let available_kb = columns[3].trim().parse::<u64>().ok()?;
    Some(available_kb.saturating_mul(1024))
}

fn collect_disk_free_bytes_for_runtime_root(runtime_root: Option<&str>) -> u64 {
    let runtime_root = runtime_root.unwrap_or_default().trim().to_string();
    if runtime_root.is_empty() {
        return 0;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("df")
            .arg("-Pk")
            .arg(runtime_root.as_str())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout).to_string();
                if let Some(bytes) = parse_df_available_kbytes(text.as_str()) {
                    return bytes;
                }
            }
        }
    }

    0
}

fn collect_disk_free_bytes(app: &AppHandle) -> u64 {
    let Ok(runtime_root) = runtime_root_dir(app) else {
        return 0;
    };
    let runtime_root = runtime_root.to_string_lossy().to_string();
    collect_disk_free_bytes_for_runtime_root(Some(runtime_root.as_str()))
}

fn collect_ports() -> Vec<LocalAiPortAvailability> {
    [1234_u16, 18181_u16, 38100_u16]
        .into_iter()
        .map(|port| {
            let available = TcpListener::bind(("127.0.0.1", port)).is_ok();
            LocalAiPortAvailability { port, available }
        })
        .collect::<Vec<_>>()
}

pub fn collect_device_profile(app: &AppHandle) -> LocalAiDeviceProfile {
    LocalAiDeviceProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        gpu: collect_gpu_profile(),
        python: collect_python_profile(),
        npu: collect_npu_profile(),
        disk_free_bytes: collect_disk_free_bytes(app),
        ports: collect_ports(),
    }
}

pub fn collect_device_profile_from_env() -> LocalAiDeviceProfile {
    let runtime_root = std::env::var("NIMI_LOCAL_AI_RUNTIME_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    LocalAiDeviceProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        gpu: collect_gpu_profile(),
        python: collect_python_profile(),
        npu: collect_npu_profile(),
        disk_free_bytes: collect_disk_free_bytes_for_runtime_root(runtime_root.as_deref()),
        ports: collect_ports(),
    }
}
