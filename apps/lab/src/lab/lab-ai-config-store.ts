import type {
  NimiCapabilityAIConfigIntent,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';

import {
  loadStudioAIConfig,
  requireStudioAIConfigOwner,
  subscribeStudioAIConfigRefresh,
  type StudioAIConfigClient,
  type StudioAIConfigRefreshEventTarget,
  type StudioAIConfigVisibilityTarget,
} from '../ai-studio-core/ai-config.js';
import { appId } from '../shell/auth/app-identity.js';

export type LabAIConfigProjection = NimiPortableAppAIConfig | null;

export async function loadLabAIConfig(
  client: Pick<StudioAIConfigClient, 'get'>,
): Promise<LabAIConfigProjection> {
  return loadStudioAIConfig(client, appId);
}

/** Refreshes the read-only projection after the Nimi-owned Desktop surface returns control. */
export function subscribeLabAIConfigOwnerRefresh(
  refresh: () => void,
  focusTarget: StudioAIConfigRefreshEventTarget,
  visibilityTarget: StudioAIConfigVisibilityTarget,
): () => void {
  return subscribeStudioAIConfigRefresh(refresh, focusTarget, visibilityTarget);
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

export function requireLabAIConfigOwner(
  config: NimiPortableAppAIConfig,
): NimiPortableAppAIConfig {
  return requireStudioAIConfigOwner(config, appId);
}
