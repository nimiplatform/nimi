import { hasTauriRuntime } from './tauri-api.js';

export function hasTauriInvoke(): boolean {
  return hasTauriRuntime();
}
