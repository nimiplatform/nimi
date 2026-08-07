use tonic::{transport::Channel, Request};

use crate::generated::runtime_ai_service_client::RuntimeAiServiceClient;
use crate::generated::{
    GenerateLocalAppTextCandidateRequest, LocalAppTextCandidateMessage as ProtoMessage,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{LocalAppOperationError, LocalAppTextCandidateRequest, LocalAppTextCandidateResult};

use super::{invalid_payload, untrusted};

const MAX_MESSAGES: usize = 8;
const MAX_MESSAGE_BYTES: usize = 32 * 1024;
const MAX_PROMPT_BYTES: usize = 64 * 1024;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_TOKENS: i32 = 4096;

pub(super) async fn generate(
    channel: Channel,
    request: LocalAppTextCandidateRequest,
) -> Result<LocalAppTextCandidateResult, LocalAppOperationError> {
    validate_request(&request)?;
    let mut grpc_request = Request::new(GenerateLocalAppTextCandidateRequest {
        messages: request
            .messages
            .into_iter()
            .map(|message| ProtoMessage {
                role: message.role,
                text: message.text,
            })
            .collect(),
        temperature: request.temperature,
        top_p: request.top_p,
        max_tokens: request.max_tokens,
    });
    grpc_request.set_timeout(std::time::Duration::from_secs(120));
    let response = RuntimeAiServiceClient::new(channel)
        .generate_local_app_text_candidate(grpc_request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if !valid_response_text(&response.text)
        || response.trace_id.trim().is_empty()
        || response.trace_id.trim() != response.trace_id
    {
        return Err(untrusted());
    }
    let finish_reason = match response.finish_reason {
        1 => "stop",
        2 => "length",
        4 => "content-filter",
        _ => return Err(untrusted()),
    };
    Ok(LocalAppTextCandidateResult {
        text: response.text,
        finish_reason: finish_reason.to_string(),
        trace_id: response.trace_id,
    })
}

fn valid_response_text(text: &str) -> bool {
    !text.trim().is_empty() && text.len() <= MAX_OUTPUT_BYTES
}

fn validate_request(request: &LocalAppTextCandidateRequest) -> Result<(), LocalAppOperationError> {
    if request.messages.is_empty()
        || request.messages.len() > MAX_MESSAGES
        || !request.temperature.is_finite()
        || !(0.0..=2.0).contains(&request.temperature)
        || !request.top_p.is_finite()
        || !(0.0..=1.0).contains(&request.top_p)
        || !(1..=MAX_TOKENS).contains(&request.max_tokens)
    {
        return Err(invalid_payload());
    }
    let mut total_bytes = 0usize;
    let mut saw_system = false;
    let mut saw_user = false;
    for message in &request.messages {
        let text_bytes = message.text.len();
        if message.text.trim().is_empty()
            || message.text.trim() != message.text
            || text_bytes > MAX_MESSAGE_BYTES
        {
            return Err(invalid_payload());
        }
        match message.role.as_str() {
            "system" if !saw_system && !saw_user => saw_system = true,
            "user" => saw_user = true,
            _ => return Err(invalid_payload()),
        }
        total_bytes = total_bytes
            .checked_add(message.role.len() + text_bytes)
            .ok_or_else(invalid_payload)?;
        if total_bytes > MAX_PROMPT_BYTES {
            return Err(invalid_payload());
        }
    }
    if !saw_user {
        return Err(invalid_payload());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalAppTextCandidateMessage;

    #[test]
    fn text_candidate_request_is_closed() {
        let valid = LocalAppTextCandidateRequest {
            messages: vec![
                LocalAppTextCandidateMessage {
                    role: "system".to_string(),
                    text: "Return JSON.".to_string(),
                },
                LocalAppTextCandidateMessage {
                    role: "user".to_string(),
                    text: "Create a persona.".to_string(),
                },
            ],
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 512,
        };
        validate_request(&valid).expect("valid exact request");

        let mut invalid = valid.clone();
        invalid.messages.push(LocalAppTextCandidateMessage {
            role: "assistant".to_string(),
            text: "not admitted".to_string(),
        });
        assert!(validate_request(&invalid).is_err());
    }

    #[test]
    fn text_candidate_response_is_non_empty_and_bounded() {
        assert!(valid_response_text("  {\"name\":\"Lin\"}\n"));
        assert!(!valid_response_text(" \n\t "));
        assert!(!valid_response_text(&"x".repeat(MAX_OUTPUT_BYTES + 1)));
    }
}
