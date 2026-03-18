pub fn build_llmfit_recommendation(
    candidate: &RecommendationCandidate,
    profile: &LocalAiDeviceProfile,
) -> Option<LocalAiRecommendationDescriptor> {
    first_llm_capability(std::slice::from_ref(&candidate.capability))?;

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

    let confidence =
        if candidate.main_size_bytes.is_some() && quant.is_some() && parameters_raw.is_some() {
            LocalAiRecommendationConfidence::High
        } else if candidate.main_size_bytes.is_some() || candidate.known_total_size_bytes.is_some()
        {
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
