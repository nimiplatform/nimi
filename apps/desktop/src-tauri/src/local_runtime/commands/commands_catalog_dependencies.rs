#[tauri::command]
pub async fn runtime_local_models_catalog_list_variants(
    app: AppHandle,
    payload: LocalAiModelsCatalogListVariantsPayload,
) -> Result<Vec<CatalogVariantDescriptor>, String> {
    let repo = payload.repo.as_deref().unwrap_or_default().trim();
    if repo.is_empty() {
        return Err("LOCAL_AI_LIST_VARIANTS_REPO_REQUIRED: repo is required".to_string());
    }
    append_recommendation_resolve_invoked(&app, repo, Some(repo), None);
    let profile = collect_device_profile_async(&app).await;
    match list_catalog_variants_async(repo, &profile).await {
        Ok(variants) => {
            for variant in &variants {
                if let Some(recommendation) = variant.recommendation.as_ref() {
                    append_recommendation_resolve_completed(
                        &app,
                        format!("{repo}#{}", variant.entry).as_str(),
                        Some(repo),
                        None,
                        recommendation,
                    );
                }
            }
            Ok(variants)
        }
        Err(error) => {
            append_recommendation_resolve_failed(&app, repo, Some(repo), None, error.as_str());
            Err(error)
        }
    }
}
