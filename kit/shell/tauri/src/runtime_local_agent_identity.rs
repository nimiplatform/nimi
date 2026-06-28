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
    let local_agent_ref = local_agent_ref
        .map(normalize_identity_part)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| identity_error("runtime local agent identity requires local_agent_ref"))?;
    if !is_runtime_local_agent_ref(&local_agent_ref) {
        return Err(identity_error(
            "runtime local agent identity local_agent_ref is malformed",
        ));
    }
    if local_agent_ref == runtime_source_ref {
        return Err(identity_error(
            "runtime local agent identity local_agent_ref must not be a bare runtime_source_ref",
        ));
    }
    Ok(RuntimeLocalAgentIdentity {
        owner_user_id,
        runtime_source_ref,
        local_agent_ref,
    })
}

#[cfg(test)]
mod tests {
    use super::{is_runtime_local_agent_ref, project_runtime_local_agent_identity};

    #[test]
    fn projects_runtime_local_agent_identity() {
        let identity = project_runtime_local_agent_identity(
            " owner-1 ",
            " agent-1 ",
            Some("local-agent:opaque-1"),
        )
        .expect("project identity");

        assert_eq!(identity.owner_user_id, "owner-1");
        assert_eq!(identity.runtime_source_ref, "agent-1");
        assert_eq!(identity.local_agent_ref, "local-agent:opaque-1");
    }

    #[test]
    fn rejects_missing_bare_or_malformed_local_agent_ref() {
        assert!(project_runtime_local_agent_identity("owner-1", "agent-1", None,).is_err());
        assert!(
            project_runtime_local_agent_identity("owner-1", "agent-1", Some("agent-1")).is_err()
        );
        assert!(
            project_runtime_local_agent_identity("owner-1", "agent-1", Some("agent:1")).is_err()
        );
        assert!(is_runtime_local_agent_ref("local-agent:any-opaque-ref"));
    }
}
