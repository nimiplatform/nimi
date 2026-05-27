use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const DEFAULT_MARBLE_API_URL: &str = "https://api.worldlabs.ai/marble/v1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarbleGenerateInput {
    display_name: String,
    prompt: String,
    image_url: Option<String>,
    quality: String,
}

#[derive(Debug, Serialize)]
struct MarbleWorldPrompt {
    #[serde(rename = "type")]
    prompt_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    image_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct MarbleGenerateRequest {
    display_name: String,
    model: String,
    world_prompt: MarbleWorldPrompt,
}

fn marble_api_key() -> Result<String, String> {
    let api_key = std::env::var("MARBLE_API_KEY")
        .unwrap_or_default()
        .trim()
        .to_string();
    if api_key.is_empty() {
        return Err("MARBLE_API_KEY_MISSING".to_string());
    }
    Ok(api_key)
}

fn marble_api_url() -> String {
    std::env::var("MARBLE_API_URL")
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string()
        .chars()
        .collect::<String>()
        .if_empty(DEFAULT_MARBLE_API_URL)
}

fn marble_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("MARBLE_CLIENT_INIT_FAILED: {error}"))
}

fn map_status(status: reqwest::StatusCode, body: &str) -> String {
    match status.as_u16() {
        429 => "MARBLE_RATE_LIMITED".to_string(),
        401 => "MARBLE_UNAUTHORIZED".to_string(),
        403 => "MARBLE_FORBIDDEN".to_string(),
        value => {
            if body.is_empty() {
                format!("MARBLE_HTTP_{value}")
            } else {
                format!("MARBLE_HTTP_{value}: {body}")
            }
        }
    }
}

async fn parse_response(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("MARBLE_RESPONSE_READ_FAILED: {error}"))?;
    if !status.is_success() {
        return Err(map_status(status, text.as_str()));
    }
    serde_json::from_str::<Value>(text.as_str())
        .map_err(|error| format!("MARBLE_RESPONSE_JSON_INVALID: {error}"))
}

fn generation_request(input: MarbleGenerateInput) -> Result<MarbleGenerateRequest, String> {
    let display_name = input.display_name.trim().to_string();
    let prompt = input.prompt.trim().to_string();
    if display_name.is_empty() {
        return Err("MARBLE_DISPLAY_NAME_REQUIRED".to_string());
    }
    if prompt.is_empty() {
        return Err("MARBLE_PROMPT_REQUIRED".to_string());
    }
    let model = match input.quality.as_str() {
        "mini" => "mini",
        "standard" => "standard",
        _ => return Err("MARBLE_MODEL_INVALID".to_string()),
    }
    .to_string();
    let image_url = input.image_url.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let world_prompt = match image_url {
        Some(value) => MarbleWorldPrompt {
            prompt_type: "image".to_string(),
            text_prompt: None,
            image_url: Some(value),
        },
        None => MarbleWorldPrompt {
            prompt_type: "text".to_string(),
            text_prompt: Some(prompt),
            image_url: None,
        },
    };
    Ok(MarbleGenerateRequest {
        display_name,
        model,
        world_prompt,
    })
}

#[tauri::command]
pub async fn realm_drift_marble_generate(input: MarbleGenerateInput) -> Result<Value, String> {
    let api_key = marble_api_key()?;
    let request = generation_request(input)?;
    let url = format!("{}/worlds:generate", marble_api_url());
    let response = marble_client()?
        .post(url)
        .header("WLT-Api-Key", api_key)
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|error| format!("MARBLE_REQUEST_FAILED: {error}"))?;
    parse_response(response).await
}

#[tauri::command]
pub async fn realm_drift_marble_poll(operation_id: String) -> Result<Value, String> {
    let operation_id = operation_id.trim().to_string();
    if operation_id.is_empty() {
        return Err("MARBLE_OPERATION_ID_REQUIRED".to_string());
    }
    let api_key = marble_api_key()?;
    let url = format!("{}/operations/{}", marble_api_url(), operation_id);
    let response = marble_client()?
        .get(url)
        .header("WLT-Api-Key", api_key)
        .send()
        .await
        .map_err(|error| format!("MARBLE_REQUEST_FAILED: {error}"))?;
    parse_response(response).await
}

trait IfEmpty {
    fn if_empty(self, fallback: &str) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn generation_request_rejects_invalid_model() {
        let error = generation_request(MarbleGenerateInput {
            display_name: "World".to_string(),
            prompt: "Prompt".to_string(),
            image_url: None,
            quality: "auto".to_string(),
        })
        .expect_err("invalid model must fail closed");
        assert_eq!(error, "MARBLE_MODEL_INVALID");
    }

    #[test]
    fn generation_request_uses_text_prompt_without_image() {
        let request = generation_request(MarbleGenerateInput {
            display_name: "World".to_string(),
            prompt: "Prompt".to_string(),
            image_url: None,
            quality: "mini".to_string(),
        })
        .expect("request");
        let value = serde_json::to_value(request).expect("json");
        assert_eq!(value["world_prompt"], json!({ "type": "text", "text_prompt": "Prompt" }));
    }

    #[test]
    fn generation_request_uses_image_prompt_when_present() {
        let request = generation_request(MarbleGenerateInput {
            display_name: "World".to_string(),
            prompt: "Prompt".to_string(),
            image_url: Some("https://example.com/image.jpg".to_string()),
            quality: "standard".to_string(),
        })
        .expect("request");
        let value = serde_json::to_value(request).expect("json");
        assert_eq!(
            value["world_prompt"],
            json!({ "type": "image", "image_url": "https://example.com/image.jpg" })
        );
        assert_eq!(value["model"], "standard");
    }
}
