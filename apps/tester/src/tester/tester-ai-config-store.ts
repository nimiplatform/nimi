import type {
  NimiCapabilityAIConfigIntent,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';

import { appId } from '../shell/auth/app-identity.js';

type TesterAIConfigClient = {
  get(): Promise<NimiPortableAppAIConfig | null>;
  overwrite(
    capabilities: readonly NimiPortableAppAIConfigIntent[],
  ): Promise<NimiPortableAppAIConfig>;
};

export type TesterAIConfigProjection = NimiPortableAppAIConfig | null;

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

export async function overwriteTesterAIConfig(
  client: Pick<TesterAIConfigClient, 'overwrite'>,
  capabilities: readonly NimiPortableAppAIConfigIntent[],
): Promise<NimiPortableAppAIConfig> {
  return requireTesterAIConfigOwner(await client.overwrite(capabilities));
}

/** Bridges the Local App readonly projection into Kit's controlled draft shape. */
export function toTesterModelConfigCapabilities(
  capabilities: readonly NimiPortableAppAIConfigIntent[],
): NimiCapabilityAIConfigIntent[] {
  return capabilities.map((intent) => ({
    capabilityContract: intent.capabilityContract,
    requiredFeatures: [...intent.requiredFeatures],
    defaults: intent.defaults,
    route: intent.route.oneofKind === 'local'
      ? { oneofKind: 'local', local: {} }
      : {
          oneofKind: 'cloud',
          cloud: { ...intent.route.cloud, connectorGrantId: '' },
        },
  }));
}

/** Fails closed before a Kit draft crosses the portable Third-party App boundary. */
export function toTesterPortableAIConfigCapabilities(
  capabilities: readonly NimiCapabilityAIConfigIntent[],
): NimiPortableAppAIConfigIntent[] {
  return capabilities.map((intent) => {
    const base = {
      capabilityContract: intent.capabilityContract,
      requiredFeatures: [...intent.requiredFeatures],
      ...(intent.defaults ? { defaults: intent.defaults } : {}),
    };
    if (intent.route.oneofKind === 'local') {
      return { ...base, route: { oneofKind: 'local', local: {} } };
    }
    if (intent.route.oneofKind !== 'cloud' || !('cloud' in intent.route)) {
      throw new Error('Tester Model Config produced an incomplete route intent.');
    }
    const cloud = intent.route.cloud;
    if (cloud.connectorGrantId) {
      throw new Error('Tester Model Config must not submit ConnectorGrant binding material.');
    }
    return {
      ...base,
      route: {
        oneofKind: 'cloud',
        cloud: {
          implementation: cloud.implementation,
          providerModelTarget: cloud.providerModelTarget,
        },
      },
    };
  });
}

export function findTesterCapabilityIntent(
  config: TesterAIConfigProjection,
  capabilityContract: string,
): NimiPortableAppAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === capabilityContract,
  ) ?? null;
}

export function requireTesterAIConfigOwner(
  config: NimiPortableAppAIConfig,
): NimiPortableAppAIConfig {
  const owner = config.owner?.owner;
  if (!owner || owner.oneofKind !== 'app' || !('app' in owner) || owner.app.appId !== appId) {
    throw new Error('Tester AIConfig owner must be the exact nimi.tester App.');
  }
  return config;
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
