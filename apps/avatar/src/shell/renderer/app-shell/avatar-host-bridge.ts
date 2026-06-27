import {
  hasTauriRuntime,
  invokeTauri,
  listenTauri,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type ShellEventUnsubscribe = () => void;

type AvatarElectronHost = {
  invoke: <T>(command: string, payload?: unknown) => Promise<T>;
};

declare global {
  interface Window {
    __NIMI_AVATAR_ELECTRON__?: AvatarElectronHost;
  }
}

export function getAvatarElectronHost(): AvatarElectronHost | undefined {
  return typeof window === 'undefined' ? undefined : window.__NIMI_AVATAR_ELECTRON__;
}

export function hasAvatarHostRuntime(): boolean {
  return hasTauriRuntime() || Boolean(getAvatarElectronHost());
}

export function hasAvatarTauriHostRuntime(): boolean {
  return hasTauriRuntime();
}

export async function invokeAvatarHostCommand<T>(
  command: string,
  payload?: unknown,
): Promise<T> {
  const electronHost = getAvatarElectronHost();
  if (electronHost) {
    return electronHost.invoke<T>(command, payload);
  }
  if (hasTauriRuntime()) {
    return invokeTauri<T>(command, payload);
  }
  throw createAvatarHostUnavailableError(command);
}

export async function listenAvatarHostEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<ShellEventUnsubscribe> {
  if (!hasTauriRuntime()) {
    throw createAvatarHostUnavailableError(eventName);
  }
  return listenTauri(eventName, (event) => handler(event.payload as T));
}

function createAvatarHostUnavailableError(command: string): Error {
  const error = new Error(`Avatar host command unavailable: ${command}`);
  Object.assign(error, {
    code: 'capability-unavailable',
    reasonCode: 'avatar-host-unavailable',
    actionHint: 'install_avatar_tauri_or_electron_host_bridge',
    source: 'renderer',
    details: { command },
  });
  return error;
}
