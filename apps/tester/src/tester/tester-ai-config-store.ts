import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { toNimiRuntimeProtoStruct } from '@nimiplatform/sdk/runtime';

import { appId } from '../shell/auth/app-identity.js';

type TesterAIConfigClient = {
  get(): Promise<NimiCapabilityAIConfig | null>;
  overwrite(
    capabilities: readonly NimiCapabilityAIConfigIntent[],
  ): Promise<NimiCapabilityAIConfig>;
};

export type TesterAIConfigProjection = NimiCapabilityAIConfig | null;

export async function loadTesterAIConfig(
  client: Pick<TesterAIConfigClient, 'get'>,
): Promise<TesterAIConfigProjection> {
  try {
    const config = await client.get();
    return config ? requireTesterAIConfigOwner(config) : null;
  } catch (error) {
    if (isAIConfigNotFound(error)) return null;
    throw error;
  }
}

export async function overwriteTesterCapabilityIntent(
  client: Pick<TesterAIConfigClient, 'overwrite'>,
  current: TesterAIConfigProjection,
  intent: NimiCapabilityAIConfigIntent,
): Promise<NimiCapabilityAIConfig> {
  const capabilities = replaceCapabilityIntent(current?.capabilities ?? [], intent);
  return requireTesterAIConfigOwner(await client.overwrite(capabilities));
}

export async function removeTesterCapabilityIntent(
  client: Pick<TesterAIConfigClient, 'overwrite'>,
  current: TesterAIConfigProjection,
  capabilityContract: string,
): Promise<NimiCapabilityAIConfig> {
  const capabilities = (current?.capabilities ?? []).filter(
    (intent) => intent.capabilityContract !== capabilityContract,
  );
  return requireTesterAIConfigOwner(await client.overwrite(capabilities));
}

export function createTesterLocalCapabilityIntent(
  capabilityContract: string,
  current?: NimiCapabilityAIConfigIntent | null,
): NimiCapabilityAIConfigIntent {
  const normalized = capabilityContract.trim();
  if (!normalized || normalized !== capabilityContract) {
    throw new Error('Tester capability contract must be exact.');
  }
  return {
    capabilityContract: normalized,
    requiredFeatures: [...(current?.requiredFeatures ?? [])],
    ...(current?.defaults ? { defaults: current.defaults } : {}),
    route: { oneofKind: 'local', local: {} },
  };
}

export type TesterCloudCapabilityIntentInput = {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
  readonly provider: string;
  readonly providerModelId: string;
  readonly remoteModelCatalogId: string;
  readonly connectorGrantId: string;
};

export function createTesterCloudCapabilityIntent(
  capabilityContract: string,
  current: NimiCapabilityAIConfigIntent | null | undefined,
  input: TesterCloudCapabilityIntentInput,
): NimiCapabilityAIConfigIntent {
  const contract = requireExactText(capabilityContract, 'Tester capability contract');
  const implementationId = requireExactText(input.implementationId, 'Cloud implementation id');
  const driverId = requireExactText(input.driverId, 'Cloud driver id');
  const driverDialect = requireExactText(input.driverDialect, 'Cloud driver dialect');
  const provider = requireExactText(input.provider, 'Cloud provider');
  const providerModelId = requireExactText(input.providerModelId, 'Cloud provider model id');
  const remoteModelCatalogId = requireExactText(
    input.remoteModelCatalogId,
    'Cloud remote model catalog id',
  );
  const connectorGrantId = requireExactText(input.connectorGrantId, 'Cloud connector grant id');
  return {
    capabilityContract: contract,
    requiredFeatures: [...(current?.requiredFeatures ?? [])],
    ...(current?.defaults ? { defaults: current.defaults } : {}),
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: { implementationId, driverId, driverDialect },
        providerModelTarget: toNimiRuntimeProtoStruct({
          provider,
          providerModelId,
          remoteModelCatalogId,
        }),
        connectorGrantId,
      },
    },
  };
}

export function findTesterCapabilityIntent(
  config: TesterAIConfigProjection,
  capabilityContract: string,
): NimiCapabilityAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === capabilityContract,
  ) ?? null;
}

export function requireTesterAIConfigOwner(
  config: NimiCapabilityAIConfig,
): NimiCapabilityAIConfig {
  const owner = config.owner?.owner;
  if (!owner || owner.oneofKind !== 'app' || !('app' in owner) || owner.app.appId !== appId) {
    throw new Error('Tester AIConfig owner must be the exact nimi.tester App.');
  }
  return config;
}

function requireExactText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new Error(`${field} must be exact non-empty text.`);
  }
  return value;
}

function replaceCapabilityIntent(
  current: readonly NimiCapabilityAIConfigIntent[],
  next: NimiCapabilityAIConfigIntent,
): NimiCapabilityAIConfigIntent[] {
  const retained = current.filter(
    (intent) => intent.capabilityContract !== next.capabilityContract,
  );
  return [...retained, next];
}

function isAIConfigNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const reason = typeof record.reasonCode === 'string'
    ? record.reasonCode
    : typeof record.code === 'string'
      ? record.code
      : '';
  return reason.trim().toUpperCase().replaceAll('-', '_') === 'AI_CONFIG_NOT_FOUND';
}
