import type {
  NimiAIConfigSnapshot,
  NimiCapabilityAIConfigIntent,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';

import {
  requireStudioAIConfigOwner,
  subscribeStudioAIConfigRefresh,
  type StudioAIConfigRefreshEventTarget,
  type StudioAIConfigVisibilityTarget,
} from '../ai-studio-core/ai-config.js';
import { appId } from '../shell/auth/app-identity.js';

export type LabAIConfigProjection = NimiAIConfigSnapshot;

export async function loadLabAIConfig(
  client: { readonly get: () => Promise<NimiAIConfigSnapshot> },
): Promise<LabAIConfigProjection> {
  const snapshot = await client.get();
  if (snapshot.config) requireStudioAIConfigOwner(snapshot.config, appId);
  return snapshot;
}

/** Refreshes the canonical owner projection after another admitted surface writes. */
export function subscribeLabAIConfigOwnerRefresh(
  refresh: () => void,
  focusTarget: StudioAIConfigRefreshEventTarget,
  visibilityTarget: StudioAIConfigVisibilityTarget,
): () => void {
  return subscribeStudioAIConfigRefresh(refresh, focusTarget, visibilityTarget);
}

/** Clones the immutable SDK projection into Kit's editor shape. */
export function projectLabAIConfigCapabilities(
  capabilities: readonly NimiPortableAppAIConfigIntent[],
): NimiCapabilityAIConfigIntent[] {
  return capabilities.map((intent) => {
    const route = intent.route;
    if (route.oneofKind === 'local' && 'local' in route) {
      return {
        capabilityContract: intent.capabilityContract,
        requiredFeatures: [...intent.requiredFeatures],
        ...(intent.defaults ? { defaults: intent.defaults } : {}),
        route: { oneofKind: 'local', local: { loadoutRef: route.local.loadoutRef } },
      };
    }
    if (route.oneofKind === 'cloud' && 'cloud' in route) {
      return {
        capabilityContract: intent.capabilityContract,
        requiredFeatures: [...intent.requiredFeatures],
        ...(intent.defaults ? { defaults: intent.defaults } : {}),
        route: { oneofKind: 'cloud', cloud: { ...route.cloud } },
      };
    }
    throw new Error(`AIConfig route is missing for ${intent.capabilityContract}.`);
  });
}

export function requireLabAIConfigOwner(
  config: NimiPortableAppAIConfig,
): NimiPortableAppAIConfig {
  return requireStudioAIConfigOwner(config, appId);
}
