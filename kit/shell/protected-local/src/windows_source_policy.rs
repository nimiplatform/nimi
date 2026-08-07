use sha2::{Digest, Sha256};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum WindowsSourcePipeRole {
    Desktop,
    LocalApp,
}

impl WindowsSourcePipeRole {
    fn label(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::LocalApp => "local-app",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct WindowsSourceAclEntry {
    pub principal: String,
    pub allow: bool,
    pub inherited: bool,
    pub full_control: bool,
}

pub(crate) fn source_pipe_name(user_sid: &str, role: WindowsSourcePipeRole) -> Result<String, ()> {
    if !valid_user_sid(user_sid) {
        return Err(());
    }
    let digest = Sha256::digest(user_sid.to_ascii_lowercase().as_bytes());
    let identity = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!(
        r"\\.\pipe\nimi-runtime-source-local-development-{identity}-{}-v1",
        role.label()
    ))
}

pub(crate) fn owner_only_pipe_sddl(user_sid: &str) -> Result<String, ()> {
    if !valid_user_sid(user_sid) {
        return Err(());
    }
    Ok(format!("O:{user_sid}D:P(A;;GA;;;{user_sid})"))
}

pub(crate) fn validate_owner_only_acl(
    user_sid: &str,
    entries: &[WindowsSourceAclEntry],
) -> Result<(), ()> {
    if !valid_user_sid(user_sid) || entries.len() != 1 {
        return Err(());
    }
    let entry = &entries[0];
    if entry.principal != user_sid || !entry.allow || entry.inherited || !entry.full_control {
        return Err(());
    }
    Ok(())
}

fn valid_user_sid(value: &str) -> bool {
    if value.is_empty() || value.trim() != value {
        return false;
    }
    let parts = value.split('-').collect::<Vec<_>>();
    if parts.len() < 4 || parts[0] != "S" || parts[1] != "1" {
        return false;
    }
    parts[2..].iter().all(|part| {
        !part.is_empty() && (*part == "0" || !part.starts_with('0')) && part.parse::<u64>().is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SID: &str = "S-1-5-21-111-222-333-1001";

    #[test]
    fn current_user_pipe_names_match_the_go_adapter_contract() {
        let desktop = source_pipe_name(SID, WindowsSourcePipeRole::Desktop).expect("desktop");
        let local_app = source_pipe_name(SID, WindowsSourcePipeRole::LocalApp).expect("local app");
        assert_ne!(desktop, local_app);
        assert!(!desktop.contains(SID));
        assert_eq!(
            desktop,
            r"\\.\pipe\nimi-runtime-source-local-development-2d86a31e23d85201c8e09da5ae76b4839ae5d62e6db744f4ae1f1a5640bbc0da-desktop-v1"
        );
        assert_eq!(
            owner_only_pipe_sddl(SID).expect("SDDL"),
            format!("O:{SID}D:P(A;;GA;;;{SID})")
        );
    }

    #[test]
    fn current_user_pipe_acl_rejects_every_extra_or_inherited_principal() {
        let exact = WindowsSourceAclEntry {
            principal: SID.to_string(),
            allow: true,
            inherited: false,
            full_control: true,
        };
        assert!(validate_owner_only_acl(SID, std::slice::from_ref(&exact)).is_ok());
        assert!(validate_owner_only_acl(
            SID,
            &[
                exact.clone(),
                WindowsSourceAclEntry {
                    principal: "S-1-5-18".to_string(),
                    allow: true,
                    inherited: false,
                    full_control: true,
                }
            ]
        )
        .is_err());
        assert!(validate_owner_only_acl(
            SID,
            &[WindowsSourceAclEntry {
                inherited: true,
                ..exact
            }]
        )
        .is_err());
    }
}
