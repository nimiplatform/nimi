import { CONNECTOR_AUTH_ACQUISITION_PROFILES } from './connector-auth-acquisition-profiles.generated.js';

// The browser authorization is pending; the URL lets the user reopen the same
// sign-in page and carries no credential.
export type NimiConnectorAuthAcquisitionPendingState = {
  authorizationUrl: string;
  expiresInSeconds: number;
};

// connectorId selects explicit reauthorization of that Connector's existing
// registration; without it a new account registration is created.
export type NimiManagedConnectorCredentialAcquisitionRequest = {
  profileId: string;
  connectorId?: string;
  label?: string;
};

export type NimiManagedConnectorCredentialAcquisitionResult = {
  profileId: string;
  providerAuthProfile: string;
  connectorId: string;
  accountLabel?: string;
};

export type NimiManagedConnectorCredentialAcquisitionHostInput =
  NimiManagedConnectorCredentialAcquisitionRequest & {
    onPending?: (state: NimiConnectorAuthAcquisitionPendingState) => void;
    signal?: AbortSignal;
  };

export type NimiManagedConnectorCredentialAcquisitionHost = {
  acquireManagedConnectorCredential(
    input: NimiManagedConnectorCredentialAcquisitionHostInput,
  ): Promise<unknown>;
};

export type NimiAcquireManagedConnectorCredentialOptions =
  NimiManagedConnectorCredentialAcquisitionHostInput & {
    host: NimiManagedConnectorCredentialAcquisitionHost;
  };

// Reports whether a managed OAuth auth profile uses Nimi's browser sign-in.
// The profile table carries only public acquisition metadata.
export function isNimiBrowserManagedConnectorProfile(providerAuthProfile: string | undefined): boolean {
  const normalized = String(providerAuthProfile || '').trim().toLowerCase();
  return Boolean(normalized) && Object.hasOwn(CONNECTOR_AUTH_ACQUISITION_PROFILES, normalized);
}

export async function acquireNimiManagedConnectorCredential(
  options: NimiAcquireManagedConnectorCredentialOptions,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  exactRecord(
    options,
    new Set(['profileId', 'connectorId', 'label', 'onPending', 'signal', 'host']),
    'managed connector credential acquisition options',
  );
  if (!options.host || typeof options.host.acquireManagedConnectorCredential !== 'function') {
    throw new Error('managed connector credential acquisition host is required');
  }
  if (options.onPending !== undefined && typeof options.onPending !== 'function') {
    throw new Error('onPending must be a function');
  }
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new Error('signal must be an AbortSignal');
  }
  if (options.signal?.aborted) throw options.signal.reason;
  const request: Record<string, unknown> = {
    profileId: requiredText(options.profileId, 'profileId'),
  };
  copyOptionalText(request, 'connectorId', options.connectorId);
  copyOptionalText(request, 'label', options.label);
  if (options.onPending) {
    request.onPending = (value: unknown) => options.onPending?.(parsePendingState(value));
  }
  if (options.signal) request.signal = options.signal;
  return parseAcquisitionResult(await options.host.acquireManagedConnectorCredential(
    request as NimiManagedConnectorCredentialAcquisitionHostInput,
  ));
}

export function parseNimiConnectorAuthAcquisitionPendingState(
  value: unknown,
): NimiConnectorAuthAcquisitionPendingState {
  return parsePendingState(value);
}

export function parseNimiManagedConnectorCredentialAcquisitionResult(
  value: unknown,
): NimiManagedConnectorCredentialAcquisitionResult {
  return parseAcquisitionResult(value);
}

function parsePendingState(value: unknown): NimiConnectorAuthAcquisitionPendingState {
  const record = exactRecord(
    value,
    new Set(['authorizationUrl', 'expiresInSeconds']),
    'managed connector credential pending state',
  );
  const authorizationUrl = requiredText(record.authorizationUrl, 'authorizationUrl');
  if (!authorizationUrl.startsWith('https://')) {
    throw new Error('authorizationUrl must be an https URL');
  }
  return {
    authorizationUrl,
    expiresInSeconds: positiveInteger(record.expiresInSeconds, 'expiresInSeconds'),
  };
}

function parseAcquisitionResult(value: unknown): NimiManagedConnectorCredentialAcquisitionResult {
  const record = exactRecord(
    value,
    new Set(['profileId', 'providerAuthProfile', 'connectorId', 'accountLabel']),
    'managed connector credential acquisition result',
  );
  const result: NimiManagedConnectorCredentialAcquisitionResult = {
    profileId: requiredText(record.profileId, 'profileId'),
    providerAuthProfile: requiredText(record.providerAuthProfile, 'providerAuthProfile'),
    connectorId: requiredText(record.connectorId, 'connectorId'),
  };
  const accountLabel = optionalText(record.accountLabel, 'accountLabel');
  if (accountLabel) result.accountLabel = accountLabel;
  return result;
}

function exactRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label} contains unexpected field ${key}`);
    }
  }
  return record;
}

function requiredText(value: unknown, field: string): string {
  const normalized = optionalText(value, field);
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function optionalText(value: unknown, field: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new Error(`${field} must be a normalized string`);
  }
  return value;
}

function copyOptionalText(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) return;
  target[key] = optionalText(value, key);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}
