import {
  acquireNimiManagedConnectorCredential,
  type NimiConnectorAuthAcquisitionPendingState,
  type NimiManagedConnectorCredentialAcquisitionHost,
  type NimiManagedConnectorCredentialAcquisitionResult,
} from '@nimiplatform/sdk/runtime';
import type { ApiConnector } from './runtime-config-state-types.js';

export type ManagedOAuthPendingState = NimiConnectorAuthAcquisitionPendingState;

export type ManagedOAuthConnectorOperationSnapshot = Readonly<{
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

export function createManagedOAuthConnectorOperationSnapshot(
  generation: number,
  connector: ApiConnector,
): ManagedOAuthConnectorOperationSnapshot {
  const fingerprint = connectorSnapshotFingerprint(connector);
  return Object.freeze({
    generation,
    connector: JSON.parse(fingerprint) as ApiConnector,
    fingerprint,
  });
}

export function isManagedOAuthConnectorOperationCurrent(
  operation: ManagedOAuthConnectorOperationSnapshot,
  generation: number,
  connector: ApiConnector | null | undefined,
): boolean {
  return operation.generation === generation
    && Boolean(connector)
    && connectorSnapshotFingerprint(connector as ApiConnector) === operation.fingerprint;
}

type AcquireManagedConnectorCredentialOptions = {
  profileId: string;
  connectorId?: string;
  label?: string;
  onPending?: (state: ManagedOAuthPendingState) => void;
  signal?: AbortSignal;
};

export async function acquireManagedConnectorCredential(
  options: AcquireManagedConnectorCredentialOptions,
  host: NimiManagedConnectorCredentialAcquisitionHost,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  return acquireNimiManagedConnectorCredential({
    profileId: options.profileId,
    connectorId: options.connectorId,
    label: options.label,
    onPending: options.onPending,
    signal: options.signal,
    host,
  });
}
