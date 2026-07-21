import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionHost,
  type NimiConnectorAuthAcquisitionPendingState,
  type NimiManagedConnectorCredentialRuntime,
  type NimiManagedConnectorCredentialAcquisitionResult,
} from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';

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
  host: NimiConnectorAuthAcquisitionHost,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  return acquireNimiManagedConnectorCredential({
    profileId: options.profileId,
    runtime: options.runtime,
    connectorId: options.connectorId,
    provider: options.provider,
    endpoint: options.endpoint,
    label: options.label,
    onPending: options.onPending,
    host: { ...host, log: logCodexOAuth },
  });
}
