import { invoke as invokeTauriCommand } from '@tauri-apps/api/core';
import { isTauriRuntime } from './tauri-lifecycle.js';

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
  return isTauriRuntime() || Boolean(getAvatarElectronHost());
}

export async function invokeAvatarHostCommand<T>(
  command: string,
  payload?: unknown,
  options: { fallback?: T } = {},
): Promise<T> {
  if (isTauriRuntime()) {
    return invokeTauriCommand<T>(command, payload as Record<string, unknown> | undefined);
  }
  const electronHost = getAvatarElectronHost();
  if (electronHost) {
    return electronHost.invoke<T>(command, payload);
  }
  if ('fallback' in options) {
    return options.fallback as T;
  }
  throw new Error(`Avatar host command unavailable: ${command}`);
}
