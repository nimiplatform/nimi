use serde::{Deserialize, Serialize};
use url::Url;

pub const AVATAR_LAUNCH_SCHEME: &str = "nimi-avatar";
pub const AVATAR_LAUNCH_HOST: &str = "launch";
pub const AVATAR_CLOSE_HOST: &str = "close";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AvatarAnchorMode {
    Existing,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarScopedBindingProjection {
    pub binding_id: String,
    pub binding_handle: Option<String>,
    pub runtime_app_id: String,
    pub app_instance_id: String,
    pub window_id: String,
    pub avatar_instance_id: String,
    pub agent_id: String,
    pub conversation_anchor_id: String,
    pub world_id: Option<String>,
    pub purpose: String,
    pub scopes: Vec<String>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub state: String,
    pub reason_code: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AvatarLaunchContext {
    pub agent_id: String,
    pub avatar_package_kind: String,
    pub avatar_package_id: String,
    pub avatar_package_schema_version: u8,
    pub avatar_instance_id: String,
    pub conversation_anchor_id: String,
    pub launched_by: String,
    pub runtime_app_id: Option<String>,
    pub source_surface: Option<String>,
    pub world_id: Option<String>,
    pub scoped_binding: AvatarScopedBindingProjection,
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

fn parse_avatar_package_kind(value: &str) -> Result<String, String> {
    match value.trim() {
        "live2d" => Ok("live2d".to_string()),
        "vrm" => Ok("vrm".to_string()),
        _ => Err("avatar_package_kind must be one of: live2d, vrm".to_string()),
    }
}

fn parse_binding_scopes(value: Option<String>) -> Result<Vec<String>, String> {
    let normalized = normalize_required_query_value(value, "binding_scopes")?;
    let scopes = normalized
        .split(',')
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if !scopes
        .iter()
        .any(|scope| scope == "runtime.agent.turn.read")
        || !scopes
            .iter()
            .any(|scope| scope == "runtime.agent.presentation.read")
        || !scopes
            .iter()
            .any(|scope| scope == "runtime.agent.state.read")
    {
        return Err("binding_scopes are missing required read scopes".to_string());
    }
    for scope in scopes.iter() {
        if scope != "runtime.agent.turn.read"
            && scope != "runtime.agent.turn.write"
            && scope != "runtime.agent.presentation.read"
            && scope != "runtime.agent.state.read"
        {
            return Err(format!("forbidden avatar binding scope: {scope}"));
        }
    }
    Ok(scopes)
}

fn parse_avatar_package_id(value: &str, kind: &str) -> Result<String, String> {
    let normalized = value.trim();
    let expected_prefix = format!("{kind}_");
    if !normalized.starts_with(expected_prefix.as_str()) {
        return Err("avatar_package_id must match avatar_package_kind".to_string());
    }
    let suffix = &normalized[expected_prefix.len()..];
    if suffix.len() != 12
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return Err(
            "avatar_package_id must use a 12-character lowercase hex digest suffix".to_string(),
        );
    }
    Ok(normalized.to_string())
}

fn parse_avatar_package_schema_version(value: &str) -> Result<u8, String> {
    match value.trim() {
        "1" => Ok(1),
        _ => Err("avatar_package_schema_version must be 1".to_string()),
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
    let mut avatar_package_kind = None;
    let mut avatar_package_id = None;
    let mut avatar_package_schema_version = None;
    let mut avatar_instance_id = None;
    let mut conversation_anchor_id = None;
    let mut launched_by = None;
    let mut runtime_app_id = None;
    let mut source_surface = None;
    let mut world_id = None;
    let mut binding_id = None;
    let mut binding_handle = None;
    let mut binding_app_instance_id = None;
    let mut binding_window_id = None;
    let mut binding_purpose = None;
    let mut binding_scopes = None;
    let mut binding_issued_at = None;
    let mut binding_expires_at = None;
    let mut binding_state = None;
    let mut binding_reason_code = None;

    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "agent_center_account_id" | "account_id" | "user_id" => {
                return Err(format!(
                    "forbidden avatar launch query parameter: {}",
                    key.as_ref()
                ));
            }
            "agent_id" => agent_id = Some(value.into_owned()),
            "avatar_package_kind" => avatar_package_kind = Some(value.into_owned()),
            "avatar_package_id" => avatar_package_id = Some(value.into_owned()),
            "avatar_package_schema_version" => {
                avatar_package_schema_version = Some(value.into_owned())
            }
            "avatar_instance_id" => avatar_instance_id = Some(value.into_owned()),
            "conversation_anchor_id" => conversation_anchor_id = Some(value.into_owned()),
            "launched_by" => launched_by = Some(value.into_owned()),
            "runtime_app_id" => runtime_app_id = Some(value.into_owned()),
            "source_surface" => source_surface = Some(value.into_owned()),
            "world_id" => world_id = Some(value.into_owned()),
            "binding_id" => binding_id = Some(value.into_owned()),
            "binding_handle" => binding_handle = Some(value.into_owned()),
            "binding_app_instance_id" => binding_app_instance_id = Some(value.into_owned()),
            "binding_window_id" => binding_window_id = Some(value.into_owned()),
            "binding_purpose" => binding_purpose = Some(value.into_owned()),
            "binding_scopes" => binding_scopes = Some(value.into_owned()),
            "binding_issued_at" => binding_issued_at = Some(value.into_owned()),
            "binding_expires_at" => binding_expires_at = Some(value.into_owned()),
            "binding_state" => binding_state = Some(value.into_owned()),
            "binding_reason_code" => binding_reason_code = Some(value.into_owned()),
            "anchor_mode"
            | "access_token"
            | "refresh_token"
            | "subject_user_id"
            | "realm_base_url"
            | "realm_url"
            | "account_access_token"
            | "jwt"
            | "raw_jwt"
            | "shared_auth"
            | "shared_auth_session"
            | "login_route"
            | "manifest_path"
            | "package_path"
            | "source_path"
            | "config_path" => {
                return Err(format!(
                    "forbidden avatar launch query parameter: {}",
                    key.as_ref()
                ));
            }
            _ => {}
        }
    }

    let agent_id = normalize_required_query_value(agent_id, "agent_id")?;
    let avatar_package_kind = parse_avatar_package_kind(
        normalize_required_query_value(avatar_package_kind, "avatar_package_kind")?.as_str(),
    )?;
    let avatar_package_id = parse_avatar_package_id(
        normalize_required_query_value(avatar_package_id, "avatar_package_id")?.as_str(),
        avatar_package_kind.as_str(),
    )?;
    let avatar_package_schema_version = parse_avatar_package_schema_version(
        normalize_required_query_value(
            avatar_package_schema_version,
            "avatar_package_schema_version",
        )?
        .as_str(),
    )?;
    let avatar_instance_id =
        normalize_required_query_value(avatar_instance_id, "avatar_instance_id")?;
    let launched_by = normalize_required_query_value(launched_by, "launched_by")?;
    let conversation_anchor_id =
        normalize_required_query_value(conversation_anchor_id, "conversation_anchor_id")?;
    let runtime_app_id_normalized = normalize_optional_query_value(runtime_app_id);
    let world_id_normalized = normalize_optional_query_value(world_id);
    let binding_purpose = normalize_required_query_value(binding_purpose, "binding_purpose")?;
    if binding_purpose != "avatar.interaction.consume" {
        return Err("binding_purpose must be avatar.interaction.consume".to_string());
    }
    let scoped_binding = AvatarScopedBindingProjection {
        binding_id: normalize_required_query_value(binding_id, "binding_id")?,
        binding_handle: normalize_optional_query_value(binding_handle),
        runtime_app_id: normalize_required_query_value(
            runtime_app_id_normalized.clone(),
            "runtime_app_id",
        )?,
        app_instance_id: normalize_required_query_value(
            binding_app_instance_id,
            "binding_app_instance_id",
        )?,
        window_id: normalize_required_query_value(binding_window_id, "binding_window_id")?,
        avatar_instance_id: avatar_instance_id.clone(),
        agent_id: agent_id.clone(),
        conversation_anchor_id: conversation_anchor_id.clone(),
        world_id: world_id_normalized.clone(),
        purpose: binding_purpose,
        scopes: parse_binding_scopes(binding_scopes)?,
        issued_at: normalize_optional_query_value(binding_issued_at),
        expires_at: normalize_optional_query_value(binding_expires_at),
        state: normalize_required_query_value(binding_state, "binding_state")?,
        reason_code: normalize_required_query_value(binding_reason_code, "binding_reason_code")?,
    };

    Ok(AvatarLaunchContext {
        agent_id,
        avatar_package_kind,
        avatar_package_id,
        avatar_package_schema_version,
        avatar_instance_id,
        conversation_anchor_id,
        launched_by,
        runtime_app_id: runtime_app_id_normalized,
        source_surface: normalize_optional_query_value(source_surface),
        world_id: world_id_normalized,
        scoped_binding,
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
            | "binding_id"
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
        AvatarDeepLinkRequest, AVATAR_CLOSE_HOST, AVATAR_LAUNCH_HOST, AVATAR_LAUNCH_SCHEME,
    };

    fn binding_query() -> &'static str {
        "conversation_anchor_id=anchor-1&binding_id=binding-1&binding_handle=binding%3Abinding-1&binding_app_instance_id=nimi.desktop.local-first-party&binding_window_id=desktop-agent-chat&binding_purpose=avatar.interaction.consume&binding_scopes=runtime.agent.turn.read%2Cruntime.agent.turn.write%2Cruntime.agent.presentation.read%2Cruntime.agent.state.read&binding_issued_at=2026-04-28T00%3A00%3A00.000Z&binding_expires_at=2026-04-28T01%3A00%3A00.000Z&binding_state=active&binding_reason_code=action_executed"
    }

    #[test]
    fn parse_avatar_launch_context_accepts_committed_anchor_and_binding() {
        let parsed = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_package_kind=live2d&avatar_package_id=live2d_ab12cd34ef56&avatar_package_schema_version=1&avatar_instance_id=instance-1&launched_by=nimi.desktop&runtime_app_id=nimi.desktop&source_surface=desktop-agent-chat&{}",
            binding_query()
        ))
        .expect("valid launch context");

        assert_eq!(parsed.agent_id, "agent-1");
        assert_eq!(parsed.avatar_package_kind, "live2d");
        assert_eq!(parsed.avatar_package_id, "live2d_ab12cd34ef56");
        assert_eq!(parsed.avatar_package_schema_version, 1);
        assert_eq!(parsed.avatar_instance_id, "instance-1");
        assert_eq!(parsed.conversation_anchor_id, "anchor-1");
        assert_eq!(parsed.scoped_binding.binding_id, "binding-1");
        assert_eq!(
            parsed.scoped_binding.app_instance_id,
            "nimi.desktop.local-first-party"
        );
        assert_eq!(parsed.scoped_binding.window_id, "desktop-agent-chat");
        assert_eq!(parsed.scoped_binding.purpose, "avatar.interaction.consume");
        assert_eq!(parsed.launched_by, "nimi.desktop");
        assert_eq!(parsed.runtime_app_id.as_deref(), Some("nimi.desktop"));
        assert_eq!(parsed.source_surface.as_deref(), Some("desktop-agent-chat"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_missing_anchor_for_existing_mode() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_package_kind=live2d&avatar_package_id=live2d_ab12cd34ef56&avatar_package_schema_version=1&avatar_instance_id=instance-1&launched_by=desktop&runtime_app_id=nimi.desktop&binding_id=binding-1&binding_app_instance_id=nimi.desktop.local-first-party&binding_window_id=desktop-agent-chat&binding_purpose=avatar.interaction.consume&binding_scopes=runtime.agent.turn.read%2Cruntime.agent.presentation.read%2Cruntime.agent.state.read&binding_state=active&binding_reason_code=action_executed"
        ))
        .expect_err("missing anchor should fail");

        assert!(error.contains("conversation_anchor_id"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_forbidden_identity_fields() {
        let error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_package_kind=live2d&avatar_package_id=live2d_ab12cd34ef56&avatar_package_schema_version=1&avatar_instance_id=instance-1&launched_by=desktop&subject_user_id=user-1"
        ))
        .expect_err("forbidden identity field should fail");

        assert!(error.contains("forbidden avatar launch query parameter"));
    }

    #[test]
    fn parse_avatar_launch_context_rejects_path_fields_and_invalid_package_reference() {
        let path_error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_package_kind=live2d&avatar_package_id=live2d_ab12cd34ef56&avatar_package_schema_version=1&avatar_instance_id=instance-1&launched_by=desktop&manifest_path=/tmp/model.json"
        ))
        .expect_err("path fields should fail");
        assert!(path_error.contains("forbidden avatar launch query parameter"));

        let package_error = parse_avatar_launch_context(&format!(
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_package_kind=vrm&avatar_package_id=live2d_ab12cd34ef56&avatar_package_schema_version=1&avatar_instance_id=instance-1&launched_by=desktop&{}",
            binding_query()
        ))
        .expect_err("mismatched package should fail");
        assert!(package_error.contains("avatar_package_id must match"));
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
            "{AVATAR_LAUNCH_SCHEME}://{AVATAR_LAUNCH_HOST}?agent_id=agent-1&avatar_package_kind=live2d&avatar_package_id=live2d_ab12cd34ef56&avatar_package_schema_version=1&avatar_instance_id=instance-1&launched_by=desktop&runtime_app_id=nimi.desktop&{}",
            binding_query()
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
