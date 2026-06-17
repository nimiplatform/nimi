#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeLocalAgentIdentity {
    pub owner_user_id: String,
    pub runtime_source_ref: String,
    pub local_agent_ref: String,
}

fn normalize_identity_part(value: &str) -> String {
    value.trim().to_string()
}

fn identity_error(message: &str) -> String {
    message.to_string()
}

pub fn build_runtime_local_agent_ref(
    owner_user_id: &str,
    runtime_source_ref: &str,
) -> Result<String, String> {
    let owner_user_id = normalize_identity_part(owner_user_id);
    if owner_user_id.is_empty() {
        return Err(identity_error(
            "runtime local agent identity requires owner_user_id",
        ));
    }
    let runtime_source_ref = normalize_identity_part(runtime_source_ref);
    if runtime_source_ref.is_empty() {
        return Err(identity_error(
            "runtime local agent identity requires runtime_source_ref",
        ));
    }
    Ok(format!("local-agent:{owner_user_id}:{runtime_source_ref}"))
}

pub fn is_runtime_local_agent_ref(value: &str) -> bool {
    value.trim().starts_with("local-agent:")
}

pub fn project_runtime_local_agent_identity(
    owner_user_id: &str,
    runtime_source_ref: &str,
    local_agent_ref: Option<&str>,
) -> Result<RuntimeLocalAgentIdentity, String> {
    let owner_user_id = normalize_identity_part(owner_user_id);
    if owner_user_id.is_empty() {
        return Err(identity_error(
            "runtime local agent identity requires owner_user_id",
        ));
    }
    let runtime_source_ref = normalize_identity_part(runtime_source_ref);
    if runtime_source_ref.is_empty() {
        return Err(identity_error(
            "runtime local agent identity requires runtime_source_ref",
        ));
    }
    let expected = build_runtime_local_agent_ref(&owner_user_id, &runtime_source_ref)?;
    let local_agent_ref = local_agent_ref
        .map(normalize_identity_part)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| expected.clone());
    if !is_runtime_local_agent_ref(&local_agent_ref) {
        return Err(identity_error(
            "runtime local agent identity local_agent_ref is malformed",
        ));
    }
    if local_agent_ref != expected {
        return Err(identity_error(
            "runtime local agent identity local_agent_ref must match owner_user_id and runtime_source_ref",
        ));
    }
    Ok(RuntimeLocalAgentIdentity {
        owner_user_id,
        runtime_source_ref,
        local_agent_ref,
    })
}

pub fn parse_runtime_local_agent_identity(
    local_agent_ref: &str,
) -> Result<RuntimeLocalAgentIdentity, String> {
    let normalized = normalize_identity_part(local_agent_ref);
    let parts: Vec<&str> = normalized.split(':').collect();
    if parts.len() != 3 || parts.first().copied() != Some("local-agent") {
        return Err(identity_error(
            "runtime local agent identity local_agent_ref is malformed",
        ));
    }
    project_runtime_local_agent_identity(parts[1], parts[2], Some(&normalized))
}

#[cfg(test)]
mod tests {
    use super::{
        build_runtime_local_agent_ref, parse_runtime_local_agent_identity,
        project_runtime_local_agent_identity,
    };

    #[test]
    fn projects_runtime_local_agent_identity() {
        let identity = project_runtime_local_agent_identity(
            " owner-1 ",
            " agent-1 ",
            Some("local-agent:owner-1:agent-1"),
        )
        .expect("project identity");

        assert_eq!(identity.owner_user_id, "owner-1");
        assert_eq!(identity.runtime_source_ref, "agent-1");
        assert_eq!(identity.local_agent_ref, "local-agent:owner-1:agent-1");
    }

    #[test]
    fn builds_missing_local_agent_ref_from_parts() {
        let identity =
            project_runtime_local_agent_identity("owner-1", "agent-1", None).expect("project");

        assert_eq!(identity.local_agent_ref, "local-agent:owner-1:agent-1");
    }

    #[test]
    fn parses_runtime_local_agent_identity() {
        let identity =
            parse_runtime_local_agent_identity(" local-agent:owner-1:agent-1 ").expect("parse");

        assert_eq!(identity.owner_user_id, "owner-1");
        assert_eq!(identity.runtime_source_ref, "agent-1");
        assert_eq!(identity.local_agent_ref, "local-agent:owner-1:agent-1");
    }

    #[test]
    fn rejects_mismatched_or_malformed_local_agent_ref() {
        assert!(project_runtime_local_agent_identity(
            "owner-1",
            "agent-1",
            Some("local-agent:owner-2:agent-1"),
        )
        .is_err());
        assert!(parse_runtime_local_agent_identity("agent-1").is_err());
        assert!(parse_runtime_local_agent_identity("local-agent:owner-1:agent:opaque").is_err());
    }

    #[test]
    fn builds_runtime_local_agent_ref() {
        assert_eq!(
            build_runtime_local_agent_ref("owner-1", "agent-1").expect("build"),
            "local-agent:owner-1:agent-1"
        );
    }
}
