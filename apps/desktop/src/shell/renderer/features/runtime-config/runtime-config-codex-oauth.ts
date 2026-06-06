import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionPendingState,
  type NimiManagedConnectorCredentialAcquisitionResult,
  type NimiPersistManagedConnectorCredentialInput,
  type NimiPersistManagedConnectorCredentialResult,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { desktopBridge, logRendererEvent } from '@renderer/bridge';

export type CodexOAuthPendingState = NimiConnectorAuthAcquisitionPendingState;

type AcquireCodexManagedCredentialOptions = {
  profileId: string;
  onPending?: (state: CodexOAuthPendingState) => void;
  persistCredential(input: NimiPersistManagedConnectorCredentialInput): Promise<NimiPersistManagedConnectorCredentialResult>;
};

function logCodexOAuth(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  details: JsonObject,
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
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  return acquireNimiManagedConnectorCredential({
    profileId: options.profileId,
    onPending: options.onPending,
    persistCredential: options.persistCredential,
    host: {
      proxyHttp: (request) => desktopBridge.proxyHttp({
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        connectorAuthProfileId: request.profileId,
        connectorAuthPurpose: request.purpose,
      }),
      openExternalUrl: desktopBridge.openExternalUrl,
      oauthTokenExchange: async (input) => {
        const result = await desktopBridge.oauthTokenExchange({
          provider: input.provider as Parameters<typeof desktopBridge.oauthTokenExchange>[0]['provider'],
          clientId: input.clientId,
          code: input.code,
          codeVerifier: input.codeVerifier,
          redirectUri: input.redirectUri,
        });
        return {
          ...result,
          raw: result.raw as JsonObject,
        };
      },
      sleep: (ms) => new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, ms);
      }),
      now: () => Date.now(),
      log: logCodexOAuth,
    },
  });
}
