import type { AvatarLaunchContext } from '../bridge/index.js';
import {
  hasAvatarTauriHostRuntime,
  listenAvatarHostEvent,
} from './avatar-host-bridge.js';

type UnlistenFn = () => void;

export type ShellReadyPayload = {
  label: string;
  width: number;
  height: number;
};

export async function onShellReady(handler: (payload: ShellReadyPayload) => void): Promise<UnlistenFn> {
  return listenAvatarHostEvent<ShellReadyPayload>('avatar://shell-ready', handler);
}

export async function onLaunchContextUpdated(
  handler: (payload: AvatarLaunchContext) => void,
): Promise<UnlistenFn> {
  return listenAvatarHostEvent<AvatarLaunchContext>('avatar://launch-context-updated', handler);
}

export function isTauriRuntime(): boolean {
  return hasAvatarTauriHostRuntime();
}
