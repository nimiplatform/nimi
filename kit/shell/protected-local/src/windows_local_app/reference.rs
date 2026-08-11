use std::collections::HashSet;

use tonic::transport::Channel;
use url::Url;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::ListLocalAppAgentReferencesRequest;
use crate::{LocalAppAgentReference, LocalAppOperationError};

use super::untrusted;

const AGENT_HANDLE_PREFIX: &str = "agent_ref_";
const MAX_DISPLAY_NAME_BYTES: usize = 256;
const MAX_AVATAR_URL_BYTES: usize = 2048;

pub(super) async fn list(
    channel: Channel,
) -> Result<Vec<LocalAppAgentReference>, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .list_local_app_agent_references(ListLocalAppAgentReferencesRequest {})
        .await
        .map_err(crate::grpc_status::local_app_error_from_status)?
        .into_inner();
    let mut handles = HashSet::with_capacity(response.references.len());
    response
        .references
        .into_iter()
        .map(|reference| {
            if !safe_handle(&reference.agent_handle)
                || !safe_display_name(&reference.display_name)
                || !handles.insert(reference.agent_handle.clone())
                || reference
                    .avatar_url
                    .as_deref()
                    .is_some_and(|value| !safe_avatar_url(value))
            {
                return Err(untrusted());
            }
            Ok(LocalAppAgentReference {
                agent_handle: reference.agent_handle,
                display_name: reference.display_name,
                avatar_url: reference.avatar_url,
            })
        })
        .collect()
}

fn safe_handle(value: &str) -> bool {
    value.starts_with(AGENT_HANDLE_PREFIX)
        && value.len() == AGENT_HANDLE_PREFIX.len() + 43
        && value
            .bytes()
            .skip(AGENT_HANDLE_PREFIX.len())
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn safe_display_name(value: &str) -> bool {
    !value.is_empty()
        && value.trim() == value
        && value.len() <= MAX_DISPLAY_NAME_BYTES
        && !value.chars().any(char::is_control)
}

fn safe_avatar_url(value: &str) -> bool {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_AVATAR_URL_BYTES
        || value.chars().any(char::is_control)
    {
        return false;
    }
    let Ok(parsed) = Url::parse(value) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && parsed.port_or_known_default() == Some(443)
        && parsed.host_str().is_some_and(|host| {
            let host = host.trim_end_matches('.').to_ascii_lowercase();
            host != "localhost"
                && !host.ends_with(".localhost")
                && !host.ends_with(".local")
                && !host.ends_with(".internal")
                && host.parse::<std::net::IpAddr>().is_err()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_projection_rejects_identity_and_credential_shaped_urls() {
        assert!(safe_handle(
            "agent_ref_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        ));
        assert!(!safe_handle("local-agent-private"));
        assert!(safe_avatar_url("https://cdn.nimi.ai/avatar.webp"));
        for value in [
            "https://cdn.nimi.ai/avatar?token=private",
            "https://user:secret@cdn.nimi.ai/avatar", // pragma: allowlist secret
            "http://127.0.0.1:3002/avatar",
            "file:///Users/private/avatar.png",
        ] {
            assert!(!safe_avatar_url(value), "{value}");
        }
    }
}
