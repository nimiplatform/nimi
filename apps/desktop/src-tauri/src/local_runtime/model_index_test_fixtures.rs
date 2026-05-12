use super::*;
use crate::local_runtime::types::{
    LocalAiGpuProfile, LocalAiMemoryModel, LocalAiNpuProfile, LocalAiPortAvailability,
    LocalAiPythonProfile,
};

pub(super) fn profile_fixture() -> LocalAiDeviceProfile {
    LocalAiDeviceProfile {
        os: "darwin".to_string(),
        arch: "arm64".to_string(),
        total_ram_bytes: 64 * 1024 * 1024 * 1024,
        available_ram_bytes: 48 * 1024 * 1024 * 1024,
        gpu: LocalAiGpuProfile {
            available: true,
            vendor: Some("Apple".to_string()),
            model: Some("M4 Max".to_string()),
            total_vram_bytes: None,
            available_vram_bytes: None,
            memory_model: LocalAiMemoryModel::Unified,
        },
        python: LocalAiPythonProfile {
            available: false,
            version: None,
        },
        npu: LocalAiNpuProfile {
            available: false,
            ready: false,
            vendor: None,
            runtime: None,
            detail: None,
        },
        disk_free_bytes: 0,
        ports: vec![LocalAiPortAvailability {
            port: 1234,
            available: true,
        }],
    }
}

pub(super) fn chat_item(repo: &str, title: &str, entry: &str, size_bytes: u64) -> RemoteModelEntry {
    RemoteModelEntry {
        repo: repo.to_string(),
        revision: "main".to_string(),
        title: title.to_string(),
        description: None,
        capabilities: vec!["chat".to_string()],
        tags: vec!["chat".to_string(), "gguf".to_string()],
        formats: vec!["gguf".to_string()],
        downloads: Some(100),
        likes: Some(10),
        last_modified: Some("2026-03-17T10:00:00Z".to_string()),
        entries: vec![RemoteInstallEntry {
            entry_id: format!("gguf:{entry}"),
            format: "gguf".to_string(),
            entry: entry.to_string(),
            files: vec![RemoteModelFile {
                path: entry.to_string(),
                size_bytes,
                sha256: Some(format!("sha256:{entry}")),
            }],
            total_size_bytes: size_bytes,
            sha256: Some(format!("sha256:{entry}")),
        }],
    }
}
