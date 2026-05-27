import {
  acquireManagedConnectorCredential,
  type ConnectorAuthAcquisitionPendingState,
  type ManagedConnectorCredentialAcquisitionResult,
  type PersistManagedConnectorCredentialInput,
  type PersistManagedConnectorCredentialResult,
} from '@nimiplatform/sdk/runtime';
import { desktopBridge, logRendererEvent } from '@renderer/bridge';

export type CodexOAuthPendingState = ConnectorAuthAcquisitionPendingState;

type AcquireCodexManagedCredentialOptions = {
  profileId: string;
  onPending?: (state: CodexOAuthPendingState) => void;
  persistCredential(input: PersistManagedConnectorCredentialInput): Promise<PersistManagedConnectorCredentialResult>;
};

function logCodexOAuth(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details: Record<string, unknown>,
): void {
  logRendererEvent({
    level,
    area: 'runtime-config.connector-auth-acquisition',
    message: `action:${message}`,
    details,
  });
}

export async function acquireCodexManagedCredential(
  options: AcquireCodexManagedCredentialOptions,
): Promise<ManagedConnectorCredentialAcquisitionResult> {
  return acquireManagedConnectorCredential({
    profileId: options.profileId,
    onPending: options.onPending,
    persistCredential: options.persistCredential,
    host: {
      proxyHttp: desktopBridge.proxyHttp,
      openExternalUrl: desktopBridge.openExternalUrl,
      oauthTokenExchange: (input) => desktopBridge.oauthTokenExchange({
        provider: input.provider as Parameters<typeof desktopBridge.oauthTokenExchange>[0]['provider'],
        clientId: input.clientId,
        code: input.code,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
      }),
      sleep: (ms) => new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, ms);
      }),
      now: () => Date.now(),
      log: logCodexOAuth,
    },
  });
}
