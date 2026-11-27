import { hasElectronRuntime, hasNimiShellRuntime } from './shell-api.js';

export function hasElectronInvoke() {
  return hasElectronRuntime();
}

export function hasShellHostInvoke() {
  return hasNimiShellRuntime();
}
