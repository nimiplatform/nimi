use llmfit_core::fit::{FitLevel as LlmFitLevel, ModelFit, RunMode as LlmRunMode};
use llmfit_core::hardware::{GpuBackend, SystemSpecs};
use llmfit_core::models::{quant_bpp, Capability as LlmCapability, LlmModel, ModelFormat, UseCase};
use serde_json::json;

use super::types::{
    CatalogVariantDescriptor, LocalAiDeviceProfile, LocalAiEngineRuntimeMode,
    LocalAiHostSupportClass, LocalAiHostSupportDescriptor, LocalAiMemoryModel,
    LocalAiProviderHints, LocalAiRecommendationBaseline, LocalAiRecommendationConfidence,
    LocalAiRecommendationDescriptor, LocalAiRecommendationFormat, LocalAiRecommendationSource,
    LocalAiRecommendationTier, LocalAiSuggestedAsset,
};
use super::verified_artifacts::verified_asset_list;

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
        .find(|value| {
            value == "image"
                || value == "video"
                || value == "image.generate"
                || value == "video.generate"
        })
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
    value.unwrap_or_default().trim().to_ascii_lowercase()
}

pub fn classify_host_support(
    engine: &str,
    profile: &LocalAiDeviceProfile,
) -> LocalAiHostSupportDescriptor {
    let normalized_engine = engine.trim().to_ascii_lowercase();
    if normalized_engine == "media" {
        let windows_x64 = profile.os.eq_ignore_ascii_case("windows")
            && (profile.arch.eq_ignore_ascii_case("amd64")
                || profile.arch.eq_ignore_ascii_case("x86_64"));
        if !windows_x64 {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::AttachedOnly,
                detail: Some(
                    "media supervised mode requires Windows x64; configure an attached endpoint instead"
                        .to_string(),
                ),
            };
        }
        if normalize_gpu_vendor(profile.gpu.vendor.as_deref()) != "nvidia" {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::AttachedOnly,
                detail: Some(
                    "media supervised mode requires an NVIDIA GPU; configure an attached endpoint instead"
                        .to_string(),
                ),
            };
        }
        if !profile.gpu.available {
            return LocalAiHostSupportDescriptor {
                class: LocalAiHostSupportClass::AttachedOnly,
                detail: Some(
                    "media supervised mode requires a CUDA-ready NVIDIA runtime; configure an attached endpoint instead"
                        .to_string(),
                ),
            };
        }
        return LocalAiHostSupportDescriptor {
            class: LocalAiHostSupportClass::SupportedSupervised,
            detail: None,
        };
    }
    if normalized_engine == "llama" {
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
                "llama supervised mode requires macOS or Linux; configure an attached endpoint instead"
                    .to_string(),
            ),
        };
    }
    if normalized_engine == "speech" {
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
    extra.insert("runtime_support_class".to_string(), json!(support.class));
    if let Some(detail) = support.detail {
        extra.insert("runtime_support_detail".to_string(), json!(detail));
    }
    output.extra = Some(serde_json::Value::Object(extra));
    Some(output)
}
include!("recommendation_shared.rs");
include!("recommendation_media.rs");
include!("recommendation_llmfit.rs");

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
    let capability =
        first_media_capability(capabilities).or_else(|| first_llm_capability(capabilities))?;
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
            "llama",
            Some("z_image_turbo-Q4_K_M.gguf"),
            Some(4 * 1024 * 1024 * 1024),
            Some(4 * 1024 * 1024 * 1024),
            Vec::new(),
            &["image".to_string(), "z-image".to_string()],
        )
        .expect("candidate");
        let recommendation =
            build_media_recommendation(&candidate, &profile).expect("recommendation");
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
            "media",
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
            "media",
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
            (
                LocalAiRecommendationTier::Recommended,
                LocalAiRecommendationTier::Tight
            ) | (
                LocalAiRecommendationTier::Runnable,
                LocalAiRecommendationTier::NotRecommended
            ) | (
                LocalAiRecommendationTier::Recommended,
                LocalAiRecommendationTier::Runnable
            )
        ));
    }

    #[test]
    fn host_support_marks_llama_windows_as_attached_only() {
        let profile = device_profile_fixture(
            16 * 1024 * 1024 * 1024,
            Some(6 * 1024 * 1024 * 1024),
            LocalAiMemoryModel::Discrete,
            "windows",
            "amd64",
            Some("nvidia"),
        );
        let support = classify_host_support("llama", &profile);
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
            "media",
            Some("model.safetensors"),
            None,
            Some(6 * 1024 * 1024 * 1024),
            Vec::new(),
            &[],
        )
        .expect("candidate");
        let recommendation =
            build_media_recommendation(&candidate, &profile).expect("recommendation");
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
            "llama",
            Some("z_image_turbo-Q4_K_M.gguf"),
            Some(4 * 1024 * 1024 * 1024),
            Some(4 * 1024 * 1024 * 1024),
            Vec::new(),
            &["image".to_string(), "z-image".to_string()],
        )
        .expect("candidate");
        let recommendation =
            build_media_recommendation(&candidate, &unified).expect("recommendation");
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
            "llama",
            Some("z_image_turbo-Q4_K_M.gguf"),
            Some(4 * 1024 * 1024 * 1024),
            Some(4 * 1024 * 1024 * 1024),
            Vec::new(),
            &["image".to_string(), "z-image".to_string()],
        )
        .expect("candidate");
        let recommendation =
            build_media_recommendation(&candidate, &profile).expect("recommendation");
        assert!(!recommendation.suggested_assets.is_empty());
        assert!(recommendation
            .suggested_assets
            .iter()
            .any(|asset| asset.family.as_deref() == Some("z-image")));
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
            "llama",
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
            "llama",
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
        assert!(recommendation
            .reason_codes
            .iter()
            .any(|code| code == REASON_LLMFIT_VISION_MODEL));
    }
}
