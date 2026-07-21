import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionPendingState,
  type NimiManagedConnectorCredentialRuntime,
  type NimiManagedConnectorCredentialAcquisitionResult,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { desktopBridge, logRendererEvent } from '../../bridge';

export type CodexOAuthPendingState = NimiConnectorAuthAcquisitionPendingState;

type AcquireCodexManagedCredentialOptions = {
  profileId: string;
  runtime: NimiManagedConnectorCredentialRuntime;
  connectorId: string;
  provider?: string;
  endpoint?: string;
  label?: string;
  onPending?: (state: CodexOAuthPendingState) => void;
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
    runtime: options.runtime,
    connectorId: options.connectorId,
    provider: options.provider,
    endpoint: options.endpoint,
    label: options.label,
    onPending: options.onPending,
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
