import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '../ai/capability-configuration.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAIConfigShell = {
  readonly get: () => Promise<unknown>;
  readonly overwrite: (
    capabilities: readonly NimiCapabilityAIConfigIntent[],
  ) => Promise<unknown>;
};

export type NimiLocalAppAIConfigClient = {
  readonly get: () => Promise<NimiCapabilityAIConfig>;
  readonly overwrite: (
    capabilities: readonly NimiCapabilityAIConfigIntent[],
  ) => Promise<NimiCapabilityAIConfig>;
};

/**
 * Owner-free App AIConfig projection for a protected Local App session. The
 * host and Runtime fix the exact App owner from the authenticated process
 * binding; renderer callers submit capability intent only.
 */
export function createNimiLocalAppAIConfigClient(
  shell: NimiLocalAppAIConfigShell,
): NimiLocalAppAIConfigClient {
  return Object.freeze({
    get: async () => projectAppAIConfig(await shell.get()),
    overwrite: async (capabilities: readonly NimiCapabilityAIConfigIntent[]) => {
      validateCapabilityIntents(capabilities);
      return projectAppAIConfig(await shell.overwrite(capabilities));
    },
  });
}

function validateCapabilityIntents(
  capabilities: readonly NimiCapabilityAIConfigIntent[],
): void {
  if (!Array.isArray(capabilities)) {
    localAppError(
      'Local App AIConfig capabilities must be an array.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_canonical_app_ai_config_capabilities',
    );
  }
  assertNoAuthorityMaterial(capabilities);
  capabilities.forEach((intent, index) => {
    assertExactKeys(
      intent,
      ['capabilityContract', 'requiredFeatures', 'defaults', 'route'],
      `local App AIConfig capability ${index}`,
    );
    requireText(intent.capabilityContract, `ai_config_capability_${index}`);
    if (!Array.isArray(intent.requiredFeatures)
      || intent.requiredFeatures.some((feature) => typeof feature !== 'string'
        || !feature.trim()
        || feature.trim() !== feature)) {
      invalidIntent(`capability ${index} requiredFeatures`);
    }
    if (intent.defaults !== undefined && !asRecord(intent.defaults)) {
      invalidIntent(`capability ${index} defaults`);
    }
    const route = asRecord(intent.route);
    if (!route || (route.oneofKind !== 'local' && route.oneofKind !== 'cloud')) {
      invalidIntent(`capability ${index} route`);
    }
    if (route.oneofKind === 'local') {
      assertExactKeys(route, ['oneofKind', 'local'], `local App AIConfig capability ${index} route`);
      const local = asRecord(route.local);
      if (!local || Object.keys(local).length !== 0) invalidIntent(`capability ${index} local route`);
      return;
    }
    assertExactKeys(route, ['oneofKind', 'cloud'], `local App AIConfig capability ${index} route`);
    const cloud = asRecord(route.cloud);
    assertExactKeys(
      cloud,
      ['implementation', 'providerModelTarget', 'connectorGrantId'],
      `local App AIConfig capability ${index} cloud route`,
    );
    const implementation = asRecord(cloud.implementation);
    assertExactKeys(
      implementation,
      ['implementationId', 'driverId', 'driverDialect'],
      `local App AIConfig capability ${index} implementation`,
    );
    requireText(implementation.implementationId, `ai_config_implementation_${index}`);
    requireText(implementation.driverId, `ai_config_driver_${index}`);
    requireText(implementation.driverDialect, `ai_config_driver_dialect_${index}`);
    if (cloud.providerModelTarget !== undefined && !asRecord(cloud.providerModelTarget)) {
      invalidIntent(`capability ${index} providerModelTarget`);
    }
    if (typeof cloud.connectorGrantId !== 'string'
      || cloud.connectorGrantId.trim() !== cloud.connectorGrantId) {
      invalidIntent(`capability ${index} connectorGrantId`);
    }
  });
}

function projectAppAIConfig(value: unknown): NimiCapabilityAIConfig {
  const config = asRecord(value);
  assertExactProjectionKeys(config, ['owner', 'capabilities'], 'App AIConfig');
  assertSafeProjection(config);
  const owner = asRecord(config.owner);
  assertExactProjectionKeys(owner, ['owner'], 'App AIConfig owner');
  const ownerVariant = asRecord(owner.owner);
  assertExactProjectionKeys(ownerVariant, ['oneofKind', 'app'], 'App AIConfig owner variant');
  if (ownerVariant.oneofKind !== 'app') localAppProjectionError('App AIConfig owner variant');
  const app = asRecord(ownerVariant.app);
  assertExactProjectionKeys(app, ['appId'], 'App AIConfig App owner');
  projectionText(app.appId, 'App AIConfig appId');
  if (!Array.isArray(config.capabilities)) localAppProjectionError('App AIConfig capabilities');
  return config as unknown as NimiCapabilityAIConfig;
}

function invalidIntent(field: string): never {
  return localAppError(
    `Local App AIConfig ${field} is invalid.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_canonical_app_ai_config_capabilities',
  );
}
