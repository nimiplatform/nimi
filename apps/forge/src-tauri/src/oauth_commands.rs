use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;

use serde::{Deserialize, Serialize};
use url::Url;

// ---------------------------------------------------------------------------
// Payloads / Results
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlPayload {
    pub url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalUrlResult {
    pub opened: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthTokenExchangePayload {
    pub token_url: String,
    pub client_id: String,
    pub code: String,
    pub code_verifier: Option<String>,
    pub redirect_uri: Option<String>,
    pub client_secret: Option<String>,
    pub extra: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthTokenExchangeResult {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub token_type: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
    pub raw: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthListenForCodePayload {
    pub redirect_uri: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthListenForCodeResult {
    pub callback_url: String,
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

fn is_loopback_http(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
}

fn validate_external_url(url: &Url) -> Result<(), String> {
    if url.scheme() == "https" || is_loopback_http(url) {
        return Ok(());
    }
    Err("Only https or localhost/127.0.0.1 http URLs are allowed".to_string())
}

fn parse_oauth_redirect_uri(redirect_uri: &str) -> Result<(String, u16, String), String> {
    let url = Url::parse(redirect_uri).map_err(|error| error.to_string())?;
    if url.scheme() != "http" {
        return Err("OAuth redirect_uri must be http loopback".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "OAuth redirect_uri missing host".to_string())?
        .to_ascii_lowercase();
    if host != "localhost" && host != "127.0.0.1" {
        return Err("OAuth redirect_uri host must be localhost or 127.0.0.1".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "OAuth redirect_uri missing port".to_string())?;
    let path = if url.path().trim().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    Ok((host, port, path))
}

fn read_request_target(stream: &mut std::net::TcpStream) -> Result<String, String> {
    let mut buffer = [0_u8; 8192];
    let bytes = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    if bytes == 0 {
        return Err("OAuth callback request body is empty".to_string());
    }
    let request = String::from_utf8_lossy(&buffer[..bytes]);
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "OAuth callback request format is invalid".to_string())?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_ascii_uppercase();
    let target = parts.next().unwrap_or_default().to_string();
    if method != "GET" {
        return Err(format!("OAuth callback only supports GET, got {method}"));
    }
    if target.trim().is_empty() {
        return Err("OAuth callback missing request target".to_string());
    }
    Ok(target)
}

fn write_oauth_callback_page(stream: &mut std::net::TcpStream, success: bool) {
    let body = render_oauth_callback_page(success);
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

const DESKTOP_OAUTH_RESULT_PAGE_TEMPLATE: &str = include_str!(
    "../../../../kit/auth/src/logic/native-oauth-result-page.template.html"
);

fn render_oauth_callback_page(success: bool) -> String {
    if success {
        DESKTOP_OAUTH_RESULT_PAGE_TEMPLATE
            .replace("__PAGE_TITLE__", "OAuth Complete - Nimi")
            .replace("__BODY_BACKGROUND__", "#ffffff")
            .replace("__LOGO_ANIMATION_NAME__", "float")
            .replace("__LOGO_ANIMATION_DURATION__", "3s")
            .replace("__LOGO_ANIMATION_REPEAT__", "infinite")
            .replace("__LOGO_FILTER__", "none")
            .replace(
                "__SUCCESS_ICON_ANIMATION__",
                "scaleIn 0.5s ease-out 0.3s both",
            )
            .replace("__ERROR_ICON_ANIMATION__", "scaleIn 0.5s ease-out")
            .replace("__STATUS_ICON_CLASS__", "success_icon")
            .replace(
                "__STATUS_ICON_SVG__",
                r#"<svg class="checkmark" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>"#,
            )
            .replace("__HEADING__", "Authentication Complete!")
            .replace("__HEADING_ANIMATION__", "fadeIn 0.5s ease-out 0.4s both")
            .replace(
                "__MESSAGE_PRIMARY__",
                "You have successfully signed in to Nimi.",
            )
            .replace("__MESSAGE_ANIMATION__", "fadeIn 0.5s ease-out 0.5s both")
            .replace("__MESSAGE_SECONDARY_BLOCK__", "")
            .replace(
                "__ACTION_BLOCK__",
                r#"<div class="auto_close">You can close this window now<span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>"#,
            )
            .replace("__ACTION_ANIMATION__", "fadeIn 0.5s ease-out 0.7s both")
            .replace(
                "__AUTO_CLOSE_SCRIPT__",
                r#"<script>setTimeout(function(){window.close();}, 3000);</script>"#,
            )
    } else {
        DESKTOP_OAUTH_RESULT_PAGE_TEMPLATE
            .replace("__PAGE_TITLE__", "OAuth Failed - Nimi")
            .replace(
                "__BODY_BACKGROUND__",
                "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
            )
            .replace("__LOGO_ANIMATION_NAME__", "shake")
            .replace("__LOGO_ANIMATION_DURATION__", "0.8s")
            .replace("__LOGO_ANIMATION_REPEAT__", "1")
            .replace(
                "__LOGO_FILTER__",
                "drop-shadow(0 10px 20px rgba(240, 147, 251, 0.3))",
            )
            .replace(
                "__SUCCESS_ICON_ANIMATION__",
                "scaleIn 0.5s ease-out 0.3s both",
            )
            .replace("__ERROR_ICON_ANIMATION__", "scaleIn 0.5s ease-out")
            .replace("__STATUS_ICON_CLASS__", "error_icon")
            .replace(
                "__STATUS_ICON_SVG__",
                r#"<svg class="x_mark" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>"#,
            )
            .replace("__HEADING__", "Authentication Failed")
            .replace("__HEADING_ANIMATION__", "fadeIn 0.5s ease-out 0.2s both")
            .replace(
                "__MESSAGE_PRIMARY__",
                "Something went wrong during the sign-in process.",
            )
            .replace("__MESSAGE_ANIMATION__", "fadeIn 0.5s ease-out 0.3s both")
            .replace(
                "__MESSAGE_SECONDARY_BLOCK__",
                "<p>Please return to the app and try again.</p>",
            )
            .replace(
                "__ACTION_BLOCK__",
                r#"<button class="retry_btn" onclick="window.close()">Close Window</button>"#,
            )
            .replace("__ACTION_ANIMATION__", "fadeIn 0.5s ease-out 0.4s both")
            .replace("__AUTO_CLOSE_SCRIPT__", "")
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.trim().to_ascii_lowercase();
    normalized == "authorization"
        || normalized == "cookie"
        || normalized.contains("token")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
}

fn preview_text_utf8_safe(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }
    let mut end = max_bytes.min(input.len());
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }
    let head = &input[..end];
    format!("{head}... (truncated, {} bytes total)", input.len())
}

fn redact_body_preview(input: &str, max_bytes: usize) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            redact_json_value(&mut parsed);
            if let Ok(redacted) = serde_json::to_string(&parsed) {
                return preview_text_utf8_safe(&redacted, max_bytes);
            }
        }
    }
    preview_text_utf8_safe("<unparseable response body>", max_bytes)
}

fn redact_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let keys = map.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if let Some(entry) = map.get_mut(&key) {
                    if is_sensitive_key(&key) {
                        *entry = serde_json::Value::String("[REDACTED]".to_string());
                    } else {
                        redact_json_value(entry);
                    }
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_json_value(item);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Blocking OAuth listener
// ---------------------------------------------------------------------------

fn oauth_listen_for_code_blocking(
    payload: OauthListenForCodePayload,
) -> Result<OauthListenForCodeResult, String> {
    let (host, port, expected_path) = parse_oauth_redirect_uri(payload.redirect_uri.as_str())?;
    let bind_host = if host == "localhost" {
        "127.0.0.1".to_string()
    } else {
        host.clone()
    };
    let address = format!("{bind_host}:{port}");
    let listener = TcpListener::bind(address.as_str()).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let timeout_ms = payload.timeout_ms.unwrap_or(180_000).clamp(10_000, 600_000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(|error| error.to_string())?;
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let target = read_request_target(&mut stream)?;
                if !target.starts_with(expected_path.as_str()) {
                    write_oauth_callback_page(&mut stream, false);
                    continue;
                }

                let callback_url = format!("http://localhost:{port}{target}");
                let parsed =
                    Url::parse(callback_url.as_str()).map_err(|error| error.to_string())?;
                let code = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "code")
                    .map(|(_, value)| value.to_string());
                let state = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "state")
                    .map(|(_, value)| value.to_string());
                let error = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "error")
                    .map(|(_, value)| value.to_string());

                write_oauth_callback_page(&mut stream, code.is_some() && error.is_none());

                return Ok(OauthListenForCodeResult {
                    callback_url,
                    code,
                    state,
                    error,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("OAuth callback timed out".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            Err(error) => {
                return Err(error.to_string());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_external_url(payload: OpenExternalUrlPayload) -> Result<OpenExternalUrlResult, String> {
    let parsed = Url::parse(payload.url.as_str()).map_err(|error| error.to_string())?;
    validate_external_url(&parsed)?;
    webbrowser::open(parsed.as_str()).map_err(|error| error.to_string())?;
    Ok(OpenExternalUrlResult { opened: true })
}

#[tauri::command]
pub async fn oauth_token_exchange(
    payload: OauthTokenExchangePayload,
) -> Result<OauthTokenExchangeResult, String> {
    let token_url = Url::parse(payload.token_url.as_str()).map_err(|error| error.to_string())?;
    validate_external_url(&token_url)?;

    let mut form = HashMap::<String, String>::new();
    form.insert("grant_type".to_string(), "authorization_code".to_string());
    form.insert(
        "client_id".to_string(),
        payload.client_id.trim().to_string(),
    );
    form.insert("code".to_string(), payload.code.trim().to_string());

    if let Some(value) = payload.code_verifier.as_deref() {
        let normalized = value.trim();
        if !normalized.is_empty() {
            form.insert("code_verifier".to_string(), normalized.to_string());
        }
    }
    if let Some(value) = payload.redirect_uri.as_deref() {
        let normalized = value.trim();
        if !normalized.is_empty() {
            form.insert("redirect_uri".to_string(), normalized.to_string());
        }
    }
    if let Some(value) = payload.client_secret.as_deref() {
        let normalized = value.trim();
        if !normalized.is_empty() {
            form.insert("client_secret".to_string(), normalized.to_string());
        }
    }
    if let Some(extra) = payload.extra {
        for (key, value) in extra {
            let normalized_key = key.trim().to_string();
            if normalized_key.is_empty() {
                continue;
            }
            form.insert(normalized_key, value);
        }
    }

    let response = reqwest::Client::new()
        .post(token_url.clone())
        .header("content-type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let status = response.status();
    let body_text = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let body_preview = redact_body_preview(&body_text, 300);
        return Err(format!(
            "OAuth token exchange failed: HTTP {} body={}",
            status, body_preview
        ));
    }

    let parsed = serde_json::from_str::<serde_json::Value>(&body_text)
        .map_err(|error| format!("OAuth token response is not JSON: {error}"))?;

    let access_token = parsed
        .get("access_token")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "OAuth token response missing access_token".to_string())?;

    let refresh_token = parsed
        .get("refresh_token")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let token_type = parsed
        .get("token_type")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let scope = parsed
        .get("scope")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let expires_in = parsed.get("expires_in").and_then(|value| value.as_i64());

    Ok(OauthTokenExchangeResult {
        access_token,
        refresh_token,
        token_type,
        expires_in,
        scope,
        raw: parsed,
    })
}

#[tauri::command]
pub async fn oauth_listen_for_code(
    payload: OauthListenForCodePayload,
) -> Result<OauthListenForCodeResult, String> {
    tauri::async_runtime::spawn_blocking(move || oauth_listen_for_code_blocking(payload))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{redact_body_preview, redact_json_value};

    #[test]
    fn redact_body_preview_masks_sensitive_json_keys() {
        let preview = redact_body_preview(
            r#"{"access_token":"abc","nested":{"refreshToken":"def","name":"ok"}}"#,
            200,
        );
        assert!(preview.contains("[REDACTED]"));
        assert!(!preview.contains("abc"));
        assert!(!preview.contains("def"));
        assert!(preview.contains("\"name\":\"ok\""));
    }

    #[test]
    fn redact_body_preview_hides_unparseable_body_contents() {
        let preview = redact_body_preview("access_token=secret-value", 200);
        assert_eq!(preview, "<unparseable response body>");
        assert!(!preview.contains("secret-value"));
    }

    #[test]
    fn redact_json_value_masks_nested_sensitive_fields() {
        let mut value = serde_json::json!({
            "sessionToken": "top-secret",
            "items": [
                {
                    "cookie": "cookie-value"
                }
            ]
        });
        redact_json_value(&mut value);
        let rendered = serde_json::to_string(&value).expect("json serialization must succeed");
        assert!(rendered.contains("[REDACTED]"));
        assert!(!rendered.contains("top-secret"));
        assert!(!rendered.contains("cookie-value"));
    }
}
