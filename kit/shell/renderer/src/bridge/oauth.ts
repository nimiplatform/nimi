import { hasElectronInvoke, hasShellHostInvoke } from './env.js';
import { invoke, invokeChecked } from './invoke.js';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  parseOauthListenForCodeResult,
  type ShellOAuthCodeBridge,
  type OauthListenForCodePayload,
  type OauthListenForCodeResult,
} from '@nimiplatform/kit/core/oauth';
import { focusMainWindow, openExternalUrl } from './ui.js';

export async function oauthListenForCode(
  payload: OauthListenForCodePayload,
  signal?: AbortSignal,
): Promise<OauthListenForCodeResult> {
  signal?.throwIfAborted();
  const command = NIMI_STANDARD_SHELL_COMMANDS['oauth.listenForCode'];
  const requestId = signal && hasElectronInvoke() ? crypto.randomUUID() : undefined;
  const result = invokeChecked(command, {
    payload: {
      redirectUri: payload.redirectUri,
      expectedState: payload.expectedState,
      timeoutMs: payload.timeoutMs,
      ...(requestId ? { requestId } : {}),
    },
  }, parseOauthListenForCodeResult);
  if (!signal || !requestId) return result;
  const cancel = () => { void invoke(command, { payload: { requestId, cancel: true } }).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export function createStandardShellOAuthCodeBridge(): ShellOAuthCodeBridge {
  return {
    hasShellHostInvoke,
    oauthListenForCode,
    openExternalUrl: async (url: string) => openExternalUrl(url),
    focusMainWindow,
  };
}
