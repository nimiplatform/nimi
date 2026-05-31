import { createNimiClientId } from '../core/ids.js';
import {
  RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT,
  normalizeRuntimeConfigEndpoint,
  normalizeRuntimeConfigStringList,
  type RuntimeConfigProviderStatus,
} from './runtime-config-local-projection.js';
import type {
  RuntimeConnectorAuthMode,
  RuntimeConnectorProjection,
  RuntimeConnectorScope,
} from './connector-inventory.js';

export const RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT = RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT;

export type RuntimeConfigConnectorProjection = RuntimeConnectorProjection & {
  status: RuntimeConfigProviderStatus;
  lastCheckedAt: string | null;
  lastDetail: string;
  modelCapabilities?: Record<string, string[]>;
  isDraft?: boolean;
};

export type RuntimeConfigConnectorProjectionInput = {
  id?: unknown;
  label?: unknown;
  vendor?: unknown;
  provider?: unknown;
  authMode?: unknown;
  providerAuthProfile?: unknown;
  endpoint?: unknown;
  scope?: unknown;
  hasCredential?: unknown;
  isSystemOwned?: unknown;
  models?: unknown;
  modelCapabilities?: unknown;
  status?: unknown;
  lastCheckedAt?: unknown;
  lastDetail?: unknown;
  isDraft?: unknown;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function runtimeConfigConnectorVendorLabel(vendor: string): string {
  const normalized = String(vendor || '').trim();
  if (!normalized) {
    return 'Custom';
  }
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
}

export function normalizeRuntimeConfigConnectorVendor(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || 'custom';
}

export function normalizeRuntimeConfigConnectorAuthMode(value: unknown): RuntimeConnectorAuthMode {
  return value === 'oauth_managed' ? 'oauth_managed' : 'api_key';
}

export function normalizeRuntimeConfigConnectorScope(value: unknown): RuntimeConnectorScope {
  if (value === 'machine-global' || value === 'runtime-system') {
    return value;
  }
  return 'user';
}

export function normalizeRuntimeConfigConnectorStatus(value: unknown): RuntimeConfigProviderStatus {
  if (value === 'healthy' || value === 'unreachable' || value === 'unsupported' || value === 'degraded') {
    return value;
  }
  return 'idle';
}

export function normalizeRuntimeConfigConnectorModels(rawModels: unknown): string[] {
  return normalizeRuntimeConfigStringList(Array.isArray(rawModels) ? rawModels : []);
}

export function normalizeRuntimeConfigConnectorModelCapabilities(
  value: unknown,
): Record<string, string[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const normalized: Record<string, string[]> = {};
  for (const [modelId, rawCapabilities] of Object.entries(value)) {
    const normalizedModelId = normalizeText(modelId);
    const capabilities = normalizeRuntimeConfigStringList(
      Array.isArray(rawCapabilities) ? rawCapabilities : [],
    );
    if (normalizedModelId && capabilities.length > 0) {
      normalized[normalizedModelId] = capabilities;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function createRuntimeConfigConnectorDraft(input: {
  vendor?: unknown;
  label?: unknown;
  id?: unknown;
} = {}): RuntimeConfigConnectorProjection {
  const vendor = normalizeRuntimeConfigConnectorVendor(input.vendor);
  return {
    id: normalizeText(input.id) || createNimiClientId('connector'),
    label: normalizeText(input.label) || `${runtimeConfigConnectorVendorLabel(vendor)} Connector`,
    vendor,
    provider: '',
    authMode: 'api_key',
    providerAuthProfile: undefined,
    endpoint: RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT,
    scope: 'user',
    hasCredential: false,
    isSystemOwned: false,
    models: [],
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  };
}

export function normalizeRuntimeConfigConnectorProjection(
  raw: RuntimeConfigConnectorProjectionInput,
): RuntimeConfigConnectorProjection {
  const vendor = normalizeRuntimeConfigConnectorVendor(raw.vendor);
  const scope = normalizeRuntimeConfigConnectorScope(raw.scope);
  return {
    id: normalizeText(raw.id) || createNimiClientId('connector'),
    label: normalizeText(raw.label) || `${runtimeConfigConnectorVendorLabel(vendor)} Connector`,
    vendor,
    provider: normalizeText(raw.provider),
    authMode: normalizeRuntimeConfigConnectorAuthMode(raw.authMode),
    providerAuthProfile: normalizeText(raw.providerAuthProfile) || undefined,
    endpoint: normalizeRuntimeConfigEndpoint(raw.endpoint, RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT),
    scope,
    hasCredential: Boolean(raw.hasCredential),
    isSystemOwned: scope !== 'user' || Boolean(raw.isSystemOwned),
    models: normalizeRuntimeConfigConnectorModels(raw.models),
    modelCapabilities: normalizeRuntimeConfigConnectorModelCapabilities(raw.modelCapabilities),
    status: normalizeRuntimeConfigConnectorStatus(raw.status),
    lastCheckedAt: normalizeText(raw.lastCheckedAt) || null,
    lastDetail: normalizeText(raw.lastDetail),
    isDraft: raw.isDraft === true ? true : undefined,
  };
}

export function runtimeConnectorProjectionToRuntimeConfigConnector(
  connector: RuntimeConnectorProjection,
): RuntimeConfigConnectorProjection {
  return normalizeRuntimeConfigConnectorProjection({
    ...connector,
    status: 'idle',
    lastCheckedAt: null,
    lastDetail: '',
  });
}
