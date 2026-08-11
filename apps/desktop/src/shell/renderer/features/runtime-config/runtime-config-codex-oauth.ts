import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionPendingState,
  type NimiManagedConnectorCredentialAcquisitionHost,
  type NimiManagedConnectorCredentialAcquisitionResult,
} from '@nimiplatform/sdk/runtime';
import type { ApiConnector } from './runtime-config-state-types.js';

export type CodexOAuthPendingState = NimiConnectorAuthAcquisitionPendingState;

export type CodexOAuthConnectorOperationSnapshot = Readonly<{
  generation: number;
  connector: ApiConnector;
  fingerprint: string;
}>;

function canonicalizeConnectorSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeConnectorSnapshotValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeConnectorSnapshotValue(entry)]),
    );
  }
  return value;
}

function connectorSnapshotFingerprint(connector: ApiConnector): string {
  return JSON.stringify(canonicalizeConnectorSnapshotValue(connector));
}

export function createCodexOAuthConnectorOperationSnapshot(
  generation: number,
  connector: ApiConnector,
): CodexOAuthConnectorOperationSnapshot {
  const fingerprint = connectorSnapshotFingerprint(connector);
  return Object.freeze({
    generation,
    connector: JSON.parse(fingerprint) as ApiConnector,
    fingerprint,
  });
}

export function isCodexOAuthConnectorOperationCurrent(
  operation: CodexOAuthConnectorOperationSnapshot,
  generation: number,
  connector: ApiConnector | null | undefined,
): boolean {
  return operation.generation === generation
    && Boolean(connector)
    && connectorSnapshotFingerprint(connector as ApiConnector) === operation.fingerprint;
}

type AcquireCodexManagedCredentialOptions = {
  profileId: string;
  connectorId?: string;
  provider?: string;
  endpoint?: string;
  label?: string;
  onPending?: (state: CodexOAuthPendingState) => void;
  signal?: AbortSignal;
};

export async function acquireCodexManagedCredential(
  options: AcquireCodexManagedCredentialOptions,
  host: NimiManagedConnectorCredentialAcquisitionHost,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  return acquireNimiManagedConnectorCredential({
    profileId: options.profileId,
    connectorId: options.connectorId,
    provider: options.provider,
    endpoint: options.endpoint,
    label: options.label,
    onPending: options.onPending,
    signal: options.signal,
    host,
  });
}
