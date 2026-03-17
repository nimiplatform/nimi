#[tauri::command]
pub fn runtime_local_recommendation_feed_get(
    app: AppHandle,
    payload: Option<LocalAiRecommendationFeedGetPayload>,
) -> Result<LocalAiRecommendationFeedDescriptor, String> {
    let capability = payload
        .as_ref()
        .and_then(|item| normalize_optional(item.capability.clone()));
    let page_size = payload.as_ref().and_then(|item| item.page_size);
    let normalized_capability = capability.unwrap_or_else(|| "chat".to_string());
    append_recommendation_feed_resolve_invoked(&app, normalized_capability.as_str());
    match load_recommendation_feed(&app, Some(normalized_capability.as_str()), page_size) {
        Ok(feed) => {
            append_recommendation_feed_resolve_completed(
                &app,
                normalized_capability.as_str(),
                &feed.cache_state,
                feed.items.len(),
            );
            Ok(feed)
        }
        Err(error) => {
            append_recommendation_feed_resolve_failed(
                &app,
                normalized_capability.as_str(),
                error.as_str(),
            );
            Err(error)
        }
    }
}
