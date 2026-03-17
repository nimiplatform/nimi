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

    let multiplier =
        overhead_multiplier(capability.as_str(), format.as_ref(), candidate.engine.as_str());
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
