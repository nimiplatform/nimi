import {
  hasElectronRuntime,
  invokeShell,
  listenShell,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type ShellEventUnsubscribe = () => void;

export function hasAvatarHostRuntime(): boolean {
  return hasElectronRuntime();
}

export async function invokeAvatarHostCommand<T>(
  command: string,
  payload?: unknown,
): Promise<T> {
  if (hasElectronRuntime()) {
    return invokeShell<T>(command, payload);
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
  throw createAvatarHostUnavailableError(eventName);
}

function createAvatarHostUnavailableError(command: string): Error {
  const error = new Error(`Avatar host command unavailable: ${command}`);
  Object.assign(error, {
    code: 'capability-unavailable',
    reasonCode: 'avatar-host-unavailable',
    actionHint: 'launch_avatar_from_desktop_electron_host',
    source: 'renderer',
    details: { command },
  });
  return error;
}
