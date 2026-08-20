import type {
  NimiCapabilityAIConfigIntent,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { runtimeAIConfigStructToJson } from '@nimiplatform/sdk/ai';

import { appId } from '../shell/auth/app-identity.js';

type LabAIConfigClient = {
  get(): Promise<NimiPortableAppAIConfig | null>;
};

type LabAIConfigRefreshEventTarget = {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type LabAIConfigVisibilityTarget = LabAIConfigRefreshEventTarget & {
  readonly visibilityState: string;
};

export type LabAIConfigProjection = NimiPortableAppAIConfig | null;

export async function loadLabAIConfig(
  client: Pick<LabAIConfigClient, 'get'>,
): Promise<LabAIConfigProjection> {
  try {
    const config = await client.get();
    return config ? requireLabAIConfigOwner(config) : null;
  } catch (error) {
    if (isAIConfigNotFound(error)) return null;
    throw error;
  }
}

/** Refreshes the read-only projection after the Nimi-owned Desktop surface returns control. */
export function subscribeLabAIConfigOwnerRefresh(
  refresh: () => void,
  focusTarget: LabAIConfigRefreshEventTarget,
  visibilityTarget: LabAIConfigVisibilityTarget,
): () => void {
  const onFocus: EventListener = () => refresh();
  const onVisibilityChange: EventListener = () => {
    if (visibilityTarget.visibilityState === 'visible') refresh();
  };
  focusTarget.addEventListener('focus', onFocus);
  visibilityTarget.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    focusTarget.removeEventListener('focus', onFocus);
    visibilityTarget.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/** Clones the immutable SDK projection into Kit's read-only display shape. */
export function projectLabAIConfigCapabilities(
  capabilities: readonly NimiPortableAppAIConfigIntent[],
): NimiCapabilityAIConfigIntent[] {
  return capabilities.map((intent) => ({
    capabilityContract: intent.capabilityContract,
    requiredFeatures: [...intent.requiredFeatures],
    ...(intent.defaults ? { defaults: intent.defaults } : {}),
    route: intent.route.oneofKind === 'local'
      ? { oneofKind: 'local', local: {} }
      : {
          oneofKind: 'cloud',
          cloud: { ...intent.route.cloud },
        },
  }));
}

export function findLabCapabilityIntent(
  config: LabAIConfigProjection,
  capabilityContract: string,
): NimiPortableAppAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === capabilityContract,
  ) ?? null;
}

export function labCloudIntentHasExactTarget(
  intent: NimiPortableAppAIConfigIntent,
): boolean {
  if (intent.route.oneofKind !== 'cloud') return false;
  const target = runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget);
  const exactText = (value: unknown): boolean => (
    typeof value === 'string' && value.length > 0 && value.trim() === value
  );
  return !Object.hasOwn(target, 'model')
    && exactText(target.provider)
    && exactText(target.providerModelId)
    && exactText(target.remoteModelCatalogId);
}

export function requireLabAIConfigOwner(
  config: NimiPortableAppAIConfig,
): NimiPortableAppAIConfig {
  const owner = config.owner?.owner;
  if (!owner || owner.oneofKind !== 'app' || !('app' in owner) || owner.app.appId !== appId) {
    throw new Error('Lab AIConfig owner must be the exact nimi.lab App.');
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
