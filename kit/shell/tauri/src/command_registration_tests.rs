#[cfg(test)]
mod tests {
    use crate::command_registration::*;

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
                "runtime_bridge_restart",
                "open_external_url",
                "oauth_token_exchange",
                "oauth_listen_for_code",
                "desktop_open_intent_open_intent",
                "log_renderer_event",
                "diagnostics_renderer_entry_probe",
                "data_path_resolve",
                "storage_read_json",
                "storage_write_json",
                "storage_remove_json",
                "ai_config_get",
                "ai_config_set",
                "confirm_dialog",
                "start_window_drag",
                "focus_main_window",
                "file_dialog_open",
                "file_reveal_reveal",
                "export_save_file",
                "artifacts_write",
                "local_assets_resolve_url",
                "local_agent_identity",
                "local_agent_runtime_trusted_caller",
                "avatar_asset_resolve",
                "agent_center_avatar_asset_import",
                "agent_center_avatar_asset_validate",
                "agent_center_avatar_asset_resolve_preview",
                "agent_center_live2d_adapter_import",
                "agent_center_background_import",
                "agent_center_background_get",
                "agent_center_background_validate",
                "agent_center_background_remove",
                "agent_center_agent_resources_remove",
                "agent_center_account_resources_remove",
                "platform_projection_get",
                "floating_window_set_bounds",
                "floating_window_set_ignore_cursor_events",
                "floating_window_set_always_on_top",
                "floating_window_hide",
                "floating_window_close",
                "floating_window_begin_manual_drag",
                "floating_window_move_manual_drag",
                "floating_window_constrain_to_visible_area",
            ]
        );
    }

    #[test]
    fn public_catalog_keeps_boundaries_explicit() {
        let commands = all_shell_commands();

        assert!(commands
            .iter()
            .all(|command| !command.command_name.starts_with("auth_session_")));
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
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::Diagnostics));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::Storage));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::AiConfig));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::ShellUi));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::Files));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::LocalAssets));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::LocalAgent));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::Avatar));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::AgentCenter));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::PlatformProjection));
        assert!(commands
            .iter()
            .any(|command| command.boundary == ShellCommandBoundary::FloatingWindow));
    }

    #[test]
    fn runtime_bridge_catalog_excludes_retired_stop_and_runtime_config_controls() {
        let names = RUNTIME_BRIDGE_COMMANDS
            .iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "runtime_bridge_unary",
                "runtime_bridge_stream_open",
                "runtime_bridge_stream_close",
                "runtime_bridge_status",
                "runtime_bridge_start",
                "runtime_bridge_restart",
            ]
        );
        for forbidden in [
            "runtime_bridge_stop",
            "runtime_bridge_config_get",
            "runtime_bridge_config_set",
        ] {
            assert!(!names.contains(&forbidden));
        }
    }

    #[test]
    fn standard_floating_window_commands_cover_all_eight_operations() {
        let names = STANDARD_FLOATING_WINDOW_COMMANDS
            .iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "floating_window_set_bounds",
                "floating_window_set_ignore_cursor_events",
                "floating_window_set_always_on_top",
                "floating_window_hide",
                "floating_window_close",
                "floating_window_begin_manual_drag",
                "floating_window_move_manual_drag",
                "floating_window_constrain_to_visible_area",
            ]
        );
        assert!(STANDARD_FLOATING_WINDOW_COMMANDS
            .iter()
            .all(|command| command.boundary == ShellCommandBoundary::FloatingWindow));
    }

    #[test]
    fn floating_window_commands_are_excluded_from_default_handler_families() {
        for descriptor in STANDARD_FLOATING_WINDOW_COMMANDS {
            assert!(!RUNTIME_BRIDGE_COMMANDS
                .iter()
                .chain(STANDARD_STORAGE_COMMANDS)
                .chain(STANDARD_SHELL_UI_COMMANDS)
                .chain(STANDARD_FILE_COMMANDS)
                .chain(STANDARD_DIAGNOSTICS_COMMANDS)
                .chain(STANDARD_LOCAL_ASSET_COMMANDS)
                .chain(STANDARD_LOCAL_AGENT_COMMANDS)
                .chain(STANDARD_AVATAR_COMMANDS)
                .chain(STANDARD_AGENT_CENTER_COMMANDS)
                .chain(STANDARD_PLATFORM_PROJECTION_COMMANDS)
                .chain(OAUTH_COMMANDS)
                .any(|other| other.command_name == descriptor.command_name));
        }
    }

    #[test]
    fn standard_ai_config_commands_cover_installed_app_operations() {
        let names = STANDARD_AI_CONFIG_COMMANDS
            .iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["ai_config_get", "ai_config_set"]);
        assert!(STANDARD_AI_CONFIG_COMMANDS
            .iter()
            .all(|command| command.boundary == ShellCommandBoundary::AiConfig));
    }

    #[test]
    fn standard_file_commands_cover_new_standard_capabilities() {
        let names = STANDARD_FILE_COMMANDS
            .iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "file_dialog_open",
                "file_reveal_reveal",
                "export_save_file",
                "artifacts_write",
            ]
        );
        assert!(STANDARD_FILE_COMMANDS
            .iter()
            .all(|command| command.boundary == ShellCommandBoundary::Files));
    }

    #[test]
    fn standard_agent_center_commands_cover_avatar_resource_custody() {
        let names = STANDARD_AGENT_CENTER_COMMANDS
            .iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "agent_center_avatar_asset_import",
                "agent_center_avatar_asset_validate",
                "agent_center_avatar_asset_resolve_preview",
                "agent_center_live2d_adapter_import",
                "agent_center_background_import",
                "agent_center_background_get",
                "agent_center_background_validate",
                "agent_center_background_remove",
                "agent_center_agent_resources_remove",
                "agent_center_account_resources_remove",
            ]
        );
        assert!(STANDARD_AGENT_CENTER_COMMANDS
            .iter()
            .all(|command| command.boundary == ShellCommandBoundary::AgentCenter));
    }

    #[test]
    fn installed_app_standard_shell_catalog_matches_admitted_surface() {
        let names = installed_app_standard_shell_commands()
            .into_iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "runtime_bridge_unary",
                "runtime_bridge_stream_open",
                "runtime_bridge_stream_close",
                "desktop_open_intent_open_intent",
                "data_path_resolve",
                "storage_read_json",
                "storage_write_json",
                "storage_remove_json",
                "ai_config_get",
                "ai_config_set",
                "confirm_dialog",
                "start_window_drag",
                "focus_main_window",
                "local_assets_resolve_url",
            ]
        );
        for forbidden in [
            "runtime_defaults",
            "runtime_bridge_status",
            "runtime_bridge_start",
            "runtime_bridge_stop",
            "runtime_bridge_restart",
            "auth_session_load",
            "auth_session_save",
            "auth_session_clear",
            "open_external_url",
            "oauth_token_exchange",
            "oauth_listen_for_code",
            "log_renderer_event",
            "diagnostics_renderer_entry_probe",
            "local_agent_identity",
            "local_agent_runtime_trusted_caller",
            "avatar_asset_resolve",
            "agent_center_avatar_asset_import",
            "agent_center_avatar_asset_validate",
            "agent_center_avatar_asset_resolve_preview",
            "agent_center_live2d_adapter_import",
            "agent_center_background_import",
            "agent_center_background_get",
            "agent_center_background_validate",
            "agent_center_background_remove",
            "agent_center_agent_resources_remove",
            "agent_center_account_resources_remove",
            "platform_projection_get",
            "file_dialog_open",
            "file_reveal_reveal",
            "export_save_file",
            "artifacts_write",
            "floating_window_set_bounds",
        ] {
            assert!(!names.contains(&forbidden));
        }
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
        let _floating_window_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_floating_window_commands![test_app_command],
        );
        let _floating_window_only_builder = tauri::Builder::<tauri::Wry>::default()
            .invoke_handler(crate::nimi_shell_tauri_floating_window_commands![]);
        let _installed_app_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_installed_app_standard_shell_handler![test_app_command],
        );
    }
}
