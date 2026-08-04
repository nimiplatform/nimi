import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '@nimiplatform/sdk/ai';

import { appId } from '../shell/auth/app-identity.js';

type TesterAIConfigClient = {
  get(): Promise<NimiCapabilityAIConfig>;
  overwrite(
    capabilities: readonly NimiCapabilityAIConfigIntent[],
  ): Promise<NimiCapabilityAIConfig>;
};

export type TesterAIConfigProjection = NimiCapabilityAIConfig | null;

export async function loadTesterAIConfig(
  client: Pick<TesterAIConfigClient, 'get'>,
): Promise<TesterAIConfigProjection> {
  try {
    return requireTesterAIConfigOwner(await client.get());
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
