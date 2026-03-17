fn resolve_verified_plan(
    template_id: &str,
    profile: &LocalAiDeviceProfile,
) -> Result<LocalAiInstallPlanDescriptor, String> {
    let descriptor = find_verified_model(template_id).ok_or_else(|| {
        format!("LOCAL_AI_INSTALL_PLAN_TEMPLATE_NOT_FOUND: templateId={template_id}")
    })?;
    let endpoint = validate_loopback_endpoint(descriptor.endpoint.as_str())?;
    let engine_runtime_mode = runtime_mode_for_engine(descriptor.engine.as_str(), profile);
    let provider_hints = provider_hints_for_capabilities(
        descriptor.capabilities.as_slice(),
        descriptor.engine.as_str(),
        profile,
    );
    let install_available = install_available_for_engine(
        descriptor.engine.as_str(),
        &engine_runtime_mode,
        Some(endpoint.as_str()),
        profile,
    );
    let recommendation = build_recommendation_candidate(
        descriptor.model_id.as_str(),
        descriptor.repo.as_str(),
        descriptor.title.as_str(),
        descriptor.capabilities.as_slice(),
        descriptor.engine.as_str(),
        Some(descriptor.entry.as_str()),
        descriptor.total_size_bytes,
        descriptor.total_size_bytes,
        descriptor
            .files
            .iter()
            .filter(|entry| *entry != &descriptor.entry)
            .cloned()
            .collect::<Vec<_>>(),
        descriptor.tags.as_slice(),
    );
    let recommendation =
        recommendation.and_then(|candidate| build_catalog_recommendation(&candidate, profile));

    Ok(LocalAiInstallPlanDescriptor {
        plan_id: format!("plan:verified:{}", descriptor.template_id),
        item_id: format!("verified:{}", descriptor.template_id),
        source: "verified".to_string(),
        template_id: Some(descriptor.template_id.clone()),
        model_id: descriptor.model_id,
        repo: descriptor.repo,
        revision: descriptor.revision,
        capabilities: descriptor.capabilities,
        engine_runtime_mode,
        engine: descriptor.engine,
        install_kind: descriptor.install_kind,
        install_available,
        endpoint,
        provider_hints,
        entry: descriptor.entry,
        files: descriptor.files,
        license: descriptor.license,
        hashes: descriptor.hashes,
        warnings: Vec::new(),
        reason_code: None,
        engine_config: descriptor.engine_config,
        recommendation,
    })
}

fn extract_template_id_from_input(input: &LocalAiCatalogResolveInput) -> Option<String> {
    if let Some(value) = normalize_non_empty(input.template_id.as_deref()) {
        return Some(value);
    }

    if let Some(item_id) = normalize_non_empty(input.item_id.as_deref()) {
        if let Some(stripped) = item_id.strip_prefix("verified:") {
            let template_id = stripped.trim();
            if !template_id.is_empty() {
                return Some(template_id.to_string());
            }
        }
    }

    None
}

fn extract_repo_from_input(input: &LocalAiCatalogResolveInput) -> Option<String> {
    if let Some(repo) = normalize_non_empty(input.repo.as_deref()) {
        return normalize_hf_repo_slug(repo.as_str());
    }

    if let Some(model_id) = normalize_non_empty(input.model_id.as_deref()) {
        if let Some(repo) = normalize_hf_repo_slug(model_id.as_str()) {
            return Some(repo);
        }
    }

    if let Some(item_id) = normalize_non_empty(input.item_id.as_deref()) {
        if let Some(stripped) = item_id.strip_prefix("hf:") {
            return normalize_hf_repo_slug(stripped);
        }
    }

    None
}

fn source_hint(input: &LocalAiCatalogResolveInput) -> String {
    normalize_non_empty(input.source.as_deref())
        .unwrap_or_else(|| "huggingface".to_string())
        .to_ascii_lowercase()
}

pub fn resolve_install_plan(
    input: LocalAiCatalogResolveInput,
    profile: &LocalAiDeviceProfile,
) -> Result<LocalAiInstallPlanDescriptor, String> {
    let source = source_hint(&input);
    if source == "verified" {
        let template_id = extract_template_id_from_input(&input).ok_or_else(|| {
            "LOCAL_AI_INSTALL_PLAN_TEMPLATE_REQUIRED: templateId is required".to_string()
        })?;
        return resolve_verified_plan(template_id.as_str(), profile);
    }

    if let Some(template_id) = extract_template_id_from_input(&input) {
        return resolve_verified_plan(template_id.as_str(), profile);
    }

    let repo = extract_repo_from_input(&input).ok_or_else(|| {
        "LOCAL_AI_INSTALL_PLAN_REPO_REQUIRED: repo/modelId/itemId is required".to_string()
    })?;
    let model_details = fetch_hf_model_details(repo.as_str())?;

    let pipeline_tag = model_details.pipeline_tag.as_deref();
    let inferred_capabilities = infer_capabilities(pipeline_tag, &model_details.tags);
    let capabilities = if let Some(overrides) = input.capabilities.as_ref() {
        normalize_and_validate_capabilities(overrides)?
    } else {
        normalize_and_validate_capabilities(&inferred_capabilities)?
    };
    let engine = normalize_non_empty(input.engine.as_deref())
        .unwrap_or_else(|| infer_engine(repo.as_str(), &model_details.tags, &capabilities));
    let provider_hints =
        provider_hints_for_capabilities(capabilities.as_slice(), engine.as_str(), profile);
    let revision = normalize_non_empty(input.revision.as_deref())
        .or_else(|| model_details.sha.clone())
        .unwrap_or_else(|| "main".to_string());

    let entry = select_entry_file(
        &model_details.siblings,
        input.entry.as_deref(),
        engine.as_str(),
    )
    .unwrap_or_else(|| {
        input
            .entry
            .clone()
            .unwrap_or_else(|| "model.bin".to_string())
    });
    let files = select_install_files(
        &model_details.siblings,
        entry.as_str(),
        input.entry.as_deref(),
        input.files.as_deref(),
        engine.as_str(),
    );
    let hashes = resolve_hashes_for_files(&model_details.siblings, &files, input.hashes.as_ref());

    let endpoint_raw = normalize_non_empty(input.endpoint.as_deref())
        .unwrap_or_else(|| default_endpoint_for_engine(engine.as_str()));
    let endpoint = validate_loopback_endpoint(endpoint_raw.as_str())?;
    let engine_runtime_mode = runtime_mode_for_engine(engine.as_str(), profile);
    let install_available = install_available_for_engine(
        engine.as_str(),
        &engine_runtime_mode,
        Some(endpoint.as_str()),
        profile,
    );

    let mut warnings = Vec::<String>::new();
    if hashes.is_empty() {
        warnings.push("install plan does not include per-file hashes; runtime will verify downloaded files only when hashes are available".to_string());
    }

    let model_id = normalize_non_empty(input.model_id.as_deref())
        .or_else(|| normalize_non_empty(Some(model_details.id.as_str())))
        .unwrap_or_else(|| repo.clone());

    let license = infer_license(&model_details.tags, input.license.as_deref());
    let recommendation = build_recommendation_candidate(
        model_id.as_str(),
        repo.as_str(),
        model_id.as_str(),
        capabilities.as_slice(),
        engine.as_str(),
        Some(entry.as_str()),
        model_details
            .siblings
            .iter()
            .find(|item| item.rfilename.trim() == entry)
            .and_then(sibling_size_bytes),
        known_total_size_bytes(&model_details.siblings, &files),
        files
            .iter()
            .filter(|file| *file != &entry)
            .cloned()
            .collect::<Vec<_>>(),
        model_details.tags.as_slice(),
    )
    .and_then(|candidate| build_catalog_recommendation(&candidate, profile));

    Ok(LocalAiInstallPlanDescriptor {
        plan_id: format!("plan:hf:{}", slugify_local_model_id(model_id.as_str())),
        item_id: normalize_non_empty(input.item_id.as_deref())
            .unwrap_or_else(|| format!("hf:{repo}")),
        source: "huggingface".to_string(),
        template_id: None,
        model_id,
        repo,
        revision,
        capabilities,
        engine_runtime_mode,
        engine,
        install_kind: "hf-install-plan".to_string(),
        install_available,
        endpoint,
        provider_hints,
        entry,
        files,
        license,
        hashes,
        warnings,
        reason_code: None,
        engine_config: None,
        recommendation,
    })
}

fn hydrate_catalog_item_for_recommendation(
    item: &mut LocalAiCatalogItemDescriptor,
    profile: &LocalAiDeviceProfile,
) -> Result<(), String> {
    let has_recommendable_capability = item
        .capabilities
        .iter()
        .any(|value| value == "image" || value == "video" || value == "chat");
    if !has_recommendable_capability || item.recommendation.is_some() {
        return Ok(());
    }

    let details = fetch_hf_model_details(item.repo.as_str())?;
    let entry = select_entry_file(&details.siblings, item.entry.as_deref(), item.engine.as_str())
        .unwrap_or_else(|| item.entry.clone().unwrap_or_else(|| "model.bin".to_string()));
    let files = select_install_files(
        &details.siblings,
        entry.as_str(),
        item.entry.as_deref(),
        if item.files.is_empty() {
            None
        } else {
            Some(item.files.as_slice())
        },
        item.engine.as_str(),
    );
    let hashes = resolve_hashes_for_files(&details.siblings, &files, Some(&item.hashes));
    let title = if item.title.trim().is_empty() {
        item.model_id.clone()
    } else {
        item.title.clone()
    };
    let recommendation = build_recommendation_candidate(
        item.model_id.as_str(),
        item.repo.as_str(),
        title.as_str(),
        item.capabilities.as_slice(),
        item.engine.as_str(),
        Some(entry.as_str()),
        details
            .siblings
            .iter()
            .find(|sibling| sibling.rfilename.trim() == entry)
            .and_then(sibling_size_bytes),
        known_total_size_bytes(&details.siblings, &files),
        files
            .iter()
            .filter(|file| *file != &entry)
            .cloned()
            .collect::<Vec<_>>(),
        details.tags.as_slice(),
    )
    .and_then(|candidate| build_catalog_recommendation(&candidate, profile));

    item.entry = Some(entry);
    item.files = files;
    item.hashes = hashes;
    item.license = Some(infer_license(&details.tags, item.license.as_deref()));
    item.recommendation = recommendation;
    Ok(())
}
