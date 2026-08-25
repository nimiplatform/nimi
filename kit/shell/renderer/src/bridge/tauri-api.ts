import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

export type ShellInvoke = (command: string, payload?: unknown) => Promise<unknown>;
export type ShellEventUnsubscribe = () => void;
export type ShellEventListen = (
  eventName: string,
  handler: (event: { event?: string; id?: number; payload: unknown }) => void,
) => Promise<ShellEventUnsubscribe> | ShellEventUnsubscribe;
export type ElectronEventListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => ShellEventUnsubscribe;
export type TauriTestHook = {
  invoke?: ShellInvoke;
  listen?: ShellEventListen;
  convertFileSrc?: (fileUrl: string) => string;
};
export type NimiShellRuntimeHook = {
  invoke: ShellInvoke;
  listen: ShellEventListen;
  convertFileSrc?: (fileUrl: string) => string;
};
export type NimiElectronRuntimeHook = {
  invoke: ShellInvoke;
  listen: ElectronEventListen;
};

export type TauriRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  __NIMI_TAURI_RUNTIME__?: NimiShellRuntimeHook;
  __NIMI_ELECTRON_TEST__?: NimiElectronRuntimeHook;
  __NIMI_ELECTRON_RUNTIME__?: NimiElectronRuntimeHook;
  window?: {
    __NIMI_TAURI_TEST__?: TauriTestHook;
    __NIMI_TAURI_RUNTIME__?: NimiShellRuntimeHook;
    __NIMI_ELECTRON_TEST__?: NimiElectronRuntimeHook;
    __NIMI_ELECTRON_RUNTIME__?: NimiElectronRuntimeHook;
  };
};

export type NimiShellRuntimeBridgeResult =
  | { installed: true; host: 'tauri' }
  | { installed: true; host: 'electron'; reason: 'electron-preload-present' }
  | { installed: false; reason: 'standard-host-preload-required' };

export const TAURI_STANDARD_COMMAND_ALIASES: Readonly<Record<string, string>> = {
  [NIMI_STANDARD_SHELL_COMMANDS['runtime.unary']]: 'runtime_bridge_unary',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime.streamOpen']]: 'runtime_bridge_stream_open',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime.streamClose']]: 'runtime_bridge_stream_close',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.status']]: 'runtime_bridge_status',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.start']]: 'runtime_bridge_start',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart']]: 'runtime_bridge_restart',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get']]: 'runtime_defaults',
  [NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']]: 'data_path_resolve',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']]: 'storage_read_json',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']]: 'storage_write_json',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']]: 'storage_remove_json',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat']]: 'local_app_asset_stat',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetList']]: 'local_app_asset_list',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteOpen']]: 'local_app_asset_write_open',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteChunk']]: 'local_app_asset_write_chunk',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteCommit']]: 'local_app_asset_write_commit',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteAbort']]: 'local_app_asset_write_abort',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadOpen']]: 'local_app_asset_read_open',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadNext']]: 'local_app_asset_read_next',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadClose']]: 'local_app_asset_read_close',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetRemove']]: 'local_app_asset_remove',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetMove']]: 'local_app_asset_move',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetReveal']]: 'local_app_asset_reveal',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.assetAdopt']]: 'local_app_asset_adopt',
  [NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']]: 'open_external_url',
  [NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode']]: 'oauth_listen_for_code',
  [NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']]: 'desktop_open_intent_open_intent',
  [NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe']]: 'diagnostics_renderer_entry_probe',
  [NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']]: 'confirm_dialog',
  [NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag']]: 'start_window_drag',
  [NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow']]: 'focus_main_window',
  [NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']]: 'local_assets_resolve_url',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus']]: 'local_app_session_status',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigGet']]: 'local_app_ai_config_get',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigOverwrite']]: 'local_app_ai_config_overwrite',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigLocalOptions']]: 'local_app_ai_config_local_options',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreList']]: 'local_app_realm_world_core_list',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreCreate']]: 'local_app_realm_world_core_create',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterListOwned']]: 'local_app_persona_character_list_owned',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterGetOwned']]: 'local_app_persona_character_get_owned',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterCreate']]: 'local_app_persona_character_create',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterReplace']]: 'local_app_persona_character_replace',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterDelete']]: 'local_app_persona_character_delete',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate']]: 'local_app_text_generate_candidate',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactUpload']]: 'local_app_artifact_upload',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet']]: 'local_app_shared_agent_ai_config_get',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigOverwrite']]: 'local_app_shared_agent_ai_config_overwrite',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigLocalOptions']]: 'local_app_shared_agent_ai_config_local_options',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentAutonomySnapshot']]: 'local_app_agent_autonomy_snapshot',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentUpdateAutonomy']]: 'local_app_agent_update_autonomy',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentPresentationSnapshot']]: 'local_app_agent_presentation_snapshot',
  [NIMI_STANDARD_SHELL_COMMANDS['local-app.agentCommitPresentation']]: 'local_app_agent_commit_presentation',
  [NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity']]: 'local_agent_identity',
  [NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']]: 'local_agent_runtime_trusted_caller',
  [NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve']]: 'avatar_asset_resolve',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetImport']]: 'agent_center_avatar_asset_import',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetValidate']]: 'agent_center_avatar_asset_validate',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.avatarAssetResolvePreview']]: 'agent_center_avatar_asset_resolve_preview',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.live2dAdapterImport']]: 'agent_center_live2d_adapter_import',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundImport']]: 'agent_center_background_import',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundGet']]: 'agent_center_background_get',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundValidate']]: 'agent_center_background_validate',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.backgroundRemove']]: 'agent_center_background_remove',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.agentResourcesRemove']]: 'agent_center_agent_resources_remove',
  [NIMI_STANDARD_SHELL_COMMANDS['agent-center.accountResourcesRemove']]: 'agent_center_account_resources_remove',
  [NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']]: 'platform_projection_get',
  [NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']]: 'file_dialog_open',
  [NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']]: 'file_reveal_reveal',
  [NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']]: 'export_save_file',
  [NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']]: 'artifacts_write',
  [NIMI_STANDARD_SHELL_COMMANDS['artifacts.readRuntimeBytes']]: 'artifacts_read_runtime_bytes',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.setBounds']]: 'floating_window_set_bounds',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.setIgnoreCursorEvents']]: 'floating_window_set_ignore_cursor_events',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.setAlwaysOnTop']]: 'floating_window_set_always_on_top',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.hide']]: 'floating_window_hide',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.close']]: 'floating_window_close',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.beginManualDrag']]: 'floating_window_begin_manual_drag',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.moveManualDrag']]: 'floating_window_move_manual_drag',
  [NIMI_STANDARD_SHELL_COMMANDS['floating-window.constrainToVisibleArea']]: 'floating_window_constrain_to_visible_area',
};

export function resolveTauriStandardCommand(command: string): string {
  return TAURI_STANDARD_COMMAND_ALIASES[command] ?? command;
}

const TAURI_STRUCT_PAYLOAD_COMMANDS = new Set([
  'runtime_account_session_events_open',
  'runtime_account_session_events_close',
]);

/**
 * Preserve one renderer command contract across Electron and Tauri while
 * adapting the two account-stream commands to Tauri's named `payload` ABI.
 * The complete renderer object is nested so Rust's deny-unknown-fields
 * decoder still rejects caller or authority injection.
 */
export function resolveTauriInvokePayload(command: string, payload: unknown): unknown {
  return TAURI_STRUCT_PAYLOAD_COMMANDS.has(command) ? { payload } : payload;
}

function shellGlobal(): TauriRuntimeGlobal {
  return globalThis as TauriRuntimeGlobal;
}

function testHook(): TauriTestHook | undefined {
  const value = shellGlobal();
  return value.__NIMI_TAURI_TEST__ || value.window?.__NIMI_TAURI_TEST__;
}

function testInvoke(): ShellInvoke | undefined {
  return testHook()?.invoke;
}

function runtimeHook(): NimiShellRuntimeHook | undefined {
  const value = shellGlobal();
  return value.__NIMI_TAURI_RUNTIME__ || value.window?.__NIMI_TAURI_RUNTIME__;
}

function electronHook(): NimiElectronRuntimeHook | undefined {
  const value = shellGlobal();
  return value.__NIMI_ELECTRON_TEST__
    || value.window?.__NIMI_ELECTRON_TEST__
    || value.__NIMI_ELECTRON_RUNTIME__
    || value.window?.__NIMI_ELECTRON_RUNTIME__;
}

export function hasTauriRuntime(): boolean {
  return Boolean(testInvoke() || testHook()?.listen || runtimeHook()?.invoke || runtimeHook()?.listen);
}

export function hasTauriInvoke(): boolean {
  return Boolean(testInvoke() || runtimeHook()?.invoke);
}

export function hasElectronRuntime(): boolean {
  const hook = electronHook();
  return Boolean(hook?.invoke || hook?.listen);
}

export function hasElectronInvoke(): boolean {
  return Boolean(electronHook()?.invoke);
}

export function hasNimiShellRuntime(): boolean {
  return hasTauriRuntime() || hasElectronRuntime();
}

export async function invokeTauri<T>(command: string, payload: unknown = {}): Promise<T> {
  const invoke = testInvoke() ?? runtimeHook()?.invoke;
  if (!invoke) {
    throw new Error(`Standard shell Tauri host invoke is not available for ${command}`);
  }
  return await invoke(command, payload) as T;
}

export async function listenTauri(
  eventName: string,
  handler: (event: { event?: string; id?: number; payload: unknown }) => void,
): Promise<ShellEventUnsubscribe> {
  const listen = testHook()?.listen ?? runtimeHook()?.listen;
  if (!listen) {
    throw new Error(`Standard shell Tauri host listen is not available for ${eventName}`);
  }
  const unsubscribe = await Promise.resolve(listen(eventName, handler));
  if (typeof unsubscribe !== 'function') {
    throw new Error(`Tauri event listener for "${eventName}" did not return an unsubscribe function`);
  }
  return unsubscribe;
}

export async function invokeShell<T>(command: string, payload: unknown = {}): Promise<T> {
  const electronInvoke = electronHook()?.invoke;
  if (electronInvoke) {
    return await electronInvoke(command, payload) as T;
  }
  return await invokeTauri<T>(command, payload);
}

export async function listenShell(
  eventName: string,
  handler: (event: { event?: string; id?: number; payload: unknown }) => void,
): Promise<ShellEventUnsubscribe> {
  const electronListen = electronHook()?.listen;
  if (electronListen) {
    const unsubscribe = electronListen(eventName, (event) => handler(event));
    if (typeof unsubscribe !== 'function') {
      throw new Error(`Electron event listener for "${eventName}" did not return an unsubscribe function`);
    }
    return unsubscribe;
  }
  return await listenTauri(eventName, handler);
}

export function convertTauriFileSrc(fileUrl: string): string {
  if (hasElectronRuntime()) {
    return convertElectronFileSrc(fileUrl);
  }
  const convertFileSrc = testHook()?.convertFileSrc ?? runtimeHook()?.convertFileSrc;
  if (!convertFileSrc) {
    throw new Error('Standard shell local asset URL conversion is not available');
  }
  return convertFileSrc(fileUrl);
}

function convertElectronFileSrc(fileUrl: string): string {
  const normalized = String(fileUrl || '').trim();
  if (!normalized || /^(?:https?:|data:|blob:|nimi-shell-file:)/u.test(normalized)) {
    return normalized;
  }
  return `nimi-shell-file://local/?path=${encodeElectronShellFilePath(normalized)}`;
}

function encodeElectronShellFilePath(filePath: string): string {
  const bytes = new TextEncoder().encode(filePath);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
