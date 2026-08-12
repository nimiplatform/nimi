import type { NimiPortableAppAIConfig } from '../ai/capability-configuration.js';
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

export type NimiLocalAppAIConfigIntentInput = {
  readonly capabilityContract: unknown;
  readonly requiredFeatures: unknown;
  readonly defaults?: unknown;
  readonly route: unknown;
};

export type NimiLocalAppAIConfigShell = {
  readonly get: () => Promise<unknown>;
};

export type NimiLocalAppAIConfigClient = {
  readonly get: () => Promise<NimiPortableAppAIConfig>;
};

/**
 * Owner-free App AIConfig projection for a protected Local App session. The
 * host and Runtime fix the exact App owner from the authenticated process
 * binding. The protected App receives no mutation or route-selection method.
 */
export function createNimiLocalAppAIConfigClient(
  shell: NimiLocalAppAIConfigShell,
): NimiLocalAppAIConfigClient {
  return Object.freeze({
    get: async () => projectAppAIConfig(await shell.get()),
  });
}

/** Shared intent validator reused by the separately authorized agent.configure surface. */
export function validateCapabilityIntents(
  capabilities: readonly NimiLocalAppAIConfigIntentInput[],
): void {
  if (!Array.isArray(capabilities)) {
    invalidIntent('capabilities');
  }
  assertNoAuthorityMaterial(capabilities);
  capabilities.forEach((intent, index) => {
    assertExactKeys(intent, ['capabilityContract', 'requiredFeatures', 'defaults', 'route'], `AIConfig capability ${index}`);
    requireText(intent.capabilityContract, `ai_config_capability_${index}`);
    if (!Array.isArray(intent.requiredFeatures)
      || intent.requiredFeatures.some((feature) => typeof feature !== 'string' || !feature.trim() || feature.trim() !== feature)) {
      invalidIntent(`capability ${index} requiredFeatures`);
    }
    if (intent.defaults !== undefined && !isRuntimeStruct(intent.defaults)) invalidIntent(`capability ${index} defaults`);
    const route = asRecord(intent.route);
    if (!route || (route.oneofKind !== 'local' && route.oneofKind !== 'cloud')) invalidIntent(`capability ${index} route`);
    if (route.oneofKind === 'local') {
      assertExactKeys(route, ['oneofKind', 'local'], `AIConfig capability ${index} route`);
      const local = asRecord(route.local);
      if (!local || Object.keys(local).length !== 0) invalidIntent(`capability ${index} local route`);
      return;
    }
    assertExactKeys(route, ['oneofKind', 'cloud'], `AIConfig capability ${index} route`);
    const cloud = asRecord(route.cloud);
    assertExactKeys(cloud, ['implementation', 'providerModelTarget'], `AIConfig capability ${index} cloud route`);
    const implementation = asRecord(cloud.implementation);
    assertExactKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `AIConfig capability ${index} implementation`);
    requireText(implementation.implementationId, `ai_config_implementation_${index}`);
    requireText(implementation.driverId, `ai_config_driver_${index}`);
    requireText(implementation.driverDialect, `ai_config_driver_dialect_${index}`);
    if (cloud.providerModelTarget !== undefined && !isRuntimeStruct(cloud.providerModelTarget)) {
      invalidIntent(`capability ${index} providerModelTarget`);
    }
  });
}

function isRuntimeStruct(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'fields')) return false;
  const fields = record.fields;
  return Boolean(fields && typeof fields === 'object' && !Array.isArray(fields));
}

function invalidIntent(field: string): never {
  return localAppError(
    `AIConfig ${field} is invalid.`,
    'SDK_LOCAL_APP_INPUT_INVALID',
    'provide_canonical_ai_config_capabilities',
  );
}

function projectAppAIConfig(value: unknown): NimiPortableAppAIConfig {
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
  return config as unknown as NimiPortableAppAIConfig;
}
