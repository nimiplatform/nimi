use tonic::transport::Channel;

use crate::generated::ResolveLocalAppAvatarHostTargetRequest;
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAvatarHostTargetResolveRequest, LocalAppAvatarHostTargetResolveResult,
    LocalAppOperationError,
};

use super::{invalid_payload, untrusted};

const AGENT_HANDLE_PREFIX: &str = "agent_ref_";
const AVATAR_HOST_TARGET_REF_PREFIX: &str = "avatar_target_";
const OPAQUE_SUFFIX_BYTES: usize = 43;
const MAX_CONVERSATION_ANCHOR_BYTES: usize = 256;

pub(super) async fn resolve(
    channel: Channel,
    request: LocalAppAvatarHostTargetResolveRequest,
) -> Result<LocalAppAvatarHostTargetResolveResult, LocalAppOperationError> {
    require_prefixed_opaque(
        &request.agent_handle,
        AGENT_HANDLE_PREFIX,
        OPAQUE_SUFFIX_BYTES,
    )?;
    if let Some(anchor_id) = request.conversation_anchor_id.as_deref() {
        if anchor_id.is_empty()
            || anchor_id.trim() != anchor_id
            || anchor_id.len() > MAX_CONVERSATION_ANCHOR_BYTES
            || anchor_id.chars().any(char::is_control)
        {
            return Err(invalid_payload());
        }
    }
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .resolve_local_app_avatar_host_target(ResolveLocalAppAvatarHostTargetRequest {
            agent_handle: request.agent_handle,
            conversation_anchor_id: request.conversation_anchor_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_prefixed_opaque(
        &response.avatar_host_target_ref,
        AVATAR_HOST_TARGET_REF_PREFIX,
        OPAQUE_SUFFIX_BYTES,
    )
    .map_err(|_| untrusted())?;
    Ok(LocalAppAvatarHostTargetResolveResult {
        avatar_host_target_ref: response.avatar_host_target_ref,
    })
}

fn require_prefixed_opaque(
    value: &str,
    prefix: &str,
    suffix_bytes: usize,
) -> Result<(), LocalAppOperationError> {
    if !value.starts_with(prefix)
        || value.len() != prefix.len() + suffix_bytes
        || !value
            .bytes()
            .skip(prefix.len())
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(invalid_payload());
    }
    Ok(())
}
