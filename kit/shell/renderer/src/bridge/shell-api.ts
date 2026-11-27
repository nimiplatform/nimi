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
export type NimiElectronRuntimeHook = {
  invoke?: ShellInvoke;
  listen?: ElectronEventListen;
};

export type ShellRuntimeGlobal = typeof globalThis & {
  __NIMI_ELECTRON_TEST__?: NimiElectronRuntimeHook;
  __NIMI_ELECTRON_RUNTIME__?: NimiElectronRuntimeHook;
  window?: {
    __NIMI_ELECTRON_TEST__?: NimiElectronRuntimeHook;
    __NIMI_ELECTRON_RUNTIME__?: NimiElectronRuntimeHook;
  };
};

export type NimiShellRuntimeBridgeResult =
  | { installed: true; host: 'electron'; reason: 'electron-preload-present' }
  | { installed: false; reason: 'standard-host-preload-required' };

function shellGlobal(): ShellRuntimeGlobal {
  return globalThis as ShellRuntimeGlobal;
}

function electronHook(): NimiElectronRuntimeHook | undefined {
  const value = shellGlobal();
  return value.__NIMI_ELECTRON_TEST__
    || value.window?.__NIMI_ELECTRON_TEST__
    || value.__NIMI_ELECTRON_RUNTIME__
    || value.window?.__NIMI_ELECTRON_RUNTIME__;
}

export function hasElectronRuntime(): boolean {
  const hook = electronHook();
  return Boolean(hook?.invoke || hook?.listen);
}

export function hasElectronInvoke(): boolean {
  return Boolean(electronHook()?.invoke);
}

export function hasNimiShellRuntime(): boolean {
  return hasElectronRuntime();
}

export async function invokeShell<T>(command: string, payload: unknown = {}): Promise<T> {
  const electronInvoke = electronHook()?.invoke;
  if (!electronInvoke) {
    throw new Error(`Standard shell host invoke is not available for ${command}`);
  }
  return await electronInvoke(command, payload) as T;
}

export async function listenShell(
  eventName: string,
  handler: (event: { event?: string; id?: number; payload: unknown }) => void,
): Promise<ShellEventUnsubscribe> {
  const electronListen = electronHook()?.listen;
  if (!electronListen) {
    throw new Error(`Standard shell host listen is not available for ${eventName}`);
  }
  const unsubscribe = electronListen(eventName, (event) => handler(event));
  if (typeof unsubscribe !== 'function') {
    throw new Error(`Electron event listener for "${eventName}" did not return an unsubscribe function`);
  }
  return unsubscribe;
}

export function convertShellFileSrc(fileUrl: string): string {
  if (!hasElectronRuntime()) {
    throw new Error('Standard shell local asset URL conversion is not available');
  }
  return convertElectronFileSrc(fileUrl);
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
