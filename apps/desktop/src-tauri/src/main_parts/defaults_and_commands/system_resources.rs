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

fn read_command_output(program: &str, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(program)
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

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn parse_df_root_bytes(raw: &str) -> Option<(u64, u64)> {
    let row = raw.lines().skip(1).find(|line| !line.trim().is_empty())?;
    let columns = row.split_whitespace().collect::<Vec<_>>();
    if columns.len() < 3 {
        return None;
    }
    let total_bytes = columns[1].parse::<u64>().ok()?.saturating_mul(1024);
    let used_bytes = columns[2].parse::<u64>().ok()?.saturating_mul(1024);
    Some((used_bytes, total_bytes))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn collect_disk_usage_bytes() -> Option<(u64, u64)> {
    let output = read_command_output("df", &["-Pk", "/"])?;
    parse_df_root_bytes(output.as_str())
}

#[cfg(target_os = "macos")]
fn collect_cpu_percent() -> Option<f64> {
    let ps_output = read_command_output("ps", &["-A", "-o", "%cpu"])?;
    let sum_cpu = ps_output
        .lines()
        .skip(1)
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .sum::<f64>();
    let cpu_count = read_command_output("sysctl", &["-n", "hw.ncpu"])
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| *value > 0.0)
        .unwrap_or(1.0);
    Some((sum_cpu / cpu_count).clamp(0.0, 100.0))
}

#[cfg(target_os = "macos")]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
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

    let free_bytes = free_pages.saturating_mul(page_size);
    let used_bytes = total_bytes.saturating_sub(free_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "macos")]
fn collect_temperature_celsius() -> Option<f64> {
    None
}

#[cfg(target_os = "linux")]
fn read_proc_stat_cpu_totals() -> Option<(u64, u64)> {
    let content = std::fs::read_to_string("/proc/stat").ok()?;
    let cpu_line = content.lines().next()?;
    let mut parts = cpu_line.split_whitespace();
    if parts.next()? != "cpu" {
        return None;
    }

    let mut values = Vec::<u64>::new();
    for item in parts {
        if let Ok(parsed) = item.parse::<u64>() {
            values.push(parsed);
        }
    }
    if values.len() < 4 {
        return None;
    }

    let idle = values.get(3).copied().unwrap_or(0);
    let io_wait = values.get(4).copied().unwrap_or(0);
    let idle_total = idle.saturating_add(io_wait);
    let total = values.into_iter().sum::<u64>();
    Some((idle_total, total))
}

#[cfg(target_os = "linux")]
fn collect_cpu_percent() -> Option<f64> {
    let (idle_a, total_a) = read_proc_stat_cpu_totals()?;
    std::thread::sleep(Duration::from_millis(120));
    let (idle_b, total_b) = read_proc_stat_cpu_totals()?;

    let idle_delta = idle_b.saturating_sub(idle_a);
    let total_delta = total_b.saturating_sub(total_a);
    if total_delta == 0 {
        return None;
    }

    let usage = 100.0 * (1.0 - (idle_delta as f64 / total_delta as f64));
    Some(usage.clamp(0.0, 100.0))
}

#[cfg(target_os = "linux")]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
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

    let total_bytes = total_kb?.saturating_mul(1024);
    let available_bytes = available_kb.or(free_kb)?.saturating_mul(1024);
    let used_bytes = total_bytes.saturating_sub(available_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "linux")]
fn collect_temperature_celsius() -> Option<f64> {
    let candidates = std::fs::read_dir("/sys/class/thermal").ok()?;
    for entry in candidates.filter_map(Result::ok) {
        let path = entry.path().join("temp");
        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        let milli_c = raw.trim().parse::<f64>().ok()?;
        if milli_c <= 0.0 {
            continue;
        }
        let celsius = milli_c / 1000.0;
        if celsius.is_finite() && celsius > 0.0 && celsius < 150.0 {
            return Some(celsius);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn read_powershell_output(script: &str) -> Option<String> {
    read_command_output(
        "powershell",
        &[
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
    )
}

#[cfg(target_os = "windows")]
fn collect_cpu_percent() -> Option<f64> {
    let raw = read_powershell_output(
        "(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples.CookedValue",
    )?;
    raw.lines()
        .find_map(|line| line.trim().parse::<f64>().ok())
        .map(|value| value.clamp(0.0, 100.0))
}

#[cfg(target_os = "windows")]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
    let raw = read_powershell_output(
        "$os=Get-CimInstance Win32_OperatingSystem; \"$($os.TotalVisibleMemorySize) $($os.FreePhysicalMemory)\"",
    )?;
    let values = raw
        .split_whitespace()
        .filter_map(|item| item.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 2 {
        return None;
    }
    let total_bytes = values[0].saturating_mul(1024);
    let free_bytes = values[1].saturating_mul(1024);
    let used_bytes = total_bytes.saturating_sub(free_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "windows")]
fn collect_disk_usage_bytes() -> Option<(u64, u64)> {
    let raw = read_powershell_output(
        "$d=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='C:'\"; \"$($d.Size) $($d.FreeSpace)\"",
    )?;
    let values = raw
        .split_whitespace()
        .filter_map(|item| item.parse::<u64>().ok())
        .collect::<Vec<_>>();
    if values.len() < 2 {
        return None;
    }
    let total_bytes = values[0];
    let free_bytes = values[1];
    let used_bytes = total_bytes.saturating_sub(free_bytes.min(total_bytes));
    Some((used_bytes, total_bytes))
}

#[cfg(target_os = "windows")]
fn collect_temperature_celsius() -> Option<f64> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_cpu_percent() -> Option<f64> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_memory_usage_bytes() -> Option<(u64, u64)> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_disk_usage_bytes() -> Option<(u64, u64)> {
    None
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn collect_temperature_celsius() -> Option<f64> {
    None
}

fn collect_system_resource_snapshot() -> SystemResourceSnapshot {
    let cpu_percent = collect_cpu_percent().unwrap_or(0.0);
    let (memory_used_bytes, memory_total_bytes) = collect_memory_usage_bytes().unwrap_or((0, 0));
    let (disk_used_bytes, disk_total_bytes) = collect_disk_usage_bytes().unwrap_or((0, 0));
    let temperature_celsius = collect_temperature_celsius();
    let source = if cpu_percent > 0.0 || memory_total_bytes > 0 || disk_total_bytes > 0 {
        format!("tauri-{}", std::env::consts::OS)
    } else {
        "tauri-fallback".to_string()
    };

    SystemResourceSnapshot {
        cpu_percent,
        memory_used_bytes,
        memory_total_bytes,
        disk_used_bytes,
        disk_total_bytes,
        temperature_celsius,
        captured_at_ms: u64::try_from(now_ms()).unwrap_or(u64::MAX),
        source,
    }
}

#[tauri::command]
fn get_system_resource_snapshot() -> SystemResourceSnapshot {
    collect_system_resource_snapshot()
}
