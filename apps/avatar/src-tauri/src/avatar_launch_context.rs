use serde::{Deserialize, Serialize};
use url::Url;

pub const AVATAR_LAUNCH_SCHEME: &str = "nimi-avatar";
pub const AVATAR_LAUNCH_HOST: &str = "launch";
pub const AVATAR_CLOSE_HOST: &str = "close";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarLaunchContext {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub avatar_instance_id: Option<String>,
    pub launch_source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AvatarRendererLaunchContext {
    pub agent_handle: String,
    pub conversation_anchor_id: String,
    pub avatar_instance_id: Option<String>,
    pub launch_source: Option<String>,
}

impl From<&AvatarLaunchContext> for AvatarRendererLaunchContext {
    fn from(context: &AvatarLaunchContext) -> Self {
        Self {
            agent_handle: context.agent_handle.clone(),
            conversation_anchor_id: context.conversation_anchor_id.clone(),
            avatar_instance_id: context.avatar_instance_id.clone(),
            launch_source: context.launch_source.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarCloseRequest {
    pub avatar_instance_id: String,
    pub closed_by: String,
    pub source_surface: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AvatarDeepLinkRequest {
    Launch(AvatarLaunchContext),
    Close(AvatarCloseRequest),
}

fn normalize_required_query_value(value: Option<String>, field: &str) -> Result<String, String> {
    let normalized = value.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        return Err(format!("missing required launch context field: {field}"));
    }
    Ok(normalized)
}

fn normalize_required_agent_handle(value: Option<String>) -> Result<String, String> {
    let normalized = normalize_required_query_value(value, "agent_handle")?;
    let body = normalized.strip_prefix("agent_ref_").unwrap_or_default();
    if body.len() != 43
        || !body
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("avatar launch context requires a canonical agent_handle".to_string());
    }
    Ok(normalized)
}

fn normalize_optional_query_value(value: Option<String>) -> Option<String> {
    let normalized = value.unwrap_or_default().trim().to_string();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn forbidden_launch_query_parameter(key: &str) -> bool {
    matches!(
        key,
        "agent_id"
            | "avatar_package"
            | "avatar_package_kind"
            | "avatar_package_id"
            | "avatar_package_ref"
            | "avatar_package_schema_version"
            | "avatar_asset"
            | "avatar_asset_kind"
            | "avatar_asset_id"
            | "avatar_asset_schema_version"
            | "local_avatar_asset_ref"
            | "backend_capability_profile_ref"
            | "materialization_ref"
            | "local_materialization_ref"
            | "manifest_path"
            | "package_path"
            | "source_path"
            | "config_path"
            | "anchor_mode"
            | "runtime_app_id"
            | "world_id"
            | "scoped_binding"
            | "binding_id"
            | "binding_handle"
            | "binding_app_instance_id"
            | "binding_window_id"
            | "binding_purpose"
            | "binding_scopes"
            | "binding_issued_at"
            | "binding_expires_at"
            | "binding_state"
            | "binding_reason_code"
            | "binding_reason"
            | "binding_state_reason"
            | "scopes"
            | "state"
            | "reason"
            | "reason_code"
            | "agent_center_account_id"
            | "account_id"
            | "owner_user_id"
            | "runtime_source_ref"
            | "local_agent_ref"
            | "user_id"
            | "subject_user_id"
            | "access_token"
            | "account_access_token"
            | "refresh_token"
            | "jwt"
            | "raw_jwt"
            | "realm_base_url"
            | "realm_url"
            | "shared_auth"
            | "shared_auth_session"
            | "login_route"
    )
}

// @nimi-authority: rule.nimi.avatar.embodiment.r023
// @nimi-authority: rule.nimi.avatar.embodiment.r024
pub fn parse_avatar_launch_context(raw_url: &str) -> Result<AvatarLaunchContext, String> {
    let parsed = Url::parse(raw_url).map_err(|error| error.to_string())?;
    if parsed.scheme() != AVATAR_LAUNCH_SCHEME {
        return Err(format!(
            "unsupported avatar launch scheme: {}",
            parsed.scheme()
        ));
    }
    if parsed.host_str().unwrap_or_default() != AVATAR_LAUNCH_HOST {
        return Err("avatar launch host must be launch".to_string());
    }

    let mut agent_handle = None;
    let mut conversation_anchor_id = None;
    let mut avatar_instance_id = None;
    let mut launch_source = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "agent_handle" => agent_handle = Some(value.into_owned()),
            "conversation_anchor_id" => conversation_anchor_id = Some(value.into_owned()),
            "avatar_instance_id" => avatar_instance_id = Some(value.into_owned()),
            "launch_source" | "source_surface" => launch_source = Some(value.into_owned()),
            key if forbidden_launch_query_parameter(key) => {
                return Err(format!("forbidden avatar launch query parameter: {}", key));
            }
            key => {
                return Err(format!(
                    "unsupported avatar launch query parameter: {}",
                    key
                ));
            }
        }
    }

    let agent_handle = normalize_required_agent_handle(agent_handle)?;
    let conversation_anchor_id =
        normalize_required_query_value(conversation_anchor_id, "conversation_anchor_id")?;

    Ok(AvatarLaunchContext {
        agent_handle,
        conversation_anchor_id,
        avatar_instance_id: normalize_optional_query_value(avatar_instance_id),
        launch_source: normalize_optional_query_value(launch_source),
    })
}

pub fn parse_avatar_close_request(raw_url: &str) -> Result<AvatarCloseRequest, String> {
    let parsed = Url::parse(raw_url).map_err(|error| error.to_string())?;
    if parsed.scheme() != AVATAR_LAUNCH_SCHEME {
        return Err(format!(
            "unsupported avatar launch scheme: {}",
            parsed.scheme()
        ));
    }
    if parsed.host_str().unwrap_or_default() != AVATAR_CLOSE_HOST {
        return Err("avatar close host must be close".to_string());
    }

    let mut avatar_instance_id = None;
    let mut closed_by = None;
    let mut source_surface = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "avatar_instance_id" => avatar_instance_id = Some(value.into_owned()),
            "closed_by" => closed_by = Some(value.into_owned()),
            "source_surface" => source_surface = Some(value.into_owned()),
            "agent_id"
            | "conversation_anchor_id"
            | "anchor_mode"
            | "launched_by"
            | "launch_source"
            | "binding_id"
            | "scoped_binding"
            | "access_token"
            | "refresh_token"
            | "subject_user_id"
            | "account_access_token"
            | "realm_base_url"
            | "shared_auth"
            | "login_route" => {
                return Err(format!(
                    "forbidden avatar close query parameter: {}",
                    key.as_ref()
                ));
            }
            key => {
                return Err(format!("unsupported avatar close query parameter: {}", key));
            }
        }
    }

    Ok(AvatarCloseRequest {
        avatar_instance_id: normalize_required_query_value(
            avatar_instance_id,
            "avatar_instance_id",
        )?,
        closed_by: normalize_required_query_value(closed_by, "closed_by")?,
        source_surface: normalize_optional_query_value(source_surface),
    })
}

pub fn parse_avatar_deep_link_request(raw_url: &str) -> Result<AvatarDeepLinkRequest, String> {
    let parsed = Url::parse(raw_url).map_err(|error| error.to_string())?;
    match parsed.host_str().unwrap_or_default() {
        AVATAR_LAUNCH_HOST => {
            parse_avatar_launch_context(raw_url).map(AvatarDeepLinkRequest::Launch)
        }
        AVATAR_CLOSE_HOST => parse_avatar_close_request(raw_url).map(AvatarDeepLinkRequest::Close),
        _ => Err("avatar deep link host must be launch or close".to_string()),
    }
}

pub fn resolve_initial_avatar_request() -> Option<AvatarDeepLinkRequest> {
    std::env::args()
        .filter(|arg| arg.starts_with(&format!("{AVATAR_LAUNCH_SCHEME}://")))
        .find_map(|arg| parse_avatar_deep_link_request(arg.as_str()).ok())
}

#[cfg(test)]
mod tests {
    use super::{
        parse_avatar_close_request, parse_avatar_deep_link_request, parse_avatar_launch_context,
        AvatarDeepLinkRequest, AVATAR_CLOSE_HOST, AVATAR_LAUNCH_HOST, AVATAR_LAUNCH_SCHEME,
    };

    fn launch_query(extra: &str) -> String {
        let suffix = if extra.is_empty() {
            String::new()
        } else {
            format!("&{extra}")
        };
        format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_handle=agent_ref_{}&conversation_anchor_id=anchor-1{suffix}",
            "a".repeat(43),
        )
    }

    #[test]
    fn parse_avatar_launch_context_accepts_minimal_intent() {
        let parsed = parse_avatar_launch_context(&launch_query(
            "avatar_instance_id=instance-1&launch_source=desktop-agent-chat",
        ))
        .expect("valid launch context");

        assert_eq!(parsed.agent_handle, format!("agent_ref_{}", "a".repeat(43)));
        assert_eq!(parsed.conversation_anchor_id, "anchor-1");
        assert_eq!(parsed.avatar_instance_id.as_deref(), Some("instance-1"));
        assert_eq!(parsed.launch_source.as_deref(), Some("desktop-agent-chat"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_raw_agent_id() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&agent_handle=agent_ref_{}&conversation_anchor_id=anchor-1&avatar_instance_id=instance-1",
            "a".repeat(43),
        ))
        .expect_err("bare runtime source id should fail");

        assert!(error.contains("forbidden avatar launch query parameter"));
    }

    #[test]
    fn parse_avatar_launch_context_accepts_required_host_and_renderer_selectors() {
        let parsed = parse_avatar_launch_context(&launch_query("")).expect("valid launch context");

        assert_eq!(parsed.avatar_instance_id, None);
        assert_eq!(parsed.launch_source, None);
    }

    #[test]
    fn parse_avatar_launch_context_rejects_missing_agent_handle() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?conversation_anchor_id=anchor-1&avatar_instance_id=instance-1",
        ))
        .expect_err("missing agent should fail");

        assert!(error.contains("agent_handle"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_old_authority_fields() {
        for key in [
            "avatar_package_kind",
            "avatar_package_id",
            "avatar_package_ref",
            "avatar_package_schema_version",
            "backend_capability_profile_ref",
            "materialization_ref",
            "local_materialization_ref",
            "anchor_mode",
            "runtime_app_id",
            "world_id",
            "binding_id",
            "binding_handle",
            "binding_scopes",
            "scoped_binding",
            "account_id",
            "user_id",
            "subject_user_id",
            "realm_base_url",
            "access_token",
            "refresh_token",
            "jwt",
            "manifest_path",
            "package_path",
        ] {
            let error = parse_avatar_launch_context(&launch_query(&format!("{key}=forbidden")))
                .expect_err("old field should fail");
            assert!(
                error.contains("forbidden avatar launch query parameter"),
                "expected forbidden error for {key}, got {error}"
            );
        }
    }

    #[test]
    fn parse_avatar_close_request_accepts_instance_context() {
        let parsed = parse_avatar_close_request(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_CLOSE_HOST}?avatar_instance_id=instance-1&closed_by=desktop&source_surface=desktop-agent-chat"
        ))
        .expect("valid close request");

        assert_eq!(parsed.avatar_instance_id, "instance-1");
        assert_eq!(parsed.closed_by, "desktop");
        assert_eq!(parsed.source_surface.as_deref(), Some("desktop-agent-chat"));
    }

    #[test]
    fn parse_avatar_close_request_rejects_launch_fields() {
        let error = parse_avatar_close_request(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_CLOSE_HOST}?avatar_instance_id=instance-1&closed_by=desktop&agent_id=agent-1"
        ))
        .expect_err("launch fields should fail");

        assert!(error.contains("forbidden avatar close query parameter"));
    }

    #[test]
    fn parse_avatar_deep_link_request_routes_by_host() {
        let launch = parse_avatar_deep_link_request(&format!(
            "{}",
            launch_query("avatar_instance_id=instance-1"),
        ))
        .expect("launch request");
        let close = parse_avatar_deep_link_request(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_CLOSE_HOST}?avatar_instance_id=instance-1&closed_by=desktop"
        ))
        .expect("close request");

        assert!(matches!(launch, AvatarDeepLinkRequest::Launch(_)));
        assert!(matches!(close, AvatarDeepLinkRequest::Close(_)));
    }
}
