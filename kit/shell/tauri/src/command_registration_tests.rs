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
                "runtime_account_session_status",
                "runtime_account_session_events_open",
                "runtime_account_session_events_close",
                "runtime_account_begin_login",
                "runtime_account_complete_login",
                "runtime_account_invoke_realm_unary",
                "runtime_account_logout",
                "runtime_account_switch_account",
                "open_external_url",
                "oauth_listen_for_code",
                "desktop_open_intent_open_intent",
                "log_renderer_event",
                "diagnostics_renderer_entry_probe",
                "data_path_resolve",
                "storage_read_json",
                "storage_write_json",
                "storage_remove_json",
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
            .any(|command| command.boundary == ShellCommandBoundary::DesktopAccount));
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
    fn local_app_carrier_behavior() {
        let names = local_app_standard_shell_commands()
            .into_iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "local_app_session_status",
                "local_app_ai_config_get",
                "local_app_ai_config_overwrite",
                "local_app_ai_config_local_options",
                "local_app_realm_world_core_list",
                "local_app_realm_world_core_create",
                "local_app_persona_character_list_owned",
                "local_app_persona_character_get_owned",
                "local_app_persona_character_create",
                "local_app_persona_character_replace",
                "local_app_persona_character_delete",
                "local_app_shared_agent_ai_config_get",
                "local_app_shared_agent_ai_config_overwrite",
                "local_app_shared_agent_ai_config_local_options",
                "local_app_agent_autonomy_snapshot",
                "local_app_agent_update_autonomy",
                "local_app_agent_presentation_snapshot",
                "local_app_agent_commit_presentation",
                "local_app_text_generate_candidate",
                "local_app_artifact_upload",
                "local_app_asset_stat",
                "local_app_asset_list",
                "local_app_asset_write_open",
                "local_app_asset_write_chunk",
                "local_app_asset_write_commit",
                "local_app_asset_write_abort",
                "local_app_asset_read_open",
                "local_app_asset_read_next",
                "local_app_asset_read_close",
                "local_app_asset_remove",
                "local_app_asset_move",
                "local_app_asset_reveal",
                "local_app_asset_adopt",
                "storage_read_json",
                "storage_write_json",
                "storage_remove_json",
            ]
        );
        for forbidden in [
            "runtime_bridge_unary",
            "runtime_bridge_restart",
            "oauth_token_exchange",
            "file_dialog_open",
        ] {
            assert!(!names.contains(&forbidden));
        }
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
    fn protected_desktop_account_catalog_is_kit_owned_and_token_free() {
        let names = PROTECTED_DESKTOP_ACCOUNT_COMMANDS
            .iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "runtime_account_session_status",
                "runtime_account_session_events_open",
                "runtime_account_session_events_close",
                "runtime_account_begin_login",
                "runtime_account_complete_login",
                "runtime_account_invoke_realm_unary",
                "runtime_account_logout",
                "runtime_account_switch_account",
            ]
        );
        assert!(PROTECTED_DESKTOP_ACCOUNT_COMMANDS
            .iter()
            .all(|command| command.boundary == ShellCommandBoundary::DesktopAccount));
        assert!(!names.iter().any(|name| name.contains("token")));
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
    fn local_app_standard_shell_catalog_matches_admitted_surface() {
        let names = local_app_standard_shell_commands()
            .into_iter()
            .map(|command| command.command_name)
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            vec![
                "local_app_session_status",
                "local_app_ai_config_get",
                "local_app_ai_config_overwrite",
                "local_app_ai_config_local_options",
                "local_app_realm_world_core_list",
                "local_app_realm_world_core_create",
                "local_app_persona_character_list_owned",
                "local_app_persona_character_get_owned",
                "local_app_persona_character_create",
                "local_app_persona_character_replace",
                "local_app_persona_character_delete",
                "local_app_shared_agent_ai_config_get",
                "local_app_shared_agent_ai_config_overwrite",
                "local_app_shared_agent_ai_config_local_options",
                "local_app_agent_autonomy_snapshot",
                "local_app_agent_update_autonomy",
                "local_app_agent_presentation_snapshot",
                "local_app_agent_commit_presentation",
                "local_app_text_generate_candidate",
                "local_app_artifact_upload",
                "local_app_asset_stat",
                "local_app_asset_list",
                "local_app_asset_write_open",
                "local_app_asset_write_chunk",
                "local_app_asset_write_commit",
                "local_app_asset_write_abort",
                "local_app_asset_read_open",
                "local_app_asset_read_next",
                "local_app_asset_read_close",
                "local_app_asset_remove",
                "local_app_asset_move",
                "local_app_asset_reveal",
                "local_app_asset_adopt",
                "storage_read_json",
                "storage_write_json",
                "storage_remove_json",
            ]
        );
        for forbidden in [
            "runtime_bridge_unary",
            "runtime_bridge_stream_open",
            "runtime_bridge_stream_close",
            "desktop_open_intent_open_intent",
            "data_path_resolve",
            "confirm_dialog",
            "start_window_drag",
            "focus_main_window",
            "local_assets_resolve_url",
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
        let _local_app_builder = tauri::Builder::<tauri::Wry>::default().invoke_handler(
            crate::nimi_shell_tauri_local_app_standard_shell_handler![test_app_command],
        );
    }
}
