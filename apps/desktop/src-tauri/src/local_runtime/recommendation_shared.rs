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

fn infer_parameters_raw(
    candidate: &RecommendationCandidate,
    quant_hint: Option<&str>,
) -> (Option<u64>, bool) {
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
        gpu_count: if profile.gpu.available || available_gpu_gb.is_some() {
            1
        } else {
            0
        },
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
        ("image", Some(LocalAiRecommendationFormat::Gguf), "llama") => 1.5,
        ("image", Some(LocalAiRecommendationFormat::Gguf), _) => 1.6,
        ("image", Some(LocalAiRecommendationFormat::Safetensors), "media") => 2.2,
        ("image", Some(LocalAiRecommendationFormat::Safetensors), _) => 2.0,
        ("video", Some(LocalAiRecommendationFormat::Gguf), _) => 2.2,
        ("video", Some(LocalAiRecommendationFormat::Safetensors), "media") => 2.8,
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
