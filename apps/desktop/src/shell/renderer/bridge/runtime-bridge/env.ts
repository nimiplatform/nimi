import { hasTauriRuntime } from '@nimiplatform/kit/shell/renderer/bridge';

export const nativeFetch =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;

export function hasTauriInvoke() {
  return hasTauriRuntime();
}
