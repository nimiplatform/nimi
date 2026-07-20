import {
  hasElectronRuntime,
  hasTauriRuntime,
  invokeShell,
  invokeTauri,
  listenShell,
  listenTauri,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type ShellEventUnsubscribe = () => void;

export function hasAvatarHostRuntime(): boolean {
  return hasTauriRuntime() || hasElectronRuntime();
}

export function hasAvatarTauriHostRuntime(): boolean {
  return hasTauriRuntime();
}

export async function invokeAvatarHostCommand<T>(
  command: string,
  payload?: unknown,
): Promise<T> {
  if (hasElectronRuntime()) {
    return invokeShell<T>(command, payload);
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
  if (hasElectronRuntime()) {
    return listenShell(eventName, (event) => handler(event.payload as T));
  }
  if (hasTauriRuntime()) {
    return listenTauri(eventName, (event) => handler(event.payload as T));
  }
  throw createAvatarHostUnavailableError(eventName);
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
