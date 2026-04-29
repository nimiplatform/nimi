use serde::{Deserialize, Serialize};
use url::Url;

pub const AVATAR_LAUNCH_SCHEME: &str = "nimi-avatar";
pub const AVATAR_LAUNCH_HOST: &str = "launch";
pub const AVATAR_CLOSE_HOST: &str = "close";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarLaunchContext {
    pub agent_id: String,
    pub avatar_instance_id: Option<String>,
    pub launch_source: Option<String>,
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
        "avatar_package"
            | "avatar_package_kind"
            | "avatar_package_id"
            | "avatar_package_schema_version"
            | "manifest_path"
            | "package_path"
            | "source_path"
            | "config_path"
            | "conversation_anchor_id"
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

    let mut agent_id = None;
    let mut avatar_instance_id = None;
    let mut launch_source = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "agent_id" => agent_id = Some(value.into_owned()),
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

    Ok(AvatarLaunchContext {
        agent_id: normalize_required_query_value(agent_id, "agent_id")?,
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

    #[test]
    fn parse_avatar_launch_context_accepts_minimal_intent() {
        let parsed = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&launch_source=desktop-agent-chat",
        ))
        .expect("valid launch context");

        assert_eq!(parsed.agent_id, "agent-1");
        assert_eq!(parsed.avatar_instance_id.as_deref(), Some("instance-1"));
        assert_eq!(parsed.launch_source.as_deref(), Some("desktop-agent-chat"));
    }

    #[test]
    fn parse_avatar_launch_context_accepts_agent_id_only() {
        let parsed = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1",
        ))
        .expect("valid launch context");

        assert_eq!(parsed.agent_id, "agent-1");
        assert_eq!(parsed.avatar_instance_id, None);
        assert_eq!(parsed.launch_source, None);
    }

    #[test]
    fn parse_avatar_launch_context_rejects_missing_agent_id() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?avatar_instance_id=instance-1",
        ))
        .expect_err("missing agent should fail");

        assert!(error.contains("agent_id"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_old_authority_fields() {
        for key in [
            "avatar_package_kind",
            "avatar_package_id",
            "avatar_package_schema_version",
            "conversation_anchor_id",
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
            let error = parse_avatar_launch_context(&format!(
                "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&{key}=forbidden",
            ))
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
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1",
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
