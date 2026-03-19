// RL-BOOT-005 — Electron OAuth Bridge
// Implements TauriOAuthBridge interface using Electron preload bridge

import type { TauriOAuthBridge } from '@nimiplatform/shell-core/oauth';
import { getBridge } from '../../bridge/electron-bridge.js';

export function createElectronOAuthBridge(): TauriOAuthBridge {
  const bridge = getBridge();
  return {
    hasTauriInvoke: () => true,
    oauthListenForCode: (payload) => bridge.oauth.listenForCode(payload),
    oauthTokenExchange: (payload) =>
      bridge.oauth.tokenExchange(payload) as ReturnType<TauriOAuthBridge['oauthTokenExchange']>,
    openExternalUrl: async (url) => bridge.oauth.openExternalUrl(url),
    focusMainWindow: () => bridge.oauth.focusMainWindow(),
  };
}
