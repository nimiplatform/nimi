import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { AvatarLaunchContext } from '@renderer/bridge';

export type ShellReadyPayload = {
  label: string;
  width: number;
  height: number;
};

export async function onShellReady(handler: (payload: ShellReadyPayload) => void): Promise<UnlistenFn> {
  return listen<ShellReadyPayload>('avatar://shell-ready', (event) => {
    handler(event.payload);
  });
}

export async function onLaunchContextUpdated(
  handler: (payload: AvatarLaunchContext) => void,
): Promise<UnlistenFn> {
  return listen<AvatarLaunchContext>('avatar://launch-context-updated', (event) => {
    handler(event.payload);
  });
}

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
