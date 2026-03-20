use std::net::TcpListener;
use std::process::Command;

use tauri::AppHandle;

use super::store::runtime_root_dir;
use super::types::{
    LocalAiDeviceProfile, LocalAiGpuProfile, LocalAiMemoryModel, LocalAiNpuProfile,
    LocalAiPortAvailability, LocalAiPythonProfile,
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

fn read_command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text)
}

#[cfg(target_os = "macos")]
fn parse_digits_u64(raw: &str) -> Option<u64> {
    let digits = raw
        .chars()
        .filter(|ch| ch.is_ascii_digit())
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u64>().ok()
}

#[cfg(target_os = "macos")]
fn collect_memory_bytes() -> Option<(u64, u64)> {
    let total_bytes = read_command_output("sysctl", &["-n", "hw.memsize"])
        .and_then(|value| value.trim().parse::<u64>().ok())?;
    let vm_stat = read_command_output("vm_stat", &[])?;
    let page_size = vm_stat
        .lines()
        .next()
        .and_then(parse_digits_u64)
        .filter(|value| *value > 0)?;
    let mut free_pages = 0_u64;
    for line in vm_stat.lines() {
        if line.starts_with("Pages free:") || line.starts_with("Pages speculative:") {
            if let Some(value) = parse_digits_u64(line) {
                free_pages = free_pages.saturating_add(value);
            }
        }
    }
    Some((total_bytes, free_pages.saturating_mul(page_size)))
}

#[cfg(target_os = "linux")]
fn collect_memory_bytes() -> Option<(u64, u64)> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb: Option<u64> = None;
    let mut available_kb: Option<u64> = None;
    let mut free_kb: Option<u64> = None;
    for line in meminfo.lines() {
        if line.starts_with("MemTotal:") {
            total_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok());
        } else if line.starts_with("MemAvailable:") {
            available_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok());
        } else if line.starts_with("MemFree:") {
            free_kb = line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u64>().ok());
        }
    }
    Some((
        total_kb?.saturating_mul(1024),
        available_kb.or(free_kb)?.saturating_mul(1024),
    ))
}

#[cfg(target_os = "windows")]
fn collect_memory_bytes() -> Option<(u64, u64)> {
    let raw = read_command_output(
        "powershell",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$os=Get-CimInstance Win32_OperatingSystem; \"$($os.TotalVisibleMemorySize) $($os.FreePhysicalMemory)\"",
        ],
    )?;
    let values = raw
        .split_whitespace()
        .filter_map(|item| item.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 2 {
        return None;
    }
    Some((
        values[0].saturating_mul(1024),
        values[1].saturating_mul(1024),
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_memory_bytes() -> Option<(u64, u64)> {
    None
}

fn collect_gpu_profile() -> LocalAiGpuProfile {
    if let Some(raw) = read_command_output(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total,memory.free",
            "--format=csv,noheader,nounits",
        ],
    ) {
        if let Some(first_row) = raw.lines().find(|line| !line.trim().is_empty()) {
            let columns = first_row
                .split(',')
                .map(|item| item.trim())
                .collect::<Vec<_>>();
            let total_vram_bytes = columns
                .get(1)
                .and_then(|value| value.parse::<u64>().ok())
                .map(|value| value.saturating_mul(1024 * 1024));
            let available_vram_bytes = columns
                .get(2)
                .and_then(|value| value.parse::<u64>().ok())
                .map(|value| value.saturating_mul(1024 * 1024));
            return LocalAiGpuProfile {
                available: true,
                vendor: Some("NVIDIA".to_string()),
                model: columns
                    .first()
                    .map(|value| (*value).to_string())
                    .filter(|value| !value.is_empty()),
                total_vram_bytes,
                available_vram_bytes,
                memory_model: LocalAiMemoryModel::Discrete,
            };
        }
    }

    #[cfg(target_os = "macos")]
    {
        let model = read_command_output("sysctl", &["-n", "machdep.cpu.brand_string"])
            .or_else(|| read_command_output("sysctl", &["-n", "machdep.cpu.brand_string"]));
        if let Some((total_ram_bytes, available_ram_bytes)) = collect_memory_bytes() {
            return LocalAiGpuProfile {
                available: true,
                vendor: Some("Apple".to_string()),
                model: model.filter(|value| !value.trim().is_empty()),
                total_vram_bytes: Some(total_ram_bytes),
                available_vram_bytes: Some(available_ram_bytes),
                memory_model: LocalAiMemoryModel::Unified,
            };
        }
    }

    LocalAiGpuProfile {
        available: false,
        vendor: None,
        model: None,
        total_vram_bytes: None,
        available_vram_bytes: None,
        memory_model: LocalAiMemoryModel::Unknown,
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

#[cfg(not(target_os = "windows"))]
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
    let (total_ram_bytes, available_ram_bytes) = collect_memory_bytes().unwrap_or((0, 0));
    LocalAiDeviceProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        total_ram_bytes,
        available_ram_bytes,
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
    let (total_ram_bytes, available_ram_bytes) = collect_memory_bytes().unwrap_or((0, 0));
    LocalAiDeviceProfile {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        total_ram_bytes,
        available_ram_bytes,
        gpu: collect_gpu_profile(),
        python: collect_python_profile(),
        npu: collect_npu_profile(),
        disk_free_bytes: collect_disk_free_bytes_for_runtime_root(runtime_root.as_deref()),
        ports: collect_ports(),
    }
}
