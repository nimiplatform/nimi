// Typed wrapper for window.nimiRelay bridge API
// RL-IPC-004, RL-IPC-005

import type { NimiRelayBridge } from '../../shared/ipc-contract.js';

export type { NimiRelayBridge } from '../../shared/ipc-contract.js';

declare global {
  interface Window {
    nimiRelay: NimiRelayBridge;
  }
}

export function getBridge(): NimiRelayBridge {
  if (!window.nimiRelay) {
    throw new Error(
      'nimiRelay bridge not available. Are you running outside Electron?',
    );
  }
  return window.nimiRelay;
}
