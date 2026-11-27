import {
  hasElectronRuntime,
  type NimiShellRuntimeBridgeResult,
} from '../bridge/shell-api.js';

export function installNimiShellRuntimeBridge(): NimiShellRuntimeBridgeResult {
  if (hasElectronRuntime()) {
    return { installed: true, host: 'electron', reason: 'electron-preload-present' };
  }
  return { installed: false, reason: 'standard-host-preload-required' };
}
