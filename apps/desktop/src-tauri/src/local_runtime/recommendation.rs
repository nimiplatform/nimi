use llmfit_core::fit::{FitLevel as LlmFitLevel, ModelFit, RunMode as LlmRunMode};
use llmfit_core::hardware::{GpuBackend, SystemSpecs};
use llmfit_core::models::{
    quant_bpp, Capability as LlmCapability, LlmModel, ModelFormat, UseCase,
};
use serde_json::json;

use super::types::{
    CatalogVariantDescriptor, LocalAiDeviceProfile, LocalAiEngineRuntimeMode,
    LocalAiHostSupportClass, LocalAiHostSupportDescriptor, LocalAiMemoryModel,
    LocalAiProviderHints, LocalAiRecommendationBaseline, LocalAiRecommendationConfidence,
    LocalAiRecommendationDescriptor, LocalAiRecommendationFormat, LocalAiRecommendationSource,
    LocalAiRecommendationTier, LocalAiSuggestedArtifact,
};
use super::verified_artifacts::verified_artifact_list;

pub const REASON_BASELINE_IMAGE_DEFAULT_V1: &str = "baseline_image_default_v1";
pub const REASON_BASELINE_VIDEO_DEFAULT_V1: &str = "baseline_video_default_v1";
pub const REASON_ENGINE_OVERHEAD_APPLIED: &str = "engine_overhead_applied";
pub const REASON_HARD_PREREQUISITE_OVERHEAD_APPLIED: &str = "hard_prerequisite_overhead_applied";
pub const REASON_GPU_MEMORY_UNKNOWN: &str = "gpu_memory_unknown";
pub const REASON_HOST_ATTACHED_ONLY: &str = "host_attached_only";
pub const REASON_HOST_UNSUPPORTED: &str = "host_unsupported";
pub const REASON_MAIN_SIZE_UNKNOWN: &str = "main_size_unknown";
pub const REASON_METADATA_INCOMPLETE: &str = "metadata_incomplete";
pub const REASON_MEMORY_BUDGET_EXCEEDED: &str = "memory_budget_exceeded";
pub const REASON_MEMORY_HEADROOM_RECOMMENDED: &str = "memory_headroom_recommended";
pub const REASON_MEMORY_HEADROOM_RUNNABLE: &str = "memory_headroom_runnable";
pub const REASON_MEMORY_HEADROOM_TIGHT: &str = "memory_headroom_tight";
pub const REASON_SAFETENSORS_REPO_LEVEL_ESTIMATE: &str = "safetensors_repo_level_estimate";
pub const REASON_UNIFIED_MEMORY_ESTIMATE: &str = "unified_memory_estimate";
pub const REASON_VARIANT_QUANT_PARSED: &str = "variant_quant_parsed";
pub const REASON_LLMFIT_CPU_ONLY: &str = "llmfit_cpu_only";
pub const REASON_LLMFIT_CPU_OFFLOAD: &str = "llmfit_cpu_offload";
pub const REASON_LLMFIT_GPU_PATH: &str = "llmfit_gpu_path";
pub const REASON_LLMFIT_MARGINAL: &str = "llmfit_marginal";
pub const REASON_LLMFIT_MOE_OFFLOAD: &str = "llmfit_moe_offload";
pub const REASON_LLMFIT_PARAMS_FROM_FILENAME: &str = "llmfit_params_from_filename";
pub const REASON_LLMFIT_PARAMS_FROM_FILESIZE: &str = "llmfit_params_from_filesize";
pub const REASON_LLMFIT_QUANT_FROM_FILENAME: &str = "llmfit_quant_from_filename";
pub const REASON_LLMFIT_RECOMMENDED: &str = "llmfit_recommended";
pub const REASON_LLMFIT_RUNNABLE: &str = "llmfit_runnable";
pub const REASON_LLMFIT_TIGHT: &str = "llmfit_tight";
pub const REASON_LLMFIT_CONTEXT_DEFAULTED: &str = "llmfit_context_defaulted";
pub const REASON_LLMFIT_VISION_MODEL: &str = "llmfit_vision_model";
pub const REASON_LLMFIT_TPS_ESTIMATED: &str = "llmfit_tps_estimated";

const BYTES_PER_GB: f64 = 1024.0 * 1024.0 * 1024.0;

#[derive(Debug, Clone)]
pub struct RecommendationCandidate {
    pub model_id: String,
    pub repo: String,
    pub title: String,
    pub capability: String,
    pub engine: String,
    pub entry: Option<String>,
    pub format: Option<LocalAiRecommendationFormat>,
    pub main_size_bytes: Option<u64>,
    pub known_total_size_bytes: Option<u64>,
    pub fallback_entries: Vec<String>,
    pub tags: Vec<String>,
}

fn normalize_capability(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn first_media_capability(capabilities: &[String]) -> Option<String> {
    capabilities
        .iter()
        .map(|value| normalize_capability(value))
        .find(|value| value == "image" || value == "video")
}

fn first_llm_capability(capabilities: &[String]) -> Option<String> {
    capabilities
        .iter()
        .map(|value| normalize_capability(value))
        .find(|value| value == "chat")
}

fn has_vision_hint(candidate: &RecommendationCandidate) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        candidate.model_id,
        candidate.repo,
        candidate.title,
        candidate.tags.join(" ")
    )
    .to_ascii_lowercase();
    haystack.contains("vision")
        || haystack.contains("-vl-")
        || haystack.contains(" llava")
        || haystack.contains("pixtral")
        || haystack.contains("multimodal")
        || haystack.contains("onevision")
}

fn normalize_gpu_vendor(value: Option<&str>) -> String {
    value
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

pub fn classify_host_support(
    engine: &str,
    profile: &LocalAiDeviceProfile,
) -> LocalAiHostSupportDescriptor {
    let normalized_engine = engine.trim().to_ascii_lowercase();
    if normalized_engine == "nimi_media" {
        let windows_x64 = profile.os.eq_ignore_ascii_case("windows")
            && (profile.arch.eq_ignore_ascii_case("amd64")
                || profile.arch.eq_ignore_ascii_case("x86_64"));
        if !windows_x64 {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::AttachedOnly,
                detail: Some(
                    "nimi_media supervised mode requires Windows x64; configure an attached endpoint instead"
                        .to_string(),
                ),
            };
        }
        if normalize_gpu_vendor(profile.gpu.vendor.as_deref()) != "nvidia" {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::AttachedOnly,
                detail: Some(
                    "nimi_media supervised mode requires an NVIDIA GPU; configure an attached endpoint instead"
                        .to_string(),
                ),
            };
        }
        if !profile.gpu.available {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::AttachedOnly,
                detail: Some(
                    "nimi_media supervised mode requires a CUDA-ready NVIDIA runtime; configure an attached endpoint instead"
                        .to_string(),
                ),
            };
        }
        return LocalAiHostSupportDescriptor {
            class: LocalAiHostSupportClass::SupportedSupervised,
            detail: None,
        };
    }
    if normalized_engine == "localai" {
        let supported = (profile.os.eq_ignore_ascii_case("darwin")
            && (profile.arch.eq_ignore_ascii_case("arm64")
                || profile.arch.eq_ignore_ascii_case("amd64")
                || profile.arch.eq_ignore_ascii_case("x86_64")))
            || (profile.os.eq_ignore_ascii_case("linux")
                && (profile.arch.eq_ignore_ascii_case("amd64")
                    || profile.arch.eq_ignore_ascii_case("x86_64")
                    || profile.arch.eq_ignore_ascii_case("arm64")));
        if supported {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::SupportedSupervised,
                detail: None,
            };
        }
        return LocalAiHostSupportDescriptor {
            class: LocalAiHostSupportClass::AttachedOnly,
            detail: Some(
                "localai supervised mode requires macOS or Linux; configure an attached endpoint instead"
                    .to_string(),
            ),
        };
    }
    if normalized_engine == "nexa" {
        return LocalAiHostSupportDescriptor {
            class: LocalAiHostSupportClass::SupportedSupervised,
            detail: None,
        };
    }
    LocalAiHostSupportDescriptor {
        class: LocalAiHostSupportClass::Unsupported,
        detail: Some("unknown managed engine".to_string()),
    }
}

pub fn auto_runtime_mode_for_engine(
    engine: &str,
    profile: &LocalAiDeviceProfile,
) -> LocalAiEngineRuntimeMode {
    let support = classify_host_support(engine, profile);
    if support.class == LocalAiHostSupportClass::SupportedSupervised {
        LocalAiEngineRuntimeMode::Supervised
    } else {
        LocalAiEngineRuntimeMode::AttachedEndpoint
    }
}

pub fn install_available_for_runtime_mode(
    engine: &str,
    runtime_mode: &LocalAiEngineRuntimeMode,
    endpoint: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> bool {
    match runtime_mode {
        LocalAiEngineRuntimeMode::AttachedEndpoint => endpoint
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false),
        LocalAiEngineRuntimeMode::Supervised => {
            classify_host_support(engine, profile).class
                == LocalAiHostSupportClass::SupportedSupervised
        }
    }
}

pub fn add_host_support_to_provider_hints(
    hints: Option<LocalAiProviderHints>,
    engine: &str,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiProviderHints> {
    let support = classify_host_support(engine, profile);
    let mut output = hints.unwrap_or_default();
    let mut extra = output
        .extra
        .take()
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    extra.insert(
        "runtime_support_class".to_string(),
        json!(support.class),
    );
    if let Some(detail) = support.detail {
        extra.insert("runtime_support_detail".to_string(), json!(detail));
    }
    output.extra = Some(serde_json::Value::Object(extra));
    Some(output)
}

fn detect_format_from_entry(entry: Option<&str>) -> Option<LocalAiRecommendationFormat> {
    let lower = entry.unwrap_or_default().trim().to_ascii_lowercase();
    if lower.ends_with(".gguf") {
        return Some(LocalAiRecommendationFormat::Gguf);
    }
    if lower.ends_with(".safetensors") {
        return Some(LocalAiRecommendationFormat::Safetensors);
    }
    None
}

fn quant_hint_from_entry(entry: Option<&str>) -> Option<String> {
    let normalized = entry.unwrap_or_default().trim();
    if normalized.is_empty() {
        return None;
    }
    let upper = normalized.to_ascii_uppercase();
    for token in ["Q2", "Q3", "Q4", "Q5", "Q6", "Q8", "IQ1", "IQ2", "IQ3", "IQ4"] {
        if upper.contains(token) {
            return Some(token.to_string());
        }
    }
    None
}

fn llm_quant_hint(candidate: &RecommendationCandidate) -> Option<String> {
    let texts = [
        candidate.entry.as_deref().unwrap_or_default(),
        candidate.title.as_str(),
        candidate.model_id.as_str(),
        candidate.repo.as_str(),
    ];
    let known = [
        ("Q8_0", "Q8_0"),
        ("Q6_K", "Q6_K"),
        ("Q5_K_M", "Q5_K_M"),
        ("Q4_K_M", "Q4_K_M"),
        ("Q4_0", "Q4_0"),
        ("Q3_K_M", "Q3_K_M"),
        ("Q2_K", "Q2_K"),
        ("BF16", "BF16"),
        ("F16", "F16"),
        ("AWQ-4BIT", "AWQ-4bit"),
        ("AWQ-8BIT", "AWQ-8bit"),
        ("GPTQ-INT4", "GPTQ-Int4"),
        ("GPTQ-INT8", "GPTQ-Int8"),
    ];
    for text in texts {
        let upper = text.to_ascii_uppercase();
        for (needle, output) in known {
            if upper.contains(needle) {
                return Some(output.to_string());
            }
        }
    }
    quant_hint_from_entry(candidate.entry.as_deref())
}

fn llm_model_format(candidate: &RecommendationCandidate) -> ModelFormat {
    match candidate.format {
        Some(LocalAiRecommendationFormat::Gguf) => ModelFormat::Gguf,
        Some(LocalAiRecommendationFormat::Safetensors) => ModelFormat::Safetensors,
        None => ModelFormat::Gguf,
    }
}

fn parse_suffix_number(input: &str, suffix: char) -> Option<f64> {
    let bytes = input.as_bytes();
    let suffix = suffix.to_ascii_lowercase() as u8;
    let mut best = None::<f64>;
    let mut index = 0usize;
    while index < bytes.len() {
        if !(bytes[index].is_ascii_digit() || bytes[index] == b'.') {
            index += 1;
            continue;
        }
        let start = index;
        let mut seen_dot = bytes[index] == b'.';
        index += 1;
        while index < bytes.len() {
            let ch = bytes[index];
            if ch.is_ascii_digit() {
                index += 1;
                continue;
            }
            if ch == b'.' && !seen_dot {
                seen_dot = true;
                index += 1;
                continue;
            }
            break;
        }
        if index >= bytes.len() {
            continue;
        }
        if bytes[index].to_ascii_lowercase() != suffix {
            continue;
        }
        let value = input[start..index].parse::<f64>().ok()?;
        best = Some(best.map(|current| current.max(value)).unwrap_or(value));
        index += 1;
    }
    best
}

fn infer_parameters_raw(candidate: &RecommendationCandidate, quant_hint: Option<&str>) -> (Option<u64>, bool) {
    let tag_blob = candidate.tags.join(" ");
    let texts = [
        candidate.entry.as_deref().unwrap_or_default(),
        candidate.title.as_str(),
        candidate.model_id.as_str(),
        candidate.repo.as_str(),
        tag_blob.as_str(),
    ];
    let mut parsed_from_name = None::<u64>;
    for text in texts {
        if let Some(value) = parse_suffix_number(text, 'b') {
            parsed_from_name = Some((value * 1_000_000_000.0).round() as u64);
            break;
        }
        if let Some(value) = parse_suffix_number(text, 'm') {
            parsed_from_name = Some((value * 1_000_000.0).round() as u64);
            break;
        }
    }
    if parsed_from_name.is_some() {
        return (parsed_from_name, true);
    }

    let size_bytes = candidate.main_size_bytes.or(candidate.known_total_size_bytes);
    let quant = quant_hint.unwrap_or("Q4_K_M");
    let bpp = quant_bpp(quant).max(0.1);
    let params = size_bytes.map(|size| ((size as f64 / bpp).round() as u64).max(1));
    (params, false)
}

fn infer_context_length(candidate: &RecommendationCandidate) -> (u32, bool) {
    for tag in &candidate.tags {
        let lower = tag.to_ascii_lowercase();
        if !lower.contains("context") && !lower.contains("ctx") && !lower.ends_with('k') {
            continue;
        }
        if let Some(value) = parse_suffix_number(lower.as_str(), 'k') {
            let tokens = (value * 1024.0).round() as u32;
            if tokens >= 1024 {
                return (tokens, false);
            }
        }
        let digits = lower.chars().filter(|ch| ch.is_ascii_digit()).collect::<String>();
        if let Ok(tokens) = digits.parse::<u32>() {
            if tokens >= 1024 {
                return (tokens, false);
            }
        }
    }
    (4096, true)
}

fn infer_use_case(candidate: &RecommendationCandidate) -> UseCase {
    let haystack = format!(
        "{} {} {} {}",
        candidate.model_id,
        candidate.repo,
        candidate.title,
        candidate.tags.join(" ")
    )
    .to_ascii_lowercase();
    if haystack.contains("embed") || haystack.contains("bge") {
        return UseCase::Embedding;
    }
    if haystack.contains("code") || haystack.contains("coder") {
        return UseCase::Coding;
    }
    if haystack.contains("reason") || haystack.contains("deepseek-r1") {
        return UseCase::Reasoning;
    }
    if has_vision_hint(candidate) {
        return UseCase::Multimodal;
    }
    UseCase::Chat
}

fn system_specs_from_profile(profile: &LocalAiDeviceProfile) -> SystemSpecs {
    let backend = if profile.npu.available {
        GpuBackend::Ascend
    } else if profile.gpu.memory_model == LocalAiMemoryModel::Unified
        || profile.os.eq_ignore_ascii_case("darwin")
    {
        GpuBackend::Metal
    } else {
        match normalize_gpu_vendor(profile.gpu.vendor.as_deref()).as_str() {
            "nvidia" => GpuBackend::Cuda,
            "amd" => {
                if profile.os.eq_ignore_ascii_case("linux") {
                    GpuBackend::Rocm
                } else {
                    GpuBackend::Vulkan
                }
            }
            "intel" => GpuBackend::Sycl,
            _ => {
                if profile.arch.eq_ignore_ascii_case("arm64")
                    || profile.arch.eq_ignore_ascii_case("aarch64")
                {
                    GpuBackend::CpuArm
                } else {
                    GpuBackend::CpuX86
                }
            }
        }
    };
    let available_gpu_gb = profile
        .gpu
        .available_vram_bytes
        .or(profile.gpu.total_vram_bytes)
        .map(|value| value as f64 / BYTES_PER_GB);
    let gpu_name = profile
        .gpu
        .model
        .clone()
        .or_else(|| profile.gpu.vendor.clone());
    SystemSpecs {
        total_ram_gb: profile.total_ram_bytes as f64 / BYTES_PER_GB,
        available_ram_gb: profile.available_ram_bytes as f64 / BYTES_PER_GB,
        total_cpu_cores: 8,
        cpu_name: profile.arch.clone(),
        has_gpu: profile.gpu.available || available_gpu_gb.is_some(),
        gpu_vram_gb: available_gpu_gb,
        total_gpu_vram_gb: available_gpu_gb,
        gpu_name,
        gpu_count: if profile.gpu.available || available_gpu_gb.is_some() { 1 } else { 0 },
        unified_memory: profile.gpu.memory_model == LocalAiMemoryModel::Unified,
        backend,
        gpus: Vec::new(),
    }
}

fn pick_recommended_entry(best_quant: &str, candidate: &RecommendationCandidate) -> Option<String> {
    let current_quant = llm_quant_hint(candidate);
    if current_quant.as_deref() == Some(best_quant) {
        return candidate.entry.clone();
    }
    for entry in &candidate.fallback_entries {
        let entry_candidate = RecommendationCandidate {
            model_id: candidate.model_id.clone(),
            repo: candidate.repo.clone(),
            title: candidate.title.clone(),
            capability: candidate.capability.clone(),
            engine: candidate.engine.clone(),
            entry: Some(entry.clone()),
            format: detect_format_from_entry(Some(entry.as_str())),
            main_size_bytes: None,
            known_total_size_bytes: candidate.known_total_size_bytes,
            fallback_entries: Vec::new(),
            tags: candidate.tags.clone(),
        };
        if llm_quant_hint(&entry_candidate).as_deref() == Some(best_quant) {
            return Some(entry.clone());
        }
    }
    candidate.entry.clone()
}

fn baseline_for_capability(capability: &str) -> Option<LocalAiRecommendationBaseline> {
    match normalize_capability(capability).as_str() {
        "image" => Some(LocalAiRecommendationBaseline::ImageDefaultV1),
        "video" => Some(LocalAiRecommendationBaseline::VideoDefaultV1),
        _ => None,
    }
}

fn overhead_multiplier(
    capability: &str,
    format: Option<&LocalAiRecommendationFormat>,
    engine: &str,
) -> f64 {
    let capability = normalize_capability(capability);
    let format = format.cloned();
    let normalized_engine = engine.trim().to_ascii_lowercase();
    match (capability.as_str(), format, normalized_engine.as_str()) {
        ("image", Some(LocalAiRecommendationFormat::Gguf), "localai") => 1.5,
        ("image", Some(LocalAiRecommendationFormat::Gguf), _) => 1.6,
        ("image", Some(LocalAiRecommendationFormat::Safetensors), "nimi_media") => 2.2,
        ("image", Some(LocalAiRecommendationFormat::Safetensors), _) => 2.0,
        ("video", Some(LocalAiRecommendationFormat::Gguf), _) => 2.2,
        ("video", Some(LocalAiRecommendationFormat::Safetensors), "nimi_media") => 2.8,
        ("video", Some(LocalAiRecommendationFormat::Safetensors), _) => 2.5,
        ("image", None, _) => 1.8,
        ("video", None, _) => 2.6,
        _ => 1.0,
    }
}

fn format_gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / BYTES_PER_GB)
}

fn push_unique_note(notes: &mut Vec<String>, note: String) {
    if !note.trim().is_empty() && !notes.iter().any(|item| item == &note) {
        notes.push(note);
    }
}

fn push_unique_code(codes: &mut Vec<String>, code: &str) {
    if !codes.iter().any(|item| item == code) {
        codes.push(code.to_string());
    }
}

fn memory_budget_bytes(
    capability: &str,
    profile: &LocalAiDeviceProfile,
    reason_codes: &mut Vec<String>,
    notes: &mut Vec<String>,
) -> Option<u64> {
    let media_capability = normalize_capability(capability);
    if media_capability != "image" && media_capability != "video" {
        return None;
    }
    match profile.gpu.memory_model {
        LocalAiMemoryModel::Unified => {
            let budget = profile
                .gpu
                .available_vram_bytes
                .filter(|value| *value > 0)
                .or_else(|| {
                    if profile.available_ram_bytes > 0 {
                        Some(profile.available_ram_bytes)
                    } else {
                        None
                    }
                });
            if budget.is_some() {
                push_unique_code(reason_codes, REASON_UNIFIED_MEMORY_ESTIMATE);
                push_unique_note(
                    notes,
                    format!(
                        "Using unified memory estimate from host profile (available {}).",
                        format_gb(budget.unwrap_or_default())
                    ),
                );
            }
            budget
        }
        LocalAiMemoryModel::Discrete => profile.gpu.available_vram_bytes.filter(|value| *value > 0),
        LocalAiMemoryModel::Unknown => profile
            .gpu
            .available_vram_bytes
            .filter(|value| *value > 0)
            .or_else(|| {
                if profile.available_ram_bytes > 0 {
                    Some(profile.available_ram_bytes)
                } else {
                    None
                }
            }),
    }
}

fn companion_suggestions(candidate: &RecommendationCandidate) -> Vec<LocalAiSuggestedArtifact> {
    let haystack = format!(
        "{} {} {} {}",
        candidate.model_id,
        candidate.repo,
        candidate.title,
        candidate.tags.join(" ")
    )
    .to_ascii_lowercase();
    if !haystack.contains("z-image") {
        return Vec::new();
    }
    verified_artifact_list()
        .into_iter()
        .filter_map(|artifact| {
            let family = artifact
                .metadata
                .as_ref()
                .and_then(|value| value.get("family"))
                .and_then(|value| value.as_str())
                .map(|value| value.to_string());
            if family.as_deref() != Some("z-image") {
                return None;
            }
            Some(LocalAiSuggestedArtifact {
                template_id: Some(artifact.template_id),
                artifact_id: Some(artifact.artifact_id),
                kind: match artifact.kind {
                    crate::local_runtime::types::LocalAiArtifactKind::Vae => "vae",
                    crate::local_runtime::types::LocalAiArtifactKind::Llm => "llm",
                    crate::local_runtime::types::LocalAiArtifactKind::Clip => "clip",
                    crate::local_runtime::types::LocalAiArtifactKind::Controlnet => "controlnet",
                    crate::local_runtime::types::LocalAiArtifactKind::Lora => "lora",
                    crate::local_runtime::types::LocalAiArtifactKind::Auxiliary => "auxiliary",
                }
                .to_string(),
                family,
            })
        })
        .collect::<Vec<_>>()
}

pub fn build_media_recommendation(
    candidate: &RecommendationCandidate,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiRecommendationDescriptor> {
    let capability = normalize_capability(candidate.capability.as_str());
    if capability != "image" && capability != "video" {
        return None;
    }

    let format = candidate
        .format
        .clone()
        .or_else(|| detect_format_from_entry(candidate.entry.as_deref()));
    let support = classify_host_support(candidate.engine.as_str(), profile);
    let mut reason_codes = Vec::<String>::new();
    let mut suggested_notes = Vec::<String>::new();
    let baseline = baseline_for_capability(capability.as_str());
    match baseline {
        Some(LocalAiRecommendationBaseline::ImageDefaultV1) => {
            push_unique_code(&mut reason_codes, REASON_BASELINE_IMAGE_DEFAULT_V1);
            push_unique_note(
                &mut suggested_notes,
                "Baseline: image-default-v1 (1024x1024 text-to-image).".to_string(),
            );
        }
        Some(LocalAiRecommendationBaseline::VideoDefaultV1) => {
            push_unique_code(&mut reason_codes, REASON_BASELINE_VIDEO_DEFAULT_V1);
            push_unique_note(
                &mut suggested_notes,
                "Baseline: video-default-v1 (720p, 4s, 16fps, text-to-video, no audio)."
                    .to_string(),
            );
        }
        None => {}
    }

    let size_bytes = candidate.main_size_bytes.or(candidate.known_total_size_bytes);
    if candidate.main_size_bytes.is_none() {
        push_unique_code(&mut reason_codes, REASON_METADATA_INCOMPLETE);
        if size_bytes.is_some() {
            push_unique_code(&mut reason_codes, REASON_SAFETENSORS_REPO_LEVEL_ESTIMATE);
        } else {
            push_unique_code(&mut reason_codes, REASON_MAIN_SIZE_UNKNOWN);
        }
    }

    let budget_bytes = memory_budget_bytes(
        capability.as_str(),
        profile,
        &mut reason_codes,
        &mut suggested_notes,
    );
    if budget_bytes.is_none() {
        push_unique_code(&mut reason_codes, REASON_GPU_MEMORY_UNKNOWN);
        push_unique_note(
            &mut suggested_notes,
            "Host memory profile is incomplete; recommendation confidence is reduced.".to_string(),
        );
    }

    let mut confidence = if matches!(format, Some(LocalAiRecommendationFormat::Gguf))
        && candidate.main_size_bytes.is_some()
        && budget_bytes.is_some()
    {
        LocalAiRecommendationConfidence::High
    } else {
        LocalAiRecommendationConfidence::Medium
    };

    if matches!(format, Some(LocalAiRecommendationFormat::Safetensors)) {
        confidence = LocalAiRecommendationConfidence::Medium;
    }
    if candidate.main_size_bytes.is_none() || budget_bytes.is_none() {
        confidence = LocalAiRecommendationConfidence::Low;
    }

    let multiplier = overhead_multiplier(capability.as_str(), format.as_ref(), candidate.engine.as_str());
    let estimated_bytes = size_bytes.map(|value| (value as f64 * multiplier).ceil() as u64);
    push_unique_code(&mut reason_codes, REASON_HARD_PREREQUISITE_OVERHEAD_APPLIED);
    push_unique_code(&mut reason_codes, REASON_ENGINE_OVERHEAD_APPLIED);
    push_unique_note(
        &mut suggested_notes,
        "Estimate includes conservative hard-prerequisite and engine overhead.".to_string(),
    );

    if let Some(quant) = quant_hint_from_entry(candidate.entry.as_deref()) {
        push_unique_code(&mut reason_codes, REASON_VARIANT_QUANT_PARSED);
        push_unique_note(
            &mut suggested_notes,
            format!("Parsed quant hint from variant filename: {quant}."),
        );
    }

    let tier = match (estimated_bytes, budget_bytes) {
        (Some(estimate), Some(budget)) if budget > 0 => {
            let ratio = estimate as f64 / budget as f64;
            push_unique_note(
                &mut suggested_notes,
                format!(
                    "Estimated memory {} against available host budget {}.",
                    format_gb(estimate),
                    format_gb(budget)
                ),
            );
            if ratio <= 0.70 {
                push_unique_code(&mut reason_codes, REASON_MEMORY_HEADROOM_RECOMMENDED);
                Some(LocalAiRecommendationTier::Recommended)
            } else if ratio <= 0.85 {
                push_unique_code(&mut reason_codes, REASON_MEMORY_HEADROOM_RUNNABLE);
                Some(LocalAiRecommendationTier::Runnable)
            } else if ratio <= 1.0 {
                push_unique_code(&mut reason_codes, REASON_MEMORY_HEADROOM_TIGHT);
                Some(LocalAiRecommendationTier::Tight)
            } else {
                push_unique_code(&mut reason_codes, REASON_MEMORY_BUDGET_EXCEEDED);
                Some(LocalAiRecommendationTier::NotRecommended)
            }
        }
        _ => None,
    };

    match support.class {
        LocalAiHostSupportClass::AttachedOnly => {
            push_unique_code(&mut reason_codes, REASON_HOST_ATTACHED_ONLY);
        }
        LocalAiHostSupportClass::Unsupported => {
            push_unique_code(&mut reason_codes, REASON_HOST_UNSUPPORTED);
        }
        LocalAiHostSupportClass::SupportedSupervised => {}
    }
    if let Some(detail) = support.detail.clone() {
        push_unique_note(&mut suggested_notes, detail);
    }
    push_unique_note(
        &mut suggested_notes,
        "Companion assets may still be required and are not part of the main-model tier."
            .to_string(),
    );

    Some(LocalAiRecommendationDescriptor {
        source: LocalAiRecommendationSource::MediaFit,
        format,
        tier,
        host_support_class: Some(support.class),
        confidence: Some(confidence),
        reason_codes,
        recommended_entry: candidate.entry.clone(),
        fallback_entries: candidate.fallback_entries.clone(),
        suggested_artifacts: companion_suggestions(candidate),
        suggested_notes,
        baseline,
    })
}

pub fn build_llmfit_recommendation(
    candidate: &RecommendationCandidate,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiRecommendationDescriptor> {
    if first_llm_capability(std::slice::from_ref(&candidate.capability)).is_none() {
        return None;
    }

    let support = classify_host_support(candidate.engine.as_str(), profile);
    let quant = llm_quant_hint(candidate);
    let (parameters_raw, from_name) = infer_parameters_raw(candidate, quant.as_deref());
    let (context_length, context_defaulted) = infer_context_length(candidate);
    let use_case = infer_use_case(candidate);
    let format = candidate
        .format
        .clone()
        .or_else(|| detect_format_from_entry(candidate.entry.as_deref()));

    let quantization = quant.clone().unwrap_or_else(|| match format {
        Some(LocalAiRecommendationFormat::Safetensors) => "F16".to_string(),
        _ => "Q4_K_M".to_string(),
    });
    let memory_gb = candidate
        .main_size_bytes
        .or(candidate.known_total_size_bytes)
        .map(|value| value as f64 / BYTES_PER_GB)?;

    let model = LlmModel {
        name: candidate.title.clone(),
        provider: candidate.engine.clone(),
        parameter_count: parameters_raw
            .map(|value| format!("{:.1}B", value as f64 / 1_000_000_000.0))
            .unwrap_or_else(|| "7B".to_string()),
        parameters_raw,
        min_ram_gb: memory_gb + 0.5,
        recommended_ram_gb: (memory_gb + 0.5) * 1.2,
        min_vram_gb: Some(memory_gb + 0.5),
        quantization: quantization.clone(),
        context_length,
        use_case: use_case.label().to_ascii_lowercase(),
        is_moe: false,
        num_experts: None,
        active_experts: None,
        active_parameters: None,
        release_date: None,
        gguf_sources: Vec::new(),
        capabilities: if has_vision_hint(candidate) {
            vec![LlmCapability::Vision]
        } else {
            Vec::new()
        },
        format: llm_model_format(candidate),
    };
    let fit = ModelFit::analyze(&model, &system_specs_from_profile(profile));

    let mut reason_codes = Vec::<String>::new();
    let mut suggested_notes = Vec::<String>::new();
    if quant.is_some() {
        push_unique_code(&mut reason_codes, REASON_LLMFIT_QUANT_FROM_FILENAME);
    }
    if from_name {
        push_unique_code(&mut reason_codes, REASON_LLMFIT_PARAMS_FROM_FILENAME);
    } else {
        push_unique_code(&mut reason_codes, REASON_LLMFIT_PARAMS_FROM_FILESIZE);
    }
    if context_defaulted {
        push_unique_code(&mut reason_codes, REASON_LLMFIT_CONTEXT_DEFAULTED);
    }
    if has_vision_hint(candidate) {
        push_unique_code(&mut reason_codes, REASON_LLMFIT_VISION_MODEL);
    }

    let tier = match fit.fit_level {
        LlmFitLevel::Perfect => {
            push_unique_code(&mut reason_codes, REASON_LLMFIT_RECOMMENDED);
            Some(LocalAiRecommendationTier::Recommended)
        }
        LlmFitLevel::Good => {
            push_unique_code(&mut reason_codes, REASON_LLMFIT_RUNNABLE);
            Some(LocalAiRecommendationTier::Runnable)
        }
        LlmFitLevel::Marginal => {
            push_unique_code(&mut reason_codes, REASON_LLMFIT_MARGINAL);
            push_unique_code(&mut reason_codes, REASON_LLMFIT_TIGHT);
            Some(LocalAiRecommendationTier::Tight)
        }
        LlmFitLevel::TooTight => {
            push_unique_code(&mut reason_codes, REASON_MEMORY_BUDGET_EXCEEDED);
            Some(LocalAiRecommendationTier::NotRecommended)
        }
    };
    match fit.run_mode {
        LlmRunMode::Gpu => push_unique_code(&mut reason_codes, REASON_LLMFIT_GPU_PATH),
        LlmRunMode::MoeOffload => push_unique_code(&mut reason_codes, REASON_LLMFIT_MOE_OFFLOAD),
        LlmRunMode::CpuOffload => push_unique_code(&mut reason_codes, REASON_LLMFIT_CPU_OFFLOAD),
        LlmRunMode::CpuOnly => push_unique_code(&mut reason_codes, REASON_LLMFIT_CPU_ONLY),
    }
    match support.class {
        LocalAiHostSupportClass::AttachedOnly => {
            push_unique_code(&mut reason_codes, REASON_HOST_ATTACHED_ONLY);
        }
        LocalAiHostSupportClass::Unsupported => {
            push_unique_code(&mut reason_codes, REASON_HOST_UNSUPPORTED);
        }
        LocalAiHostSupportClass::SupportedSupervised => {}
    }
    if let Some(detail) = support.detail.clone() {
        push_unique_note(&mut suggested_notes, detail);
    }
    push_unique_code(&mut reason_codes, REASON_LLMFIT_TPS_ESTIMATED);
    push_unique_note(
        &mut suggested_notes,
        format!(
            "llmfit estimated {:.1} tok/s via {} in {} mode.",
            fit.estimated_tps,
            fit.runtime_text(),
            fit.run_mode_text()
        ),
    );
    push_unique_note(
        &mut suggested_notes,
        format!(
            "Estimated memory {:.1} GB against {:.1} GB available.",
            fit.memory_required_gb,
            fit.memory_available_gb
        ),
    );
    for note in fit.notes.iter().take(3) {
        push_unique_note(&mut suggested_notes, note.clone());
    }

    let confidence = if candidate.main_size_bytes.is_some() && quant.is_some() && parameters_raw.is_some() {
        LocalAiRecommendationConfidence::High
    } else if candidate.main_size_bytes.is_some() || candidate.known_total_size_bytes.is_some() {
        LocalAiRecommendationConfidence::Medium
    } else {
        LocalAiRecommendationConfidence::Low
    };
    let recommended_entry = pick_recommended_entry(fit.best_quant.as_str(), candidate);
    let fallback_entries = candidate
        .fallback_entries
        .iter()
        .filter(|entry| Some((*entry).clone()) != recommended_entry)
        .cloned()
        .collect::<Vec<_>>();

    Some(LocalAiRecommendationDescriptor {
        source: LocalAiRecommendationSource::Llmfit,
        format,
        tier,
        host_support_class: Some(support.class),
        confidence: Some(confidence),
        reason_codes,
        recommended_entry,
        fallback_entries,
        suggested_artifacts: Vec::new(),
        suggested_notes,
        baseline: None,
    })
}

pub fn build_catalog_recommendation(
    candidate: &RecommendationCandidate,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiRecommendationDescriptor> {
    build_media_recommendation(candidate, profile)
        .or_else(|| build_llmfit_recommendation(candidate, profile))
}

pub fn build_recommendation_candidate(
    model_id: &str,
    repo: &str,
    title: &str,
    capabilities: &[String],
    engine: &str,
    entry: Option<&str>,
    main_size_bytes: Option<u64>,
    known_total_size_bytes: Option<u64>,
    fallback_entries: Vec<String>,
    tags: &[String],
) -> Option<RecommendationCandidate> {
    let capability = first_media_capability(capabilities)
        .or_else(|| first_llm_capability(capabilities))?;
    Some(RecommendationCandidate {
        model_id: model_id.trim().to_string(),
        repo: repo.trim().to_string(),
        title: title.trim().to_string(),
        capability,
        engine: engine.trim().to_string(),
        entry: entry
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        format: detect_format_from_entry(entry),
        main_size_bytes,
        known_total_size_bytes,
        fallback_entries,
        tags: tags.to_vec(),
    })
}

pub fn recommend_variant_list(
    model_id: &str,
    repo: &str,
    title: &str,
    capabilities: &[String],
    engine: &str,
    variants: &mut [CatalogVariantDescriptor],
    profile: &LocalAiDeviceProfile,
    tags: &[String],
) {
    let fallback_order = variants
        .iter()
        .map(|variant| variant.entry.clone())
        .collect::<Vec<_>>();
    for variant in variants.iter_mut() {
        let fallback_entries = fallback_order
            .iter()
            .filter(|entry| *entry != &variant.entry)
            .cloned()
            .collect::<Vec<_>>();
        if let Some(candidate) = build_recommendation_candidate(
            model_id,
            repo,
            title,
            capabilities,
            engine,
            Some(variant.entry.as_str()),
            variant.size_bytes,
            variant.size_bytes,
            fallback_entries,
            tags,
        ) {
            variant.recommendation = build_catalog_recommendation(&candidate, profile);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_runtime::types::{LocalAiGpuProfile, LocalAiNpuProfile, LocalAiPythonProfile};

    fn device_profile_fixture(
        available_ram_bytes: u64,
        available_vram_bytes: Option<u64>,
        memory_model: LocalAiMemoryModel,
        os: &str,
        arch: &str,
        vendor: Option<&str>,
    ) -> LocalAiDeviceProfile {
        LocalAiDeviceProfile {
            os: os.to_string(),
            arch: arch.to_string(),
            total_ram_bytes: available_ram_bytes.saturating_mul(2),
            available_ram_bytes,
            gpu: LocalAiGpuProfile {
                available: available_vram_bytes.is_some(),
                vendor: vendor.map(|value| value.to_string()),
                model: None,
                total_vram_bytes: available_vram_bytes.map(|value| value.saturating_mul(2)),
                available_vram_bytes,
                memory_model,
            },
            python: LocalAiPythonProfile {
                available: true,
                version: Some("3.11.0".to_string()),
            },
            npu: LocalAiNpuProfile {
                available: false,
                ready: false,
                vendor: None,
                runtime: None,
                detail: None,
            },
            disk_free_bytes: 0,
            ports: Vec::new(),
        }
    }

    #[test]
    fn media_fit_prefers_recommended_tier_when_budget_has_headroom() {
        let profile = device_profile_fixture(
            32 * 1024 * 1024 * 1024,
            Some(12 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "linux",
            "amd64",
            Some("nvidia"),
        );
        let candidate = build_recommendation_candidate(
            "local/z-image",
            "jayn7/Z-Image-Turbo-GGUF",
            "Z-Image Turbo",
            &["image".to_string()],
            "localai",
            Some("z_image_turbo-Q4_K_M.gguf"),
            Some(4 * 1024 * 1024 * 1024),
            Some(4 * 1024 * 1024 * 1024),
            Vec::new(),
            &["image".to_string(), "z-image".to_string()],
        )
        .expect("candidate");
        let recommendation = build_media_recommendation(&candidate, &profile).expect("recommendation");
        assert_eq!(
            recommendation.tier,
            Some(LocalAiRecommendationTier::Recommended)
        );
        assert_eq!(
            recommendation.host_support_class,
            Some(LocalAiHostSupportClass::SupportedSupervised)
        );
    }

    #[test]
    fn video_fit_is_stricter_than_image_fit_for_same_size() {
        let profile = device_profile_fixture(
            32 * 1024 * 1024 * 1024,
            Some(8 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "windows",
            "amd64",
            Some("nvidia"),
        );
        let image = build_recommendation_candidate(
            "local/flux",
            "org/flux",
            "Flux",
            &["image".to_string()],
            "nimi_media",
            Some("model.safetensors"),
            Some(3 * 1024 * 1024 * 1024),
            Some(3 * 1024 * 1024 * 1024),
            Vec::new(),
            &[],
        )
        .expect("image");
        let video = build_recommendation_candidate(
            "local/wan",
            "org/wan",
            "Wan",
            &["video".to_string()],
            "nimi_media",
            Some("model.safetensors"),
            Some(3 * 1024 * 1024 * 1024),
            Some(3 * 1024 * 1024 * 1024),
            Vec::new(),
            &[],
        )
        .expect("video");
        let image_tier = build_media_recommendation(&image, &profile)
            .and_then(|value| value.tier)
            .expect("image tier");
        let video_tier = build_media_recommendation(&video, &profile)
            .and_then(|value| value.tier)
            .expect("video tier");
        assert!(matches!(
            (image_tier, video_tier),
            (LocalAiRecommendationTier::Recommended, LocalAiRecommendationTier::Tight)
                | (LocalAiRecommendationTier::Runnable, LocalAiRecommendationTier::NotRecommended)
                | (LocalAiRecommendationTier::Recommended, LocalAiRecommendationTier::Runnable)
        ));
    }

    #[test]
    fn host_support_marks_localai_windows_as_attached_only() {
        let profile = device_profile_fixture(
            16 * 1024 * 1024 * 1024,
            Some(6 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "windows",
            "amd64",
            Some("nvidia"),
        );
        let support = classify_host_support("localai", &profile);
        assert_eq!(support.class, LocalAiHostSupportClass::AttachedOnly);
    }

    #[test]
    fn host_support_marks_unknown_engine_as_unsupported() {
        let profile = device_profile_fixture(
            16 * 1024 * 1024 * 1024,
            Some(6 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "linux",
            "amd64",
            Some("nvidia"),
        );
        let support = classify_host_support("mystery-engine", &profile);
        assert_eq!(support.class, LocalAiHostSupportClass::Unsupported);
    }

    #[test]
    fn media_fit_degrades_safetensors_without_precise_main_size() {
        let profile = device_profile_fixture(
            32 * 1024 * 1024 * 1024,
            Some(12 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "windows",
            "amd64",
            Some("nvidia"),
        );
        let candidate = build_recommendation_candidate(
            "local/flux",
            "black-forest-labs/FLUX.1-dev",
            "FLUX.1 dev",
            &["image".to_string()],
            "nimi_media",
            Some("model.safetensors"),
            None,
            Some(6 * 1024 * 1024 * 1024),
            Vec::new(),
            &[],
        )
        .expect("candidate");
        let recommendation = build_media_recommendation(&candidate, &profile).expect("recommendation");
        assert_eq!(
            recommendation.confidence,
            Some(LocalAiRecommendationConfidence::Low)
        );
        assert!(recommendation
            .reason_codes
            .iter()
            .any(|code| code == REASON_METADATA_INCOMPLETE));
    }

    #[test]
    fn unified_memory_path_emits_unified_reason() {
        let unified = device_profile_fixture(
            32 * 1024 * 1024 * 1024,
            None,
            LocalAiMemoryModel::Unified,
            "darwin",
            "arm64",
            Some("apple"),
        );
        let candidate = build_recommendation_candidate(
            "local/z-image",
            "jayn7/Z-Image-Turbo-GGUF",
            "Z-Image Turbo",
            &["image".to_string()],
            "localai",
            Some("z_image_turbo-Q4_K_M.gguf"),
            Some(4 * 1024 * 1024 * 1024),
            Some(4 * 1024 * 1024 * 1024),
            Vec::new(),
            &["image".to_string(), "z-image".to_string()],
        )
        .expect("candidate");
        let recommendation = build_media_recommendation(&candidate, &unified).expect("recommendation");
        assert!(recommendation
            .reason_codes
            .iter()
            .any(|code| code == REASON_UNIFIED_MEMORY_ESTIMATE));
    }

    #[test]
    fn media_fit_suggests_verified_companions_for_z_image_family() {
        let profile = device_profile_fixture(
            32 * 1024 * 1024 * 1024,
            Some(12 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "linux",
            "amd64",
            Some("nvidia"),
        );
        let candidate = build_recommendation_candidate(
            "local/z-image",
            "jayn7/Z-Image-Turbo-GGUF",
            "Z-Image Turbo",
            &["image".to_string()],
            "localai",
            Some("z_image_turbo-Q4_K_M.gguf"),
            Some(4 * 1024 * 1024 * 1024),
            Some(4 * 1024 * 1024 * 1024),
            Vec::new(),
            &["image".to_string(), "z-image".to_string()],
        )
        .expect("candidate");
        let recommendation = build_media_recommendation(&candidate, &profile).expect("recommendation");
        assert!(!recommendation.suggested_artifacts.is_empty());
        assert!(recommendation
            .suggested_artifacts
            .iter()
            .any(|artifact| artifact.family.as_deref() == Some("z-image")));
    }

    #[test]
    fn llmfit_recommends_smaller_quant_for_same_llm_family() {
        let profile = device_profile_fixture(
            32 * 1024 * 1024 * 1024,
            Some(8 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "linux",
            "amd64",
            Some("nvidia"),
        );
        let candidate = build_recommendation_candidate(
            "Qwen/Qwen2.5-7B-Instruct-GGUF",
            "Qwen/Qwen2.5-7B-Instruct-GGUF",
            "Qwen2.5 7B Instruct",
            &["chat".to_string()],
            "localai",
            Some("Qwen2.5-7B-Instruct-Q8_0.gguf"),
            Some(8 * 1024 * 1024 * 1024),
            Some(8 * 1024 * 1024 * 1024),
            vec![
                "Qwen2.5-7B-Instruct-Q6_K.gguf".to_string(),
                "Qwen2.5-7B-Instruct-Q4_K_M.gguf".to_string(),
            ],
            &["chat".to_string(), "7b".to_string()],
        )
        .expect("candidate");
        let recommendation =
            build_llmfit_recommendation(&candidate, &profile).expect("llmfit recommendation");
        assert!(matches!(
            recommendation.tier,
            Some(LocalAiRecommendationTier::Recommended | LocalAiRecommendationTier::Runnable)
        ));
        assert_eq!(
            recommendation.recommended_entry.as_deref(),
            Some("Qwen2.5-7B-Instruct-Q6_K.gguf")
        );
    }

    #[test]
    fn llmfit_marks_vision_llm_with_llmfit_source() {
        let profile = device_profile_fixture(
            64 * 1024 * 1024 * 1024,
            Some(24 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "linux",
            "amd64",
            Some("nvidia"),
        );
        let candidate = build_recommendation_candidate(
            "Qwen/Qwen2.5-VL-7B-Instruct-GGUF",
            "Qwen/Qwen2.5-VL-7B-Instruct-GGUF",
            "Qwen2.5 VL 7B Instruct",
            &["chat".to_string()],
            "localai",
            Some("Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf"),
            Some(5 * 1024 * 1024 * 1024),
            Some(5 * 1024 * 1024 * 1024),
            Vec::new(),
            &["vision".to_string(), "multimodal".to_string()],
        )
        .expect("candidate");
        let recommendation =
            build_catalog_recommendation(&candidate, &profile).expect("catalog recommendation");
        assert_eq!(recommendation.source, LocalAiRecommendationSource::Llmfit);
        assert!(recommendation.reason_codes.iter().any(|code| code == REASON_LLMFIT_VISION_MODEL));
    }
}
