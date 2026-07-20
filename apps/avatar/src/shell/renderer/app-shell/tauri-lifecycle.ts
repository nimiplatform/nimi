import type { AvatarLaunchContext } from '../bridge/index.js';
import {
  hasAvatarHostRuntime,
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
  if (hasAvatarHostRuntime() && !hasAvatarTauriHostRuntime()) {
    handler({
      label: 'desktop-supervised-avatar',
      width: typeof window === 'undefined' ? 400 : window.innerWidth,
      height: typeof window === 'undefined' ? 600 : window.innerHeight,
    });
    return () => {};
  }
  return listenAvatarHostEvent<ShellReadyPayload>('avatar://shell-ready', handler);
}

export async function onLaunchContextUpdated(
  handler: (payload: AvatarLaunchContext) => void,
): Promise<UnlistenFn> {
  if (hasAvatarHostRuntime() && !hasAvatarTauriHostRuntime()) {
    return () => {};
  }
  return listenAvatarHostEvent<AvatarLaunchContext>('avatar://launch-context-updated', handler);
}

export function isTauriRuntime(): boolean {
  return hasAvatarTauriHostRuntime();
}
