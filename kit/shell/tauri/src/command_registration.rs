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
    rust_path: "nimi_shell_tauri::capabilities::runtime_defaults::runtime_defaults",
    boundary: ShellCommandBoundary::RuntimeDefaults,
}];

pub const RUNTIME_BRIDGE_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "runtime_bridge_unary",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_unary",
        boundary: ShellCommandBoundary::Runtime,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_stream_open",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_stream_open",
        boundary: ShellCommandBoundary::Runtime,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_stream_close",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_stream_close",
        boundary: ShellCommandBoundary::Runtime,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_status",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_status",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_start",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_start",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_stop",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_stop",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_restart",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_restart",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_config_get",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_config_get",
        boundary: ShellCommandBoundary::Daemon,
    },
    ShellCommandDescriptor {
        command_name: "runtime_bridge_config_set",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_config_set",
        boundary: ShellCommandBoundary::Daemon,
    },
];

pub const AUTH_SESSION_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "auth_session_load",
        rust_path: "nimi_shell_tauri::capabilities::auth::auth_session_load",
        boundary: ShellCommandBoundary::AuthSession,
    },
    ShellCommandDescriptor {
        command_name: "auth_session_save",
        rust_path: "nimi_shell_tauri::capabilities::auth::auth_session_save",
        boundary: ShellCommandBoundary::AuthSession,
    },
    ShellCommandDescriptor {
        command_name: "auth_session_clear",
        rust_path: "nimi_shell_tauri::capabilities::auth::auth_session_clear",
        boundary: ShellCommandBoundary::AuthSession,
    },
];

pub const OAUTH_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "open_external_url",
        rust_path: "nimi_shell_tauri::capabilities::oauth::open_external_url",
        boundary: ShellCommandBoundary::OAuth,
    },
    ShellCommandDescriptor {
        command_name: "oauth_token_exchange",
        rust_path: "nimi_shell_tauri::capabilities::oauth::oauth_token_exchange",
        boundary: ShellCommandBoundary::OAuth,
    },
    ShellCommandDescriptor {
        command_name: "oauth_listen_for_code",
        rust_path: "nimi_shell_tauri::capabilities::oauth::oauth_listen_for_code",
        boundary: ShellCommandBoundary::OAuth,
    },
];

pub const SESSION_LOGGING_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "log_renderer_event",
    rust_path: "nimi_shell_tauri::capabilities::session_logging::log_renderer_event",
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
    (@with_runtime_defaults $runtime_defaults:path; $($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $runtime_defaults,
            $crate::capabilities::runtime::runtime_bridge_unary,
            $crate::capabilities::runtime::runtime_bridge_stream_open,
            $crate::capabilities::runtime::runtime_bridge_stream_close,
            $crate::capabilities::runtime::runtime_bridge_status,
            $crate::capabilities::runtime::runtime_bridge_start,
            $crate::capabilities::runtime::runtime_bridge_stop,
            $crate::capabilities::runtime::runtime_bridge_restart,
            $crate::capabilities::runtime::runtime_bridge_config_get,
            $crate::capabilities::runtime::runtime_bridge_config_set,
            $($app_command),*
        ]
    };
    ($($app_command:path),* $(,)?) => {
        $crate::nimi_shell_tauri_runtime_bridge_handler![
            @with_runtime_defaults $crate::capabilities::runtime_defaults::runtime_defaults;
            $($app_command),*
        ]
    };
}

#[macro_export]
macro_rules! nimi_shell_tauri_auth_oauth_runtime_bridge_handler {
    (@with_runtime_defaults $runtime_defaults:path; $($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $runtime_defaults,
            $crate::capabilities::auth::auth_session_load,
            $crate::capabilities::auth::auth_session_save,
            $crate::capabilities::auth::auth_session_clear,
            $crate::capabilities::oauth::open_external_url,
            $crate::capabilities::oauth::oauth_token_exchange,
            $crate::capabilities::oauth::oauth_listen_for_code,
            $crate::capabilities::runtime::runtime_bridge_unary,
            $crate::capabilities::runtime::runtime_bridge_stream_open,
            $crate::capabilities::runtime::runtime_bridge_stream_close,
            $crate::capabilities::runtime::runtime_bridge_status,
            $crate::capabilities::runtime::runtime_bridge_start,
            $crate::capabilities::runtime::runtime_bridge_stop,
            $crate::capabilities::runtime::runtime_bridge_restart,
            $crate::capabilities::runtime::runtime_bridge_config_get,
            $crate::capabilities::runtime::runtime_bridge_config_set,
            $crate::capabilities::session_logging::log_renderer_event,
            $($app_command),*
        ]
    };
    ($($app_command:path),* $(,)?) => {
        $crate::nimi_shell_tauri_auth_oauth_runtime_bridge_handler![
            @with_runtime_defaults $crate::capabilities::runtime_defaults::runtime_defaults;
            $($app_command),*
        ]
    };
}

#[macro_export]
macro_rules! nimi_shell_tauri_oauth_runtime_bridge_handler {
    (@with_runtime_defaults $runtime_defaults:path; $($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $runtime_defaults,
            $crate::capabilities::oauth::open_external_url,
            $crate::capabilities::oauth::oauth_token_exchange,
            $crate::capabilities::oauth::oauth_listen_for_code,
            $crate::capabilities::runtime::runtime_bridge_unary,
            $crate::capabilities::runtime::runtime_bridge_stream_open,
            $crate::capabilities::runtime::runtime_bridge_stream_close,
            $crate::capabilities::runtime::runtime_bridge_status,
            $crate::capabilities::runtime::runtime_bridge_start,
            $crate::capabilities::runtime::runtime_bridge_stop,
            $crate::capabilities::runtime::runtime_bridge_restart,
            $crate::capabilities::runtime::runtime_bridge_config_get,
            $crate::capabilities::runtime::runtime_bridge_config_set,
            $crate::capabilities::session_logging::log_renderer_event,
            $($app_command),*
        ]
    };
    ($($app_command:path),* $(,)?) => {
        $crate::nimi_shell_tauri_oauth_runtime_bridge_handler![
            @with_runtime_defaults $crate::capabilities::runtime_defaults::runtime_defaults;
            $($app_command),*
        ]
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tauri::command]
    fn test_app_command() {}

    #[tauri::command]
    fn test_runtime_defaults() -> crate::runtime_defaults::RuntimeDefaults {
        crate::runtime_defaults::runtime_defaults()
    }

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
        let _runtime_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_runtime_bridge_handler![test_app_command],
        );
        let _runtime_custom_defaults_builder = tauri::Builder::<tauri::Wry>::default()
            .invoke_handler(crate::nimi_shell_tauri_runtime_bridge_handler![
                @with_runtime_defaults test_runtime_defaults;
                test_app_command
            ]);
        let _oauth_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_oauth_runtime_bridge_handler![test_app_command],
        );
        let _oauth_custom_defaults_builder = tauri::Builder::<tauri::Wry>::default()
            .invoke_handler(crate::nimi_shell_tauri_oauth_runtime_bridge_handler![
                @with_runtime_defaults test_runtime_defaults;
                test_app_command
            ]);
        let _auth_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_auth_oauth_runtime_bridge_handler![test_app_command],
        );
        let _auth_custom_defaults_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_auth_oauth_runtime_bridge_handler![
                @with_runtime_defaults test_runtime_defaults;
                test_app_command
            ],
        );
    }
}
