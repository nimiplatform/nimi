use serde::{Deserialize, Serialize};
use url::Url;

pub const AVATAR_LAUNCH_SCHEME: &str = "nimi-avatar";
pub const AVATAR_LAUNCH_HOST: &str = "launch";
pub const AVATAR_CLOSE_HOST: &str = "close";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AvatarAnchorMode {
    Existing,
    OpenNew,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarLaunchContext {
    pub agent_id: String,
    pub avatar_instance_id: String,
    pub conversation_anchor_id: Option<String>,
    pub anchor_mode: AvatarAnchorMode,
    pub launched_by: String,
    pub runtime_app_id: Option<String>,
    pub source_surface: Option<String>,
    pub realm_base_url: Option<String>,
    pub world_id: Option<String>,
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

fn parse_anchor_mode(value: &str) -> Result<AvatarAnchorMode, String> {
    match value.trim() {
        "existing" => Ok(AvatarAnchorMode::Existing),
        "open_new" => Ok(AvatarAnchorMode::OpenNew),
        _ => Err("anchor_mode must be one of: existing, open_new".to_string()),
    }
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
    let mut conversation_anchor_id = None;
    let mut anchor_mode = None;
    let mut launched_by = None;
    let mut runtime_app_id = None;
    let mut source_surface = None;
    let mut realm_base_url = None;
    let mut world_id = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "agent_id" => agent_id = Some(value.into_owned()),
            "avatar_instance_id" => avatar_instance_id = Some(value.into_owned()),
            "conversation_anchor_id" => conversation_anchor_id = Some(value.into_owned()),
            "anchor_mode" => anchor_mode = Some(value.into_owned()),
            "launched_by" => launched_by = Some(value.into_owned()),
            "runtime_app_id" => runtime_app_id = Some(value.into_owned()),
            "source_surface" => source_surface = Some(value.into_owned()),
            "realm_base_url" => realm_base_url = Some(value.into_owned()),
            "world_id" => world_id = Some(value.into_owned()),
            "access_token" | "refresh_token" | "subject_user_id" => {
                return Err(format!(
                    "forbidden avatar launch query parameter: {}",
                    key.as_ref()
                ));
            }
            _ => {}
        }
    }

    let agent_id = normalize_required_query_value(agent_id, "agent_id")?;
    let avatar_instance_id =
        normalize_required_query_value(avatar_instance_id, "avatar_instance_id")?;
    let launched_by = normalize_required_query_value(launched_by, "launched_by")?;
    let anchor_mode =
        parse_anchor_mode(normalize_required_query_value(anchor_mode, "anchor_mode")?.as_str())?;
    let conversation_anchor_id = normalize_optional_query_value(conversation_anchor_id);

    match anchor_mode {
        AvatarAnchorMode::Existing => {
            if conversation_anchor_id.is_none() {
                return Err(
                    "conversation_anchor_id is required when anchor_mode=existing".to_string(),
                );
            }
        }
        AvatarAnchorMode::OpenNew => {
            if conversation_anchor_id.is_some() {
                return Err(
                    "conversation_anchor_id must be empty when anchor_mode=open_new".to_string(),
                );
            }
        }
    }

    Ok(AvatarLaunchContext {
        agent_id,
        avatar_instance_id,
        conversation_anchor_id,
        anchor_mode,
        launched_by,
        runtime_app_id: normalize_optional_query_value(runtime_app_id),
        source_surface: normalize_optional_query_value(source_surface),
        realm_base_url: normalize_optional_query_value(realm_base_url),
        world_id: normalize_optional_query_value(world_id),
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
            | "access_token"
            | "refresh_token"
            | "subject_user_id" => {
                return Err(format!(
                    "forbidden avatar close query parameter: {}",
                    key.as_ref()
                ));
            }
            _ => {}
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
        AvatarAnchorMode, AvatarDeepLinkRequest, AVATAR_CLOSE_HOST, AVATAR_LAUNCH_HOST,
        AVATAR_LAUNCH_SCHEME,
    };

    #[test]
    fn parse_avatar_launch_context_accepts_existing_anchor_mode() {
        let parsed = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=existing&conversation_anchor_id=anchor-1&launched_by=nimi.desktop&runtime_app_id=nimi.desktop&source_surface=desktop-agent-chat"
        ))
        .expect("valid launch context");

        assert_eq!(parsed.agent_id, "agent-1");
        assert_eq!(parsed.avatar_instance_id, "instance-1");
        assert_eq!(parsed.conversation_anchor_id.as_deref(), Some("anchor-1"));
        assert_eq!(parsed.anchor_mode, AvatarAnchorMode::Existing);
        assert_eq!(parsed.launched_by, "nimi.desktop");
        assert_eq!(parsed.runtime_app_id.as_deref(), Some("nimi.desktop"));
        assert_eq!(parsed.source_surface.as_deref(), Some("desktop-agent-chat"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_missing_anchor_for_existing_mode() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=existing&launched_by=desktop"
        ))
        .expect_err("missing anchor should fail");

        assert!(error.contains("conversation_anchor_id is required"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_forbidden_identity_fields() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=open_new&launched_by=desktop&subject_user_id=user-1"
        ))
        .expect_err("forbidden identity field should fail");

        assert!(error.contains("forbidden avatar launch query parameter"));
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
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_instance_id=instance-1&anchor_mode=open_new&launched_by=desktop"
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
