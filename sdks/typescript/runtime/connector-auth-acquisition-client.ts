export type NimiConnectorAuthAcquisitionPendingState = {
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
};

export type NimiManagedConnectorCredentialAcquisitionRequest = {
  profileId: string;
  connectorId?: string;
  provider?: string;
  endpoint?: string;
  label?: string;
};

export type NimiManagedConnectorCredentialAcquisitionResult = {
  profileId: string;
  providerAuthProfile: string;
  connectorId: string;
  expiresAt?: string;
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

export async function acquireNimiManagedConnectorCredential(
  options: NimiAcquireManagedConnectorCredentialOptions,
): Promise<NimiManagedConnectorCredentialAcquisitionResult> {
  exactRecord(
    options,
    new Set(['profileId', 'connectorId', 'provider', 'endpoint', 'label', 'onPending', 'signal', 'host']),
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
  copyOptionalText(request, 'provider', options.provider);
  copyOptionalText(request, 'endpoint', options.endpoint);
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
    new Set(['userCode', 'verificationUrl', 'expiresInSeconds', 'pollIntervalSeconds']),
    'managed connector credential pending state',
  );
  return {
    userCode: requiredText(record.userCode, 'userCode'),
    verificationUrl: requiredText(record.verificationUrl, 'verificationUrl'),
    expiresInSeconds: positiveInteger(record.expiresInSeconds, 'expiresInSeconds'),
    pollIntervalSeconds: positiveInteger(record.pollIntervalSeconds, 'pollIntervalSeconds'),
  };
}

function parseAcquisitionResult(value: unknown): NimiManagedConnectorCredentialAcquisitionResult {
  const record = exactRecord(
    value,
    new Set(['profileId', 'providerAuthProfile', 'connectorId', 'expiresAt']),
    'managed connector credential acquisition result',
  );
  const result: NimiManagedConnectorCredentialAcquisitionResult = {
    profileId: requiredText(record.profileId, 'profileId'),
    providerAuthProfile: requiredText(record.providerAuthProfile, 'providerAuthProfile'),
    connectorId: requiredText(record.connectorId, 'connectorId'),
  };
  const expiresAt = optionalText(record.expiresAt, 'expiresAt');
  if (expiresAt) result.expiresAt = expiresAt;
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
