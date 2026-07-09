use crate::runtime_bridge::generated::AccountCaller;
use crate::runtime_local_agent_identity::RuntimeLocalAgentIdentity;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, OnceLock};

pub type StandardLocalAgentIdentityHook =
    Arc<dyn Fn() -> Result<RuntimeLocalAgentIdentity, String> + Send + Sync>;
pub type StandardRuntimeTrustedCallerHook =
    Arc<dyn Fn() -> Result<AccountCaller, String> + Send + Sync>;

#[derive(Clone, Default)]
pub struct StandardLocalAgentHostHooks {
    pub identity: Option<StandardLocalAgentIdentityHook>,
    pub runtime_trusted_caller: Option<StandardRuntimeTrustedCallerHook>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardRuntimeTrustedCaller {
    pub app_id: String,
    pub app_instance_id: String,
    pub device_id: String,
    pub mode: i32,
    pub scopes: Vec<String>,
}

static LOCAL_AGENT_HOST_HOOKS: OnceLock<Mutex<StandardLocalAgentHostHooks>> = OnceLock::new();

pub fn set_standard_local_agent_host_hooks(
    hooks: StandardLocalAgentHostHooks,
) -> Result<(), String> {
    if LOCAL_AGENT_HOST_HOOKS.get().is_some() {
        #[cfg(test)]
        {
            let existing = LOCAL_AGENT_HOST_HOOKS
                .get()
                .ok_or_else(|| "STANDARD_LOCAL_AGENT_HOST_HOOKS_MISSING".to_string())?;
            *existing
                .lock()
                .map_err(|_| "STANDARD_LOCAL_AGENT_HOST_HOOKS_LOCK_POISONED".to_string())? = hooks;
            return Ok(());
        }
        #[cfg(not(test))]
        {
            return Err("STANDARD_LOCAL_AGENT_HOST_HOOKS_ALREADY_SET".to_string());
        }
    }
    LOCAL_AGENT_HOST_HOOKS
        .set(Mutex::new(hooks))
        .map_err(|_| "STANDARD_LOCAL_AGENT_HOST_HOOKS_ALREADY_SET".to_string())
}

fn host_hooks() -> Option<StandardLocalAgentHostHooks> {
    LOCAL_AGENT_HOST_HOOKS
        .get()
        .and_then(|hooks| hooks.lock().ok().map(|hooks| hooks.clone()))
}

pub fn local_agent_identity(command: &str) -> Result<RuntimeLocalAgentIdentity, String> {
    let hook = host_hooks()
        .and_then(|hooks| hooks.identity.clone())
        .ok_or_else(|| {
            local_agent_error(
                "capability-unavailable",
                "tauri-standard-local-agent-identity-unavailable",
                "bind_standard_local_agent_identity_from_host",
                command,
                None,
            )
        })?;
    hook().map_err(|cause| {
        local_agent_error(
            "host-internal-error",
            "tauri-standard-local-agent-identity-hook-failed",
            "inspect_standard_local_agent_host_hook",
            command,
            Some(cause),
        )
    })
}

pub fn runtime_trusted_caller(
    payload: Value,
    command: &str,
) -> Result<StandardRuntimeTrustedCaller, String> {
    assert_no_renderer_local_agent_caller_payload(&payload, command)?;
    let hook = host_hooks()
        .and_then(|hooks| hooks.runtime_trusted_caller.clone())
        .ok_or_else(|| {
            local_agent_error(
                "capability-unavailable",
                "tauri-standard-runtime-trusted-caller-unavailable",
                "bind_runtime_trusted_caller_from_host",
                command,
                None,
            )
        })?;
    let caller = hook().map_err(|cause| {
        local_agent_error(
            "host-internal-error",
            "tauri-standard-runtime-trusted-caller-hook-failed",
            "inspect_standard_local_agent_host_hook",
            command,
            Some(cause),
        )
    })?;
    Ok(StandardRuntimeTrustedCaller {
        app_id: normalize_required_caller_text(caller.app_id.as_str(), "appId", command)?,
        app_instance_id: normalize_required_caller_text(
            caller.app_instance_id.as_str(),
            "appInstanceId",
            command,
        )?,
        device_id: normalize_required_caller_text(caller.device_id.as_str(), "deviceId", command)?,
        mode: caller.mode,
        scopes: caller
            .scopes
            .into_iter()
            .map(|scope| normalize_required_caller_text(scope.as_str(), "scopes", command))
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn assert_no_renderer_local_agent_caller_payload(
    payload: &Value,
    command: &str,
) -> Result<(), String> {
    let Some(object) = payload.as_object() else {
        return Err(local_agent_error(
            "forbidden-renderer-access",
            "tauri-renderer-local-agent-caller-payload-not-object",
            "derive_runtime_trusted_caller_from_tauri_host",
            command,
            Some(format!("payload type: {}", payload_type(payload))),
        ));
    };
    for key in object.keys() {
        let normalized = key
            .to_lowercase()
            .chars()
            .filter(|ch| *ch != '-' && *ch != '_')
            .collect::<String>();
        if let Some(kind) = renderer_forbidden_metadata_kind(normalized.as_str()) {
            return Err(local_agent_error(
                "forbidden-renderer-access",
                "tauri-renderer-local-agent-caller-field-forbidden",
                if kind == "identity" {
                    "derive_runtime_trusted_caller_from_tauri_host"
                } else {
                    "provide_sensitive_runtime_metadata_from_tauri_host"
                },
                command,
                Some(format!("forbidden {kind} field: {key}")),
            ));
        }
    }
    Ok(())
}

fn renderer_forbidden_metadata_kind(key: &str) -> Option<&'static str> {
    if matches!(
        key,
        "appid"
            | "participantid"
            | "callerkind"
            | "callerid"
            | "xnimiappid"
            | "xnimiparticipantid"
            | "xnimicallerkind"
            | "xnimicallerid"
    ) {
        return Some("identity");
    }
    if matches!(
        key,
        "authorization"
            | "protectedaccesstoken"
            | "appsession"
            | "accesstokenid"
            | "accesstokensecret"
            | "sessionid"
            | "sessiontoken"
            | "providerapikey"
            | "xnimiauthorization"
            | "xnimiprotectedaccesstoken"
            | "xnimiappsession"
            | "xnimiaccesstokenid"
            | "xnimiaccesstokensecret"
            | "xnimisessionid"
            | "xnimisessiontoken"
            | "xnimiproviderapikey"
    ) || key.contains("authorization")
        || key.contains("accesstoken")
        || key.contains("session")
        || key.contains("providerapikey")
        || key.contains("secret")
    {
        return Some("auth");
    }
    None
}

fn normalize_required_caller_text(
    value: &str,
    field: &str,
    command: &str,
) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(local_agent_error(
            "host-internal-error",
            "tauri-standard-runtime-trusted-caller-field-missing",
            "inspect_standard_local_agent_host_hook",
            command,
            Some(format!("{field} is required")),
        ));
    }
    Ok(normalized.to_string())
}

fn payload_type(payload: &Value) -> &'static str {
    match payload {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn local_agent_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    command: &str,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(json!({ "command": command, "cause": cause })),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        local_agent_identity, runtime_trusted_caller, set_standard_local_agent_host_hooks,
        StandardLocalAgentHostHooks,
    };
    use crate::runtime_account_caller::desktop_shell_runtime_account_caller;
    use crate::runtime_local_agent_identity::project_runtime_local_agent_identity;
    use serde_json::{json, Value};
    use std::sync::Arc;

    fn envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn identity_fails_closed_without_host_hook() {
        set_standard_local_agent_host_hooks(StandardLocalAgentHostHooks::default())
            .expect("reset hooks");

        let error = local_agent_identity("local_agent_identity").expect_err("hook required");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("capability-unavailable")
        );
    }

    #[test]
    fn identity_uses_host_hook_projection() {
        set_standard_local_agent_host_hooks(StandardLocalAgentHostHooks {
            identity: Some(Arc::new(|| {
                project_runtime_local_agent_identity(
                    "owner-1",
                    "agent-source-1",
                    Some("local-agent:opaque-1"),
                )
            })),
            runtime_trusted_caller: None,
        })
        .expect("set hooks");

        let identity = local_agent_identity("local_agent_identity").expect("identity");
        assert_eq!(identity.local_agent_ref, "local-agent:opaque-1");
    }

    #[test]
    fn runtime_trusted_caller_rejects_renderer_owned_identity_fields() {
        set_standard_local_agent_host_hooks(StandardLocalAgentHostHooks {
            identity: None,
            runtime_trusted_caller: Some(Arc::new(|| {
                desktop_shell_runtime_account_caller("nimi.desktop")
            })),
        })
        .expect("set hooks");

        let error = runtime_trusted_caller(
            json!({ "appId": "renderer-spoof" }),
            "local_agent_runtime_trusted_caller",
        )
        .expect_err("spoof rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("forbidden-renderer-access")
        );
    }

    #[test]
    fn runtime_trusted_caller_projects_host_account_caller() {
        set_standard_local_agent_host_hooks(StandardLocalAgentHostHooks {
            identity: None,
            runtime_trusted_caller: Some(Arc::new(|| {
                desktop_shell_runtime_account_caller("nimi.desktop")
            })),
        })
        .expect("set hooks");

        let caller = runtime_trusted_caller(json!({}), "local_agent_runtime_trusted_caller")
            .expect("trusted caller");

        assert_eq!(caller.app_id, "nimi.desktop");
        assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
        assert_eq!(caller.device_id, "desktop-shell");
    }
}
