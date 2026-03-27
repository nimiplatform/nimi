import { hasTauriRuntime } from './tauri-api.js';

export function hasTauriInvoke() {
  return hasTauriRuntime();
}
