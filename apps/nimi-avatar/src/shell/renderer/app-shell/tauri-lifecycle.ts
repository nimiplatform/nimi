import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
