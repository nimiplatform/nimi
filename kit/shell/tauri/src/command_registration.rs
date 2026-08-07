#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellCommandBoundary {
    AgentCenter,
    LocalApp,
    Avatar,
    Daemon,
    DesktopAccount,
    DesktopOpen,
    Diagnostics,
    Files,
    FloatingWindow,
    LocalAgent,
    LocalAssets,
    OAuth,
    PlatformProjection,
    Runtime,
    RuntimeDefaults,
    SessionLogging,
    ShellUi,
    Storage,
}

pub const LOCAL_APP_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "local_app_session_status",
        rust_path: "nimi_shell_tauri::capabilities::local_app::local_app_session_status",
        boundary: ShellCommandBoundary::LocalApp,
    },
    ShellCommandDescriptor {
        command_name: "local_app_ai_config_get",
        rust_path: "nimi_shell_tauri::capabilities::local_app::local_app_ai_config_get",
        boundary: ShellCommandBoundary::LocalApp,
    },
    ShellCommandDescriptor {
        command_name: "local_app_ai_config_overwrite",
        rust_path: "nimi_shell_tauri::capabilities::local_app::local_app_ai_config_overwrite",
        boundary: ShellCommandBoundary::LocalApp,
    },
    ShellCommandDescriptor {
        command_name: "local_app_text_generate_candidate",
        rust_path: "nimi_shell_tauri::capabilities::local_app::local_app_text_generate_candidate",
        boundary: ShellCommandBoundary::LocalApp,
    },
    ShellCommandDescriptor {
        command_name: "storage_read_json",
        rust_path: "nimi_shell_tauri::capabilities::storage::storage_read_json",
        boundary: ShellCommandBoundary::LocalApp,
    },
    ShellCommandDescriptor {
        command_name: "storage_write_json",
        rust_path: "nimi_shell_tauri::capabilities::storage::storage_write_json",
        boundary: ShellCommandBoundary::LocalApp,
    },
    ShellCommandDescriptor {
        command_name: "storage_remove_json",
        rust_path: "nimi_shell_tauri::capabilities::storage::storage_remove_json",
        boundary: ShellCommandBoundary::LocalApp,
    },
];

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
        command_name: "runtime_bridge_restart",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_bridge_restart",
        boundary: ShellCommandBoundary::Daemon,
    },
];

pub const PROTECTED_DESKTOP_ACCOUNT_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "runtime_account_session_status",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_session_status",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_session_events_open",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_session_events_open",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_session_events_close",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_session_events_close",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_begin_login",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_begin_login",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_complete_login",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_complete_login",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_invoke_realm_unary",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_invoke_realm_unary",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_logout",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_logout",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
    ShellCommandDescriptor {
        command_name: "runtime_account_switch_account",
        rust_path: "nimi_shell_tauri::capabilities::runtime::runtime_account_switch_account",
        boundary: ShellCommandBoundary::DesktopAccount,
    },
];

pub const OAUTH_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "open_external_url",
        rust_path: "nimi_shell_tauri::capabilities::oauth::open_external_url",
        boundary: ShellCommandBoundary::OAuth,
    },
    ShellCommandDescriptor {
        command_name: "oauth_listen_for_code",
        rust_path: "nimi_shell_tauri::capabilities::oauth::oauth_listen_for_code",
        boundary: ShellCommandBoundary::OAuth,
    },
];

pub const DESKTOP_OPEN_INTENT_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "desktop_open_intent_open_intent",
    rust_path: "nimi_shell_tauri::capabilities::desktop_open::desktop_open_intent_open_intent",
    boundary: ShellCommandBoundary::DesktopOpen,
}];

pub const SESSION_LOGGING_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "log_renderer_event",
    rust_path: "nimi_shell_tauri::capabilities::session_logging::log_renderer_event",
    boundary: ShellCommandBoundary::SessionLogging,
}];

pub const STANDARD_DIAGNOSTICS_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "diagnostics_renderer_entry_probe",
    rust_path: "nimi_shell_tauri::capabilities::diagnostics::diagnostics_renderer_entry_probe",
    boundary: ShellCommandBoundary::Diagnostics,
}];

pub const STANDARD_STORAGE_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "data_path_resolve",
        rust_path: "nimi_shell_tauri::capabilities::data::data_path_resolve",
        boundary: ShellCommandBoundary::Storage,
    },
    ShellCommandDescriptor {
        command_name: "storage_read_json",
        rust_path: "nimi_shell_tauri::capabilities::storage::storage_read_json",
        boundary: ShellCommandBoundary::Storage,
    },
    ShellCommandDescriptor {
        command_name: "storage_write_json",
        rust_path: "nimi_shell_tauri::capabilities::storage::storage_write_json",
        boundary: ShellCommandBoundary::Storage,
    },
    ShellCommandDescriptor {
        command_name: "storage_remove_json",
        rust_path: "nimi_shell_tauri::capabilities::storage::storage_remove_json",
        boundary: ShellCommandBoundary::Storage,
    },
];

pub const STANDARD_SHELL_UI_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "confirm_dialog",
        rust_path: "nimi_shell_tauri::capabilities::shell_ui::confirm_dialog",
        boundary: ShellCommandBoundary::ShellUi,
    },
    ShellCommandDescriptor {
        command_name: "start_window_drag",
        rust_path: "nimi_shell_tauri::capabilities::shell_ui::start_window_drag",
        boundary: ShellCommandBoundary::ShellUi,
    },
    ShellCommandDescriptor {
        command_name: "focus_main_window",
        rust_path: "nimi_shell_tauri::capabilities::shell_ui::focus_main_window",
        boundary: ShellCommandBoundary::ShellUi,
    },
];

pub const STANDARD_FILE_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "file_dialog_open",
        rust_path: "nimi_shell_tauri::capabilities::file_dialog::file_dialog_open",
        boundary: ShellCommandBoundary::Files,
    },
    ShellCommandDescriptor {
        command_name: "file_reveal_reveal",
        rust_path: "nimi_shell_tauri::capabilities::file_reveal::file_reveal_reveal",
        boundary: ShellCommandBoundary::Files,
    },
    ShellCommandDescriptor {
        command_name: "export_save_file",
        rust_path: "nimi_shell_tauri::capabilities::export::export_save_file",
        boundary: ShellCommandBoundary::Files,
    },
    ShellCommandDescriptor {
        command_name: "artifacts_write",
        rust_path: "nimi_shell_tauri::capabilities::artifacts::artifacts_write",
        boundary: ShellCommandBoundary::Files,
    },
];

pub const STANDARD_LOCAL_ASSET_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "local_assets_resolve_url",
    rust_path: "nimi_shell_tauri::capabilities::local_assets::local_assets_resolve_url",
    boundary: ShellCommandBoundary::LocalAssets,
}];

pub const STANDARD_LOCAL_AGENT_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "local_agent_identity",
        rust_path: "nimi_shell_tauri::capabilities::local_agent::local_agent_identity",
        boundary: ShellCommandBoundary::LocalAgent,
    },
    ShellCommandDescriptor {
        command_name: "local_agent_runtime_trusted_caller",
        rust_path:
            "nimi_shell_tauri::capabilities::local_agent::local_agent_runtime_trusted_caller",
        boundary: ShellCommandBoundary::LocalAgent,
    },
];

pub const STANDARD_AVATAR_COMMANDS: &[ShellCommandDescriptor] = &[ShellCommandDescriptor {
    command_name: "avatar_asset_resolve",
    rust_path: "nimi_shell_tauri::capabilities::avatar::avatar_asset_resolve",
    boundary: ShellCommandBoundary::Avatar,
}];

pub const STANDARD_AGENT_CENTER_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "agent_center_avatar_asset_import",
        rust_path: "nimi_shell_tauri::capabilities::agent_center::agent_center_avatar_asset_import",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_avatar_asset_validate",
        rust_path:
            "nimi_shell_tauri::capabilities::agent_center::agent_center_avatar_asset_validate",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_avatar_asset_resolve_preview",
        rust_path:
            "nimi_shell_tauri::capabilities::agent_center::agent_center_avatar_asset_resolve_preview",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_live2d_adapter_import",
        rust_path:
            "nimi_shell_tauri::capabilities::agent_center::agent_center_live2d_adapter_import",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_background_import",
        rust_path: "nimi_shell_tauri::capabilities::agent_center::agent_center_background_import",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_background_get",
        rust_path: "nimi_shell_tauri::capabilities::agent_center::agent_center_background_get",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_background_validate",
        rust_path:
            "nimi_shell_tauri::capabilities::agent_center::agent_center_background_validate",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_background_remove",
        rust_path: "nimi_shell_tauri::capabilities::agent_center::agent_center_background_remove",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_agent_resources_remove",
        rust_path:
            "nimi_shell_tauri::capabilities::agent_center::agent_center_agent_resources_remove",
        boundary: ShellCommandBoundary::AgentCenter,
    },
    ShellCommandDescriptor {
        command_name: "agent_center_account_resources_remove",
        rust_path:
            "nimi_shell_tauri::capabilities::agent_center::agent_center_account_resources_remove",
        boundary: ShellCommandBoundary::AgentCenter,
    },
];

pub const STANDARD_PLATFORM_PROJECTION_COMMANDS: &[ShellCommandDescriptor] =
    &[ShellCommandDescriptor {
        command_name: "platform_projection_get",
        rust_path: "nimi_shell_tauri::capabilities::platform_projection::platform_projection_get",
        boundary: ShellCommandBoundary::PlatformProjection,
    }];

pub const STANDARD_FLOATING_WINDOW_COMMANDS: &[ShellCommandDescriptor] = &[
    ShellCommandDescriptor {
        command_name: "floating_window_set_bounds",
        rust_path: "nimi_shell_tauri::standard_floating_window::floating_window_set_bounds",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_set_ignore_cursor_events",
        rust_path:
            "nimi_shell_tauri::standard_floating_window::floating_window_set_ignore_cursor_events",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_set_always_on_top",
        rust_path: "nimi_shell_tauri::standard_floating_window::floating_window_set_always_on_top",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_hide",
        rust_path: "nimi_shell_tauri::standard_floating_window::floating_window_hide",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_close",
        rust_path: "nimi_shell_tauri::standard_floating_window::floating_window_close",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_begin_manual_drag",
        rust_path: "nimi_shell_tauri::standard_floating_window::floating_window_begin_manual_drag",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_move_manual_drag",
        rust_path: "nimi_shell_tauri::standard_floating_window::floating_window_move_manual_drag",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
    ShellCommandDescriptor {
        command_name: "floating_window_constrain_to_visible_area",
        rust_path:
            "nimi_shell_tauri::standard_floating_window::floating_window_constrain_to_visible_area",
        boundary: ShellCommandBoundary::FloatingWindow,
    },
];

pub fn all_shell_commands() -> Vec<ShellCommandDescriptor> {
    let mut commands = Vec::new();
    commands.extend_from_slice(RUNTIME_DEFAULTS_COMMANDS);
    commands.extend_from_slice(RUNTIME_BRIDGE_COMMANDS);
    commands.extend_from_slice(PROTECTED_DESKTOP_ACCOUNT_COMMANDS);
    commands.extend_from_slice(OAUTH_COMMANDS);
    commands.extend_from_slice(DESKTOP_OPEN_INTENT_COMMANDS);
    commands.extend_from_slice(SESSION_LOGGING_COMMANDS);
    commands.extend_from_slice(STANDARD_DIAGNOSTICS_COMMANDS);
    commands.extend_from_slice(STANDARD_STORAGE_COMMANDS);
    commands.extend_from_slice(STANDARD_SHELL_UI_COMMANDS);
    commands.extend_from_slice(STANDARD_FILE_COMMANDS);
    commands.extend_from_slice(STANDARD_LOCAL_ASSET_COMMANDS);
    commands.extend_from_slice(STANDARD_LOCAL_AGENT_COMMANDS);
    commands.extend_from_slice(STANDARD_AVATAR_COMMANDS);
    commands.extend_from_slice(STANDARD_AGENT_CENTER_COMMANDS);
    commands.extend_from_slice(STANDARD_PLATFORM_PROJECTION_COMMANDS);
    commands.extend_from_slice(STANDARD_FLOATING_WINDOW_COMMANDS);
    commands
}

pub fn local_app_standard_shell_commands() -> Vec<ShellCommandDescriptor> {
    LOCAL_APP_COMMANDS.to_vec()
}

#[macro_export]
macro_rules! nimi_shell_tauri_local_app_standard_shell_handler {
    ($($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $crate::capabilities::local_app::local_app_session_status,
            $crate::capabilities::local_app::local_app_ai_config_get,
            $crate::capabilities::local_app::local_app_ai_config_overwrite,
            $crate::capabilities::local_app::local_app_text_generate_candidate,
            $crate::capabilities::storage::storage_read_json,
            $crate::capabilities::storage::storage_write_json,
            $crate::capabilities::storage::storage_remove_json,
            $($app_command),*
        ]
    };
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
            $crate::capabilities::runtime::runtime_bridge_restart,
            $crate::capabilities::data::data_path_resolve,
            $crate::capabilities::storage::storage_read_json,
            $crate::capabilities::storage::storage_write_json,
            $crate::capabilities::storage::storage_remove_json,
            $crate::capabilities::diagnostics::diagnostics_renderer_entry_probe,
            $crate::capabilities::shell_ui::confirm_dialog,
            $crate::capabilities::shell_ui::start_window_drag,
            $crate::capabilities::shell_ui::focus_main_window,
            $crate::capabilities::local_assets::local_assets_resolve_url,
            $crate::capabilities::local_agent::local_agent_identity,
            $crate::capabilities::local_agent::local_agent_runtime_trusted_caller,
            $crate::capabilities::avatar::avatar_asset_resolve,
            $crate::capabilities::agent_center::agent_center_avatar_asset_import,
            $crate::capabilities::agent_center::agent_center_avatar_asset_validate,
            $crate::capabilities::agent_center::agent_center_avatar_asset_resolve_preview,
            $crate::capabilities::agent_center::agent_center_live2d_adapter_import,
            $crate::capabilities::agent_center::agent_center_background_import,
            $crate::capabilities::agent_center::agent_center_background_get,
            $crate::capabilities::agent_center::agent_center_background_validate,
            $crate::capabilities::agent_center::agent_center_background_remove,
            $crate::capabilities::agent_center::agent_center_agent_resources_remove,
            $crate::capabilities::agent_center::agent_center_account_resources_remove,
            $crate::capabilities::platform_projection::platform_projection_get,
            $crate::capabilities::file_dialog::file_dialog_open,
            $crate::capabilities::file_reveal::file_reveal_reveal,
            $crate::capabilities::export::export_save_file,
            $crate::capabilities::artifacts::artifacts_write,
            $crate::capabilities::desktop_open::desktop_open_intent_open_intent,
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
macro_rules! nimi_shell_tauri_oauth_runtime_bridge_handler {
    (@with_runtime_defaults $runtime_defaults:path; $($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $runtime_defaults,
            $crate::capabilities::oauth::open_external_url,
            $crate::capabilities::oauth::oauth_listen_for_code,
            $crate::capabilities::runtime::runtime_bridge_unary,
            $crate::capabilities::runtime::runtime_bridge_stream_open,
            $crate::capabilities::runtime::runtime_bridge_stream_close,
            $crate::capabilities::runtime::runtime_bridge_status,
            $crate::capabilities::runtime::runtime_bridge_start,
            $crate::capabilities::runtime::runtime_bridge_restart,
            $crate::capabilities::runtime::runtime_account_session_status,
            $crate::capabilities::runtime::runtime_account_session_events_open,
            $crate::capabilities::runtime::runtime_account_session_events_close,
            $crate::capabilities::runtime::runtime_account_begin_login,
            $crate::capabilities::runtime::runtime_account_complete_login,
            $crate::capabilities::runtime::runtime_account_invoke_realm_unary,
            $crate::capabilities::runtime::runtime_account_logout,
            $crate::capabilities::runtime::runtime_account_switch_account,
            $crate::capabilities::session_logging::log_renderer_event,
            $crate::capabilities::data::data_path_resolve,
            $crate::capabilities::storage::storage_read_json,
            $crate::capabilities::storage::storage_write_json,
            $crate::capabilities::storage::storage_remove_json,
            $crate::capabilities::diagnostics::diagnostics_renderer_entry_probe,
            $crate::capabilities::shell_ui::confirm_dialog,
            $crate::capabilities::shell_ui::start_window_drag,
            $crate::capabilities::shell_ui::focus_main_window,
            $crate::capabilities::local_assets::local_assets_resolve_url,
            $crate::capabilities::local_agent::local_agent_identity,
            $crate::capabilities::local_agent::local_agent_runtime_trusted_caller,
            $crate::capabilities::avatar::avatar_asset_resolve,
            $crate::capabilities::agent_center::agent_center_avatar_asset_import,
            $crate::capabilities::agent_center::agent_center_avatar_asset_validate,
            $crate::capabilities::agent_center::agent_center_avatar_asset_resolve_preview,
            $crate::capabilities::agent_center::agent_center_live2d_adapter_import,
            $crate::capabilities::agent_center::agent_center_background_import,
            $crate::capabilities::agent_center::agent_center_background_get,
            $crate::capabilities::agent_center::agent_center_background_validate,
            $crate::capabilities::agent_center::agent_center_background_remove,
            $crate::capabilities::agent_center::agent_center_agent_resources_remove,
            $crate::capabilities::agent_center::agent_center_account_resources_remove,
            $crate::capabilities::platform_projection::platform_projection_get,
            $crate::capabilities::file_dialog::file_dialog_open,
            $crate::capabilities::file_reveal::file_reveal_reveal,
            $crate::capabilities::export::export_save_file,
            $crate::capabilities::artifacts::artifacts_write,
            $crate::capabilities::desktop_open::desktop_open_intent_open_intent,
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

/// Standalone floating-window command handler group. Expands to a single
/// `tauri::generate_handler!` that registers only the eight `floating_window_*`
/// commands plus any extra app commands passed in, so a host (e.g. Nimi
/// Avatar) can opt into standard window control without pulling in the
/// runtime/oauth handler families. Intentionally excluded from the
/// default handler macros so window control is not granted to apps that do
/// not opt in.
#[macro_export]
macro_rules! nimi_shell_tauri_floating_window_commands {
    ($($app_command:path),* $(,)?) => {
        tauri::generate_handler![
            $crate::standard_floating_window::floating_window_set_bounds,
            $crate::standard_floating_window::floating_window_set_ignore_cursor_events,
            $crate::standard_floating_window::floating_window_set_always_on_top,
            $crate::standard_floating_window::floating_window_hide,
            $crate::standard_floating_window::floating_window_close,
            $crate::standard_floating_window::floating_window_begin_manual_drag,
            $crate::standard_floating_window::floating_window_move_manual_drag,
            $crate::standard_floating_window::floating_window_constrain_to_visible_area,
            $($app_command),*
        ]
    };
}
