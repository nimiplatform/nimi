use crate::runtime_bridge::generated::{AccountCaller, AccountCallerMode};

fn normalize_required_text(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("Runtime account caller requires {field}"));
    }
    Ok(normalized.to_string())
}

fn runtime_account_caller(
    app_id: &str,
    app_instance_id: Option<&str>,
    device_id: &str,
    default_instance_suffix: &str,
    mode: AccountCallerMode,
) -> Result<AccountCaller, String> {
    let app_id = normalize_required_text(app_id, "app_id")?;
    let default_app_instance_id = format!("{app_id}.{default_instance_suffix}");
    let app_instance_id = normalize_required_text(
        app_instance_id.unwrap_or(default_app_instance_id.as_str()),
        "app_instance_id",
    )?;
    let device_id = normalize_required_text(device_id, "device_id")?;
    Ok(AccountCaller {
        app_id,
        app_instance_id,
        device_id,
        mode: mode as i32,
        scopes: Vec::new(),
        launch_host_id: String::new(),
        launch_nonce: String::new(),
        release_descriptor_ref: String::new(),
    })
}

pub fn local_first_party_runtime_account_caller(app_id: &str) -> Result<AccountCaller, String> {
    runtime_account_caller(
        app_id,
        None,
        "local-first-party-device",
        "local-first-party",
        AccountCallerMode::LocalFirstPartyApp,
    )
}

pub fn local_developer_runtime_account_caller(app_id: &str) -> Result<AccountCaller, String> {
    runtime_account_caller(
        app_id,
        None,
        "local-developer-device",
        "local-developer",
        AccountCallerMode::LocalDeveloperApp,
    )
}

pub fn desktop_shell_runtime_account_caller(app_id: &str) -> Result<AccountCaller, String> {
    runtime_account_caller(
        app_id,
        None,
        "desktop-shell",
        "local-first-party",
        AccountCallerMode::DesktopShell,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        desktop_shell_runtime_account_caller, local_developer_runtime_account_caller,
        local_first_party_runtime_account_caller,
    };
    use crate::runtime_bridge::generated::AccountCallerMode;

    #[test]
    fn builds_desktop_shell_account_caller_without_app_owned_shape_literals() {
        let caller = desktop_shell_runtime_account_caller("nimi.desktop").expect("caller");

        assert_eq!(caller.app_id, "nimi.desktop");
        assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
        assert_eq!(caller.device_id, "desktop-shell");
        assert_eq!(caller.mode, AccountCallerMode::DesktopShell as i32);
        assert!(caller.scopes.is_empty());
    }

    #[test]
    fn builds_local_first_party_account_caller() {
        let caller = local_first_party_runtime_account_caller("app.example").expect("caller");

        assert_eq!(caller.app_instance_id, "app.example.local-first-party");
        assert_eq!(caller.device_id, "local-first-party-device");
        assert_eq!(caller.mode, AccountCallerMode::LocalFirstPartyApp as i32);
    }

    #[test]
    fn builds_local_developer_account_caller() {
        let caller = local_developer_runtime_account_caller("nimi.tester").expect("caller");

        assert_eq!(caller.app_instance_id, "nimi.tester.local-developer");
        assert_eq!(caller.device_id, "local-developer-device");
        assert_eq!(caller.mode, AccountCallerMode::LocalDeveloperApp as i32);
    }
}
