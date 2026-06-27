import { hasElectronRuntime, hasNimiShellRuntime, hasTauriRuntime } from './tauri-api.js';

export function hasTauriInvoke() {
  return hasTauriRuntime();
}

export function hasElectronInvoke() {
  return hasElectronRuntime();
}

export function hasShellHostInvoke() {
  return hasNimiShellRuntime();
}
