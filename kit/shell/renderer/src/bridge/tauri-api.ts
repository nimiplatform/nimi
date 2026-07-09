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
  installedAppLaunchBinding?: unknown;
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
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.stop']]: 'runtime_bridge_stop',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-lifecycle.restart']]: 'runtime_bridge_restart',
  [NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get']]: 'runtime_defaults',
  [NIMI_STANDARD_SHELL_COMMANDS['data.pathResolve']]: 'data_path_resolve',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.readJson']]: 'storage_read_json',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson']]: 'storage_write_json',
  [NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson']]: 'storage_remove_json',
  [NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']]: 'ai_config_get',
  [NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']]: 'ai_config_set',
  [NIMI_STANDARD_SHELL_COMMANDS['config.get']]: 'runtime_bridge_config_get',
  [NIMI_STANDARD_SHELL_COMMANDS['config.set']]: 'runtime_bridge_config_set',
  [NIMI_STANDARD_SHELL_COMMANDS['auth.sessionLoad']]: 'auth_session_load',
  [NIMI_STANDARD_SHELL_COMMANDS['auth.sessionSave']]: 'auth_session_save',
  [NIMI_STANDARD_SHELL_COMMANDS['auth.sessionClear']]: 'auth_session_clear',
  [NIMI_STANDARD_SHELL_COMMANDS['oauth.openExternalUrl']]: 'open_external_url',
  [NIMI_STANDARD_SHELL_COMMANDS['oauth.tokenExchange']]: 'oauth_token_exchange',
  [NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode']]: 'oauth_listen_for_code',
  [NIMI_STANDARD_SHELL_COMMANDS['desktop-open.openIntent']]: 'desktop_open_intent_open_intent',
  [NIMI_STANDARD_SHELL_COMMANDS['diagnostics.rendererEntryProbe']]: 'diagnostics_renderer_entry_probe',
  [NIMI_STANDARD_SHELL_COMMANDS['shell-ui.confirmDialog']]: 'confirm_dialog',
  [NIMI_STANDARD_SHELL_COMMANDS['shell-ui.startWindowDrag']]: 'start_window_drag',
  [NIMI_STANDARD_SHELL_COMMANDS['shell-ui.focusMainWindow']]: 'focus_main_window',
  [NIMI_STANDARD_SHELL_COMMANDS['local-assets.resolveUrl']]: 'local_assets_resolve_url',
  [NIMI_STANDARD_SHELL_COMMANDS['local-agent.identity']]: 'local_agent_identity',
  [NIMI_STANDARD_SHELL_COMMANDS['local-agent.runtimeTrustedCaller']]: 'local_agent_runtime_trusted_caller',
  [NIMI_STANDARD_SHELL_COMMANDS['avatar.assetResolve']]: 'avatar_asset_resolve',
  [NIMI_STANDARD_SHELL_COMMANDS['platform-projection.get']]: 'platform_projection_get',
  [NIMI_STANDARD_SHELL_COMMANDS['file-dialog.open']]: 'file_dialog_open',
  [NIMI_STANDARD_SHELL_COMMANDS['file-reveal.reveal']]: 'file_reveal_reveal',
  [NIMI_STANDARD_SHELL_COMMANDS['export.saveFile']]: 'export_save_file',
  [NIMI_STANDARD_SHELL_COMMANDS['artifacts.write']]: 'artifacts_write',
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
