import type { AIScopeRef, RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';
import type { CapabilityId } from './tester-types.js';

export const TESTER_AI_SCOPE_REF: AIScopeRef = {
  kind: 'app',
  ownerId: 'desktop',
  surfaceId: 'tester',
};

export function createEmptyTesterAIConfig(): AIConfig {
  return createEmptyAIConfig(TESTER_AI_SCOPE_REF);
}

export function bindingFromTesterConfig(config: AIConfig, capabilityId: CapabilityId): RuntimeRouteBinding | null {
  if (capabilityId === 'image.create-job') {
    return (config.capabilities.selectedBindings['image.generate'] || null) as RuntimeRouteBinding | null;
  }
  return (config.capabilities.selectedBindings[capabilityId] || null) as RuntimeRouteBinding | null;
}
