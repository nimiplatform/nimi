import type { AvatarLaunchContext } from '../bridge/index.js';
import { listenAvatarHostEvent } from './avatar-host-bridge.js';

type UnlistenFn = () => void;

export async function onLaunchContextUpdated(
  handler: (payload: AvatarLaunchContext) => void,
): Promise<UnlistenFn> {
  return listenAvatarHostEvent<AvatarLaunchContext>('avatar://launch-context-updated', handler);
}

export async function onHostSuspend(handler: () => void): Promise<UnlistenFn> {
  return listenAvatarHostEvent<Record<string, never>>('avatar://host-suspend', handler);
}
