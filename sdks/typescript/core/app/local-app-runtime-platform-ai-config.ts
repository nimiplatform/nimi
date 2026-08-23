import type {
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
  NimiAIConfigOverwriteInput,
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
  NimiPortableAppAIConfig,
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

export type NimiLocalAppAIConfigIntentInput = {
  readonly capabilityContract: unknown;
  readonly requiredFeatures: unknown;
  readonly defaults?: unknown;
  readonly route: unknown;
};

export type NimiLocalAppAIConfigShell = {
  readonly get: () => Promise<unknown>;
  readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<unknown>;
  readonly listOptions: (query: NimiAIConfigOptionsQuery) => Promise<unknown>;
};

export type NimiLocalAppAIConfigClient = {
  readonly get: () => Promise<NimiAIConfigSnapshot>;
  readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<NimiAIConfigOverwriteResult>;
  readonly listOptions: (query: NimiAIConfigOptionsQuery) => Promise<NimiAIConfigOptionsResult>;
};

/**
 * Owner-free App AIConfig projection for a protected Local App session. The
 * host and Runtime fix the exact App owner from the authenticated process
 * binding. No owner or account selector enters this client.
 */
export function createNimiLocalAppAIConfigClient(
  shell: NimiLocalAppAIConfigShell,
): NimiLocalAppAIConfigClient {
  return Object.freeze({
    get: async () => projectAppAIConfigSnapshot(await shell.get()),
    overwrite: async (input) => {
      validateCapabilityIntents(input.capabilities);
      requireRevision(input.expectedRevision);
      return projectAppAIConfigOverwrite(await shell.overwrite(input));
    },
    listOptions: async (query) => {
      validateOptionsQuery(query);
      return projectAppAIConfigOptions(await shell.listOptions(query));
    },
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
      assertExactKeys(local, [], `AIConfig capability ${index} local route`);
      return;
    }
    assertExactKeys(route, ['oneofKind', 'cloud'], `AIConfig capability ${index} route`);
    const cloud = asRecord(route.cloud);
    assertExactKeys(cloud, ['connectorRef', 'implementation', 'providerModelTarget'], `AIConfig capability ${index} cloud route`);
    requireText(cloud.connectorRef, `ai_config_connector_ref_${index}`);
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

function requireRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    invalidIntent('expectedRevision');
  }
  return value;
}

function validateOptionsQuery(query: NimiAIConfigOptionsQuery): void {
  assertExactKeys(
    query,
    query.kind === 'cloud-targets' ? ['kind', 'capabilityContract', 'connectorRef', 'search'] : ['kind', 'capabilityContract', 'search'],
    'AIConfig options query',
  );
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets'].includes(query.kind)) invalidIntent('options query kind');
  requireText(query.capabilityContract, 'ai_config_options_capability_contract');
  if (query.kind === 'cloud-targets') requireText(query.connectorRef, 'ai_config_options_connector_ref');
  if (query.search !== undefined && (typeof query.search !== 'string' || query.search.trim() !== query.search)) {
    invalidIntent('options search');
  }
}

function projectAppAIConfigSnapshot(value: unknown): NimiAIConfigSnapshot {
  const snapshot = asRecord(value);
  assertExactProjectionKeys(snapshot, ['config', 'revision', 'effectiveSelections'], 'App AIConfig snapshot');
  assertSafeProjection(snapshot);
  const config = snapshot.config === null ? null : projectAppAIConfig(snapshot.config);
  const revision = requireProjectionRevision(snapshot.revision);
  if (!Array.isArray(snapshot.effectiveSelections)) localAppProjectionError('App AIConfig effective selections');
  snapshot.effectiveSelections.forEach(projectEffectiveSelection);
  return Object.freeze({
    config,
    revision,
    effectiveSelections: Object.freeze([...snapshot.effectiveSelections]),
  }) as NimiAIConfigSnapshot;
}

function projectAppAIConfigOverwrite(value: unknown): NimiAIConfigOverwriteResult {
  const result = asRecord(value);
  if (!result) return localAppProjectionError('App AIConfig overwrite');
  assertSafeProjection(result);
  const revision = requireProjectionRevision(result.revision);
  const config = result.config === null ? null : projectAppAIConfig(result.config);
  if (result.outcome === 'committed' && config) {
    assertExactProjectionKeys(result, ['outcome', 'config', 'revision'], 'App AIConfig committed overwrite');
    return Object.freeze({ outcome: 'committed', config, revision });
  }
  if (result.outcome === 'conflict' && result.reasonCode === 'AI_CONFIG_REVISION_CONFLICT') {
    assertExactProjectionKeys(result, ['outcome', 'config', 'revision', 'reasonCode'], 'App AIConfig conflict overwrite');
    return Object.freeze({ outcome: 'conflict', config, revision, reasonCode: result.reasonCode });
  }
  return localAppProjectionError('App AIConfig overwrite outcome');
}

function projectAppAIConfigOptions(value: unknown): NimiAIConfigOptionsResult {
  const result = asRecord(value);
  assertExactProjectionKeys(result, ['kind', 'options', 'truncated'], 'App AIConfig options');
  assertSafeProjection(result);
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets'].includes(String(result.kind))
    || !Array.isArray(result.options) || typeof result.truncated !== 'boolean') {
    return localAppProjectionError('App AIConfig options');
  }
  if (result.kind === 'local-loadouts') result.options.forEach(projectLocalOption);
  else if (result.kind === 'cloud-connectors') result.options.forEach(projectCloudConnectorOption);
  else result.options.forEach(projectCloudTargetOption);
  return Object.freeze({
    kind: result.kind,
    options: Object.freeze([...result.options]),
    truncated: result.truncated,
  }) as NimiAIConfigOptionsResult;
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
  config.capabilities.forEach(projectCapabilityIntent);
  return config as unknown as NimiPortableAppAIConfig;
}

function projectCapabilityIntent(value: unknown, index: number): void {
  const intent = asRecord(value);
  if (!intent
    || Object.keys(intent).some((key) => !['capabilityContract', 'requiredFeatures', 'defaults', 'route'].includes(key))
    || !Object.hasOwn(intent, 'capabilityContract')
    || !Object.hasOwn(intent, 'requiredFeatures')
    || !Object.hasOwn(intent, 'route')) {
    localAppProjectionError(`App AIConfig capability ${index}`);
  }
  projectionText(intent.capabilityContract, `App AIConfig capability ${index} contract`);
  if (!Array.isArray(intent.requiredFeatures)
    || intent.requiredFeatures.some((feature) => typeof feature !== 'string' || !feature || feature.trim() !== feature)) {
    localAppProjectionError(`App AIConfig capability ${index} features`);
  }
  const route = asRecord(intent.route);
  if (!route || (route.oneofKind !== 'local' && route.oneofKind !== 'cloud')) {
    localAppProjectionError(`App AIConfig capability ${index} route`);
  }
  if (route.oneofKind === 'local') {
    assertExactProjectionKeys(route, ['oneofKind', 'local'], `App AIConfig capability ${index} Local route`);
    const local = asRecord(route.local);
    assertExactProjectionKeys(local, [], `App AIConfig capability ${index} Local route marker`);
    return;
  }
  assertExactProjectionKeys(route, ['oneofKind', 'cloud'], `App AIConfig capability ${index} Cloud route`);
  const cloud = asRecord(route.cloud);
  assertExactProjectionKeys(cloud, ['connectorRef', 'implementation', 'providerModelTarget'], `App AIConfig capability ${index} Cloud resource`);
  projectionText(cloud.connectorRef, `App AIConfig capability ${index} connectorRef`);
}

function projectEffectiveSelection(value: unknown, index: number): void {
  const selection = asRecord(value);
  assertExactProjectionKeys(selection, ['capabilityContract', 'state', 'resource', 'reasons'], `App AIConfig effective selection ${index}`);
  projectionText(selection.capabilityContract, `App AIConfig effective selection ${index} contract`);
  if (!['ready', 'missing', 'blocked', 'unavailable'].includes(String(selection.state))) {
    localAppProjectionError(`App AIConfig effective selection ${index} state`);
  }
  if (!Array.isArray(selection.reasons)
    || selection.reasons.some((reason) => typeof reason !== 'string' || !reason || reason.trim() !== reason)) {
    localAppProjectionError(`App AIConfig effective selection ${index} reasons`);
  }
  if (selection.resource !== null) {
    const resource = asRecord(selection.resource);
    if (!resource) localAppProjectionError(`App AIConfig effective selection ${index} resource`);
    if (resource.oneofKind === 'local') {
      assertExactProjectionKeys(resource, ['oneofKind', 'local'], `App AIConfig effective selection ${index} Local resource`);
      projectLocalOption(resource.local, index);
    } else if (resource.oneofKind === 'cloud') {
      assertExactProjectionKeys(resource, ['oneofKind', 'cloud'], `App AIConfig effective selection ${index} Cloud resource`);
      const cloud = asRecord(resource.cloud);
      assertExactProjectionKeys(cloud, ['connector', 'target'], `App AIConfig effective selection ${index} Cloud resource`);
      projectCloudConnectorOption(cloud.connector, index);
      projectCloudTargetOption(cloud.target, index);
    } else {
      localAppProjectionError(`App AIConfig effective selection ${index} resource kind`);
    }
  }
}

function projectCloudConnectorOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, ['connectorRef', 'label', 'provider', 'state', 'reasons'], `App AIConfig Cloud Connector option ${index}`);
  projectionText(option.connectorRef, `App AIConfig Cloud Connector option ${index} ref`);
  projectionText(option.label, `App AIConfig Cloud Connector option ${index} label`);
  projectionText(option.provider, `App AIConfig Cloud Connector option ${index} provider`);
  if (!Array.isArray(option.reasons) || !['ready', 'blocked'].includes(String(option.state))) {
    localAppProjectionError(`App AIConfig Cloud Connector option ${index}`);
  }
}

function projectCloudTargetOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, [
    'connectorRef', 'label', 'capabilityContract', 'implementation', 'providerModelTarget',
    'supportedFeatures', 'state', 'reasons',
  ], `App AIConfig Cloud target option ${index}`);
  projectionText(option.connectorRef, `App AIConfig Cloud target option ${index} connectorRef`);
  projectionText(option.label, `App AIConfig Cloud target option ${index} label`);
  projectionText(option.capabilityContract, `App AIConfig Cloud target option ${index} capability`);
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `App AIConfig Cloud target option ${index} implementation`);
  projectionText(implementation.implementationId, `App AIConfig Cloud target option ${index} implementationId`);
  projectionText(implementation.driverId, `App AIConfig Cloud target option ${index} driverId`);
  projectionText(implementation.driverDialect, `App AIConfig Cloud target option ${index} dialect`);
  if (!asRecord(option.providerModelTarget) || !Array.isArray(option.supportedFeatures)
    || !Array.isArray(option.reasons) || !['ready', 'blocked'].includes(String(option.state))) {
    localAppProjectionError(`App AIConfig Cloud target option ${index}`);
  }
}

function projectLocalOption(value: unknown, index: number): void {
  const option = asRecord(value);
  assertExactProjectionKeys(option, [
    'loadoutRef', 'label', 'capabilityContract', 'implementation',
    'supportedFeatures', 'state', 'reasons',
  ], `App AIConfig Local option ${index}`);
  projectionText(option.loadoutRef, `App AIConfig Local option ${index} loadoutRef`);
  projectionText(option.label, `App AIConfig Local option ${index} label`);
  projectionText(option.capabilityContract, `App AIConfig Local option ${index} capability`);
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `App AIConfig Local option ${index} implementation`);
  projectionText(implementation.implementationId, `App AIConfig Local option ${index} implementationId`);
  projectionText(implementation.driverId, `App AIConfig Local option ${index} driverId`);
  projectionText(implementation.driverDialect, `App AIConfig Local option ${index} driverDialect`);
  if (!Array.isArray(option.supportedFeatures)
    || option.supportedFeatures.some((feature) => typeof feature !== 'string' || !feature || feature.trim() !== feature)
    || !Array.isArray(option.reasons)
    || option.reasons.some((reason) => typeof reason !== 'string' || !reason || reason.trim() !== reason)
    || (option.state !== 'ready' && option.state !== 'blocked')) {
    localAppProjectionError(`App AIConfig Local option ${index}`);
  }
}

function requireProjectionRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return localAppProjectionError('App AIConfig revision');
  }
  return value;
}
