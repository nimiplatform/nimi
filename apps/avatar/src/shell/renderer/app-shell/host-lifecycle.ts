import { listenAvatarHostEvent } from './avatar-host-bridge.js';

type UnlistenFn = () => void;

export async function onHostSuspend(handler: () => void): Promise<UnlistenFn> {
  return listenAvatarHostEvent<Record<string, never>>('avatar://host-suspend', handler);
}
