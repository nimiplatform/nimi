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

const APP_PRESET_VOICE_OPTIONS_LIMIT = 100;
const APP_PRESET_VOICE_ID_MAX_SCALARS = 128;
const APP_PRESET_VOICE_NAME_MAX_SCALARS = 256;
const APP_PRESET_VOICE_LANG_MAX_SCALARS = 64;
const APP_PRESET_VOICE_LANGS_LIMIT = 32;

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
// @nimi-authority: rule.nimi.sdks.feature-clients.r014
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
    query.kind === 'preset-voices'
      ? ['kind']
      : query.kind === 'cloud-targets'
        ? ['kind', 'capabilityContract', 'connectorRef', 'search']
        : ['kind', 'capabilityContract', 'search'],
    'AIConfig options query',
  );
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets', 'preset-voices'].includes(query.kind)) invalidIntent('options query kind');
  if (query.kind === 'preset-voices') return;
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
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets', 'preset-voices'].includes(String(result.kind))
    || !Array.isArray(result.options) || typeof result.truncated !== 'boolean') {
    return localAppProjectionError('App AIConfig options');
  }
  if (result.options.length > APP_PRESET_VOICE_OPTIONS_LIMIT && result.kind === 'preset-voices') {
    return localAppProjectionError('App AIConfig preset voice options row bound');
  }
  if (result.kind === 'preset-voices') {
    return Object.freeze({
      kind: 'preset-voices' as const,
      options: Object.freeze(result.options.map(projectAppPresetVoiceOption)),
      truncated: result.truncated,
    });
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
    'implementationSupportedFeatures', 'configuredFeatures', 'textBehaviors', 'state', 'reasons',
  ], `App AIConfig Local option ${index}`);
  projectionText(option.loadoutRef, `App AIConfig Local option ${index} loadoutRef`);
  projectionText(option.label, `App AIConfig Local option ${index} label`);
  projectionText(option.capabilityContract, `App AIConfig Local option ${index} capability`);
  const implementation = asRecord(option.implementation);
  assertExactProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], `App AIConfig Local option ${index} implementation`);
  projectionText(implementation.implementationId, `App AIConfig Local option ${index} implementationId`);
  projectionText(implementation.driverId, `App AIConfig Local option ${index} driverId`);
  projectionText(implementation.driverDialect, `App AIConfig Local option ${index} driverDialect`);
  if (!validCanonicalStrings(option.implementationSupportedFeatures)
    || !validCanonicalStrings(option.configuredFeatures)
    || !Array.isArray(option.textBehaviors)
    || !option.textBehaviors.every(validTextBehaviorProjection)
    || !Array.isArray(option.reasons)
    || option.reasons.some((reason) => typeof reason !== 'string' || !reason || reason.trim() !== reason)
    || (option.state !== 'ready' && option.state !== 'blocked')) {
    localAppProjectionError(`App AIConfig Local option ${index}`);
  }
}

function validCanonicalStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.trim() === entry);
}

function validTextBehaviorProjection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const projection = value as Record<string, unknown>;
  const keys = Object.keys(projection).sort();
  const required = ['configurationState', 'implementationSupported', 'kind', 'reasons'];
  const allowed = new Set([...required, 'configuredToolUse', 'implementationToolUse']);
  const kind = String(projection.kind);
  if (!required.every((key) => keys.includes(key)) || !keys.every((key) => allowed.has(key))
    || !['tool-use', 'reasoning', 'structured-output'].includes(kind)
    || typeof projection.implementationSupported !== 'boolean'
    || !['unavailable', 'configured', 'ambiguous'].includes(String(projection.configurationState))
    || !Array.isArray(projection.reasons)
    || !projection.reasons.every((reason) => typeof reason === 'string' && reason.length > 0 && reason.trim() === reason)) {
    return false;
  }
  if (kind !== 'tool-use') {
    return projection.implementationToolUse == null && projection.configuredToolUse == null;
  }
  return (projection.implementationToolUse == null || validToolUseProjection(projection.implementationToolUse))
    && (projection.configuredToolUse == null || validToolUseProjection(projection.configuredToolUse));
}

function validToolUseProjection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const projection = value as Record<string, unknown>;
  const expected = [
    'supportedToolSpecKinds', 'supportedToolChoiceModes', 'supportsSingleCall', 'supportsMultipleCalls',
    'supportsParallelCalls', 'supportsSync', 'supportsStream', 'supportsToolOnlyResponse',
    'supportsToolResultRoundTrip', 'supportsMixedTextAndToolCalls',
  ].sort();
  const keys = Object.keys(projection).sort();
  return keys.length === expected.length && keys.every((key, keyIndex) => key === expected[keyIndex])
    && Array.isArray(projection.supportedToolSpecKinds)
    && projection.supportedToolSpecKinds.every((kind) => kind === 'function' || kind === 'provider')
    && Array.isArray(projection.supportedToolChoiceModes)
    && projection.supportedToolChoiceModes.every((mode) => ['auto', 'none', 'required', 'tool'].includes(String(mode)))
    && expected.slice(2).every((key) => typeof projection[key] === 'boolean');
}

function projectAppPresetVoiceOption(value: unknown, index: number) {
  const option = asRecord(value);
  assertExactProjectionKeys(option, ['voiceId', 'name', 'supportedLangs'], `App AIConfig preset voice option ${index}`);
  if (!Array.isArray(option.supportedLangs) || option.supportedLangs.length > APP_PRESET_VOICE_LANGS_LIMIT) {
    localAppProjectionError(`App AIConfig preset voice option ${index} languages`);
  }
  const supportedLangs = option.supportedLangs.map((lang, langIndex) => projectionBoundedText(
    lang,
    `App AIConfig preset voice option ${index} language ${langIndex}`,
    APP_PRESET_VOICE_LANG_MAX_SCALARS,
  ));
  return Object.freeze({
    voiceId: projectionBoundedText(option.voiceId, `App AIConfig preset voice option ${index} voiceId`, APP_PRESET_VOICE_ID_MAX_SCALARS),
    name: projectionBoundedText(option.name, `App AIConfig preset voice option ${index} name`, APP_PRESET_VOICE_NAME_MAX_SCALARS),
    supportedLangs: Object.freeze(supportedLangs),
  });
}

function projectionBoundedText(value: unknown, field: string, maxScalars: number): string {
  const text = projectionText(value, field);
  if (Array.from(text).length > maxScalars || /[\u0000-\u001f\u007f]/u.test(text)) localAppProjectionError(field);
  return text;
}

function requireProjectionRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    return localAppProjectionError('App AIConfig revision');
  }
  return value;
}
