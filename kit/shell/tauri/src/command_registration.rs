#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellCommandBoundary {
    AuthSession,
    Daemon,
    OAuth,
    Runtime,
    RuntimeDefaults,
    SessionLogging,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShellCommandDescriptor {
    pub command_name: &'static str,
    pub rust_path: &'static str,
    pub boundary: ShellCommandBoundary,
}

pub const RUNTIME_DEFAULTS_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "runtime_defaults",
    rust_path: "nimi_shell_tauri::runtime_defaults::runtime_defaults",
    boundary: ShellCommandBoundary::RuntimeDefaults,
}];

pub const RUNTIME_BRIDGE_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "runtime_bridge_unary",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_unary",
        boundary: ShellCommandBoundary::Runtime,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_stream_open",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_stream_open",
        boundary: ShellCommandBoundary::Runtime,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_stream_close",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_stream_close",
        boundary: ShellCommandBoundary::Runtime,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_status",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_status",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_start",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_start",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_stop",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_stop",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_restart",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_restart",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_config_get",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_config_get",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_config_set",
        rust_path: "nimi_shell_tauri::runtime_bridge::runtime_bridge_config_set",
        boundary: ShellCommandBoundary::Daemon,
    },
];

pub const AUTH_SESSION_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "auth_session_load",
        rust_path: "nimi_shell_tauri::auth_session_commands::auth_session_load",
        boundary: ShellCommandBoundary::AuthSession,
    },
    ShellCommandDescriptor {
        command_name: "auth_session_save",
        rust_path: "nimi_shell_tauri::auth_session_commands::auth_session_save",
        boundary: ShellCommandBoundary::AuthSession,
    },
    ShellCommandDescriptor {
        command_name: "auth_session_clear",
        rust_path: "nimi_shell_tauri::auth_session_commands::auth_session_clear",
        boundary: ShellCommandBoundary::AuthSession,
    },
];

pub const OAUTH_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "open_external_url",
        rust_path: "nimi_shell_tauri::oauth_commands::open_external_url",
        boundary: ShellCommandBoundary::OAuth,
    },
    ShellCommandDescriptor {
        command_name: "oauth_token_exchange",
        rust_path: "nimi_shell_tauri::oauth_commands::oauth_token_exchange",
        boundary: ShellCommandBoundary::OAuth,
    },
    ShellCommandDescriptor {
        command_name: "oauth_listen_for_code",
        rust_path: "nimi_shell_tauri::oauth_commands::oauth_listen_for_code",
        boundary: ShellCommandBoundary::OAuth,
    },
];

pub const SESSION_LOGGING_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "log_renderer_event",
    rust_path: "nimi_shell_tauri::session_logging::log_renderer_event",
    boundary: ShellCommandBoundary::SessionLogging,
}];

pub fn all_shell_commands() -> Vec<ShellCommandDescriptor> {
    let mut commands = Vec::new();
    commands.extend_from_slice(RUNTIME_DEFAULTS_COMMANDS);
    commands.extend_from_slice(RUNTIME_BRIDGE_COMMANDS);
    commands.extend_from_slice(AUTH_SESSION_COMMANDS);
    commands.extend_from_slice(OAUTH_COMMANDS);
    commands.extend_from_slice(SESSION_LOGGING_COMMANDS);
    commands
}

#[macro_export]
macro_rules! nimi_shell_tauri_runtime_bridge_handler {
    ($($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $crate::runtime_defaults::runtime_defaults,
            $crate::runtime_bridge::runtime_bridge_unary,
            $crate::runtime_bridge::runtime_bridge_stream_open,
            $crate::runtime_bridge::runtime_bridge_stream_close,
            $crate::runtime_bridge::runtime_bridge_status,
            $crate::runtime_bridge::runtime_bridge_start,
            $crate::runtime_bridge::runtime_bridge_stop,
            $crate::runtime_bridge::runtime_bridge_restart,
            $crate::runtime_bridge::runtime_bridge_config_get,
            $crate::runtime_bridge::runtime_bridge_config_set,
            $($app_command),*
        ]
    };
}

#[macro_export]
macro_rules! nimi_shell_tauri_auth_oauth_runtime_bridge_handler {
    ($($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $crate::runtime_defaults::runtime_defaults,
            $crate::auth_session_commands::auth_session_load,
            $crate::auth_session_commands::auth_session_save,
            $crate::auth_session_commands::auth_session_clear,
            $crate::oauth_commands::open_external_url,
            $crate::oauth_commands::oauth_token_exchange,
            $crate::oauth_commands::oauth_listen_for_code,
            $crate::runtime_bridge::runtime_bridge_unary,
            $crate::runtime_bridge::runtime_bridge_stream_open,
            $crate::runtime_bridge::runtime_bridge_stream_close,
            $crate::runtime_bridge::runtime_bridge_status,
            $crate::runtime_bridge::runtime_bridge_start,
            $crate::runtime_bridge::runtime_bridge_stop,
            $crate::runtime_bridge::runtime_bridge_restart,
            $crate::runtime_bridge::runtime_bridge_config_get,
            $crate::runtime_bridge::runtime_bridge_config_set,
            $crate::session_logging::log_renderer_event,
            $($app_command),*
        ]
    };
}

#[macro_export]
macro_rules! nimi_shell_tauri_oauth_runtime_bridge_handler {
    ($($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $crate::runtime_defaults::runtime_defaults,
            $crate::oauth_commands::open_external_url,
            $crate::oauth_commands::oauth_token_exchange,
            $crate::oauth_commands::oauth_listen_for_code,
            $crate::runtime_bridge::runtime_bridge_unary,
            $crate::runtime_bridge::runtime_bridge_stream_open,
            $crate::runtime_bridge::runtime_bridge_stream_close,
            $crate::runtime_bridge::runtime_bridge_status,
            $crate::runtime_bridge::runtime_bridge_start,
            $crate::runtime_bridge::runtime_bridge_stop,
            $crate::runtime_bridge::runtime_bridge_restart,
            $crate::runtime_bridge::runtime_bridge_config_get,
            $crate::runtime_bridge::runtime_bridge_config_set,
            $crate::session_logging::log_renderer_event,
            $($app_command),*
        ]
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tauri::command]
    fn test_app_command() {}

    #[test]
    fn public_catalog_names_all_shell_commands() {
        let names = all_shell_commands()
            .into_iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "runtime_defaults",
                "runtime_bridge_unary",
                "runtime_bridge_stream_open",
                "runtime_bridge_stream_close",
                "runtime_bridge_status",
                "runtime_bridge_start",
                "runtime_bridge_stop",
                "runtime_bridge_restart",
                "runtime_bridge_config_get",
                "runtime_bridge_config_set",
                "auth_session_load",
                "auth_session_save",
                "auth_session_clear",
                "open_external_url",
                "oauth_token_exchange",
                "oauth_listen_for_code",
                "log_renderer_event",
            ]
        );
    }

    #[test]
    fn public_catalog_keeps_boundaries_explicit() {
        let commands = all_shell_commands();

        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::AuthSession));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::Runtime));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::Daemon));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::OAuth));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::SessionLogging));
    }

    #[test]
    fn scoped_generate_handler_macros_compile() {
        let _runtime_builder = tauri::Builder::<tauri::Wry>::default()
            .invoke_handler(crate::nimi_shell_tauri_runtime_bridge_handler![
                test_app_command
            ]);
        let _oauth_builder = tauri::Builder::<tauri::Wry>::default()
            .invoke_handler(crate::nimi_shell_tauri_oauth_runtime_bridge_handler![
                test_app_command
            ]);
        let _auth_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_auth_oauth_runtime_bridge_handler![test_app_command],
        );
    }
}
