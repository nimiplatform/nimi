use super::{DesktopLocalDevelopmentRuntime, LocalDevelopmentRunStatus};
use axum::{
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MAX_REQUEST_BYTES: usize = 32 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartRequest {
    schema_version: u8,
    app_id: String,
    project_root: String,
    shell: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunRequest {
    schema_version: u8,
    run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeResponse {
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    run: Option<LocalDevelopmentRunStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    action_hint: Option<&'static str>,
}

pub(super) fn router(runtime: DesktopLocalDevelopmentRuntime) -> Router {
    Router::new()
        .route("/v1/start", post(start))
        .route("/v1/status", post(status))
        .route("/v1/cancel", post(cancel))
        .fallback(reject_unknown)
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .with_state(runtime)
}

async fn start(
    State(runtime): State<DesktopLocalDevelopmentRuntime>,
    headers: HeaderMap,
    Json(request): Json<StartRequest>,
) -> impl IntoResponse {
    if let Err(reason) = validate_request(&headers, request.schema_version) {
        return error_response(reason);
    }
    let run = runtime
        .start_intent(request.app_id, request.project_root, request.shell)
        .await;
    if run.run_id.is_empty() {
        return (
            StatusCode::OK,
            Json(BridgeResponse {
                status: "error",
                reason_code: run.reason_code.clone(),
                action_hint: Some("fix_local_development_project"),
                run: Some(run),
            }),
        );
    }
    ok_response(run)
}

async fn status(
    State(runtime): State<DesktopLocalDevelopmentRuntime>,
    headers: HeaderMap,
    Json(request): Json<RunRequest>,
) -> impl IntoResponse {
    if let Err(reason) = validate_request(&headers, request.schema_version) {
        return error_response(reason);
    }
    match runtime.status(&request.run_id).await {
        Some(run) => ok_response(run),
        None => error_response("local-development-run-not-found".to_string()),
    }
}

async fn cancel(
    State(runtime): State<DesktopLocalDevelopmentRuntime>,
    headers: HeaderMap,
    Json(request): Json<RunRequest>,
) -> impl IntoResponse {
    if let Err(reason) = validate_request(&headers, request.schema_version) {
        return error_response(reason);
    }
    match runtime.cancel(&request.run_id).await {
        Some(run) => ok_response(run),
        None => error_response("local-development-run-not-found".to_string()),
    }
}

async fn reject_unknown() -> impl IntoResponse {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "status": "error",
            "reasonCode": "local-development-intent-invalid",
            "actionHint": "use_official_nimi_app_dev_launcher",
        })),
    )
}

fn validate_request(headers: &HeaderMap, schema_version: u8) -> Result<(), String> {
    if schema_version != 1 {
        return Err("local-development-intent-invalid".to_string());
    }
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !content_type.starts_with("application/json") {
        return Err("local-development-intent-invalid".to_string());
    }
    if headers.contains_key(header::ORIGIN) || headers.contains_key(header::REFERER) {
        return Err("local-development-renderer-intent-forbidden".to_string());
    }
    Ok(())
}

fn ok_response(run: LocalDevelopmentRunStatus) -> (StatusCode, Json<BridgeResponse>) {
    (
        StatusCode::OK,
        Json(BridgeResponse {
            status: "ok",
            run: Some(run),
            reason_code: None,
            action_hint: None,
        }),
    )
}

fn error_response(reason_code: String) -> (StatusCode, Json<BridgeResponse>) {
    (
        StatusCode::OK,
        Json(BridgeResponse {
            status: "error",
            run: None,
            reason_code: Some(reason_code),
            action_hint: Some("use_official_nimi_app_dev_launcher"),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_origin_and_non_json_requests_are_rejected() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());
        assert!(validate_request(&headers, 1).is_ok());
        headers.insert(header::ORIGIN, "http://127.0.0.1:1468".parse().unwrap());
        assert_eq!(
            validate_request(&headers, 1).unwrap_err(),
            "local-development-renderer-intent-forbidden"
        );
        headers.remove(header::ORIGIN);
        headers.insert(header::CONTENT_TYPE, "text/plain".parse().unwrap());
        assert!(validate_request(&headers, 1).is_err());
    }
}
