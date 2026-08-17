import type { JsonValue as ProtoJsonValue } from '@protobuf-ts/runtime';
import { Struct as RuntimeStruct, type Struct } from '../../core-generated/runtime-protobuf/google/protobuf/struct';
import {
  type AIConfig,
  type AIConfigCapabilityIntent,
  type CapabilityImplementationIdentity,
} from '../../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { NimiJsonObject, NimiJsonValue } from '../contracts/index.js';
import { createNimiError, extractNimiErrorFields } from '../../types/index.js';
import type { NimiAppAIConfigClient } from './capability-configuration.js';

export interface NimiPortableAIProfileImplementation {
  readonly implementationId: string;
  readonly driverId: string;
  readonly driverDialect: string;
  /** CapabilityImplementation support truth is distinct from AIConfig requirements. */
  readonly supportedFeatures: readonly string[];
}

export interface NimiPortableAIProfileResourceOccurrence {
  readonly occurrenceId: string;
  readonly [key: string]: NimiJsonValue;
}

export interface NimiPortableAIProfileModelSourceRecommendation {
  readonly repo: string;
  readonly revision: string;
  readonly file: string;
  readonly sizeBytes?: number;
}

export interface NimiPortableAIProfileLoadoutAxis {
  readonly slotId: string;
  readonly contentId: `sha256:${string}`;
  readonly expectedHash: `sha256:${string}`;
  readonly source?: NimiPortableAIProfileModelSourceRecommendation;
}

export interface NimiPortableAIProfileLoadoutIntent {
  readonly recipeId: string;
  readonly axes: readonly NimiPortableAIProfileLoadoutAxis[];
  readonly options: NimiJsonObject;
}

export type NimiPortableAIProfileCapability =
  | {
    readonly route: 'local';
    readonly requiredFeatures: readonly string[];
    readonly defaults?: NimiJsonObject;
    readonly implementation?: NimiPortableAIProfileImplementation;
    readonly driverPortableConfig?: NimiJsonObject;
    readonly resourceOccurrences?: readonly NimiPortableAIProfileResourceOccurrence[];
    readonly loadout?: NimiPortableAIProfileLoadoutIntent;
  }
  | {
    readonly route: 'cloud';
    readonly requiredFeatures: readonly string[];
    readonly defaults?: NimiJsonObject;
    readonly implementation: NimiPortableAIProfileImplementation;
    readonly providerModelTarget: NimiJsonObject;
  };

export interface NimiPortableAIProfile {
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
  readonly capabilities: Readonly<Record<string, NimiPortableAIProfileCapability>>;
  readonly provenance?: NimiJsonObject;
  readonly license?: NimiJsonValue;
  readonly displayMetadata?: NimiJsonObject;
}

export interface NimiPortableLoadoutIntent {
  readonly capabilityContract: string;
  readonly implementation: NimiPortableAIProfileImplementation;
  readonly driverPortableConfig: NimiJsonObject;
  readonly resourceOccurrences: readonly NimiPortableAIProfileResourceOccurrence[];
  readonly supportedFeatures: readonly string[];
  readonly loadout?: NimiPortableAIProfileLoadoutIntent;
}

export interface NimiCloudAIConfigCapabilityInput {
  readonly capabilityContract: string;
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
  readonly implementation: CapabilityImplementationIdentity;
  readonly providerModelTarget: NimiJsonObject;
}

export interface NimiAppAIProfilePreview {
  /** Portable source remains separate from the resulting mutable AIConfig. */
  readonly source: NimiPortableAIProfile;
  readonly before: AIConfig | null;
  readonly after: AIConfig;
  readonly identical: boolean;
}

export type NimiPortableAIProfileInput = NimiPortableAIProfile | string | Uint8Array | NimiJsonObject;

export interface NimiAppAIProfileClient {
  preview(profile: NimiPortableAIProfileInput): Promise<NimiAppAIProfilePreview>;
  /** Direct atomic overwrite; it accepts source intent, never Preview output. */
  apply(profile: NimiPortableAIProfileInput): Promise<AIConfig>;
}

// @nimi-authority: definition.nimi.sdks.feature-clients.ai-config-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r013
// @nimi-authority: rule.nimi.runtime.local-compute.r028
/** Parse one closed portable AIProfile document. Connector identity is
 * intentionally absent and remains Runtime-resolved from owner configuration.
 */
export function parseNimiPortableAIProfile(
  input: NimiPortableAIProfileInput,
): NimiPortableAIProfile {
  const parsed = parseProfileInput(input);
  assertExactKeys(parsed, ['profileId', 'title', 'description', 'capabilities', 'provenance', 'license', 'displayMetadata'], 'AIProfile');
  assertPortableValue(parsed, 'AIProfile');
  const profileId = requireText(parsed.profileId, 'AIProfile profileId is required');
  const title = requireText(parsed.title, 'AIProfile title is required');
  const description = parsed.description === undefined
    ? undefined
    : requireExactText(parsed.description, 'AIProfile description must be text');
  const provenance = parsed.provenance === undefined
    ? undefined
    : normalizeJsonObject(parsed.provenance, 'AIProfile provenance');
  const license = parsed.license === undefined
    ? undefined
    : normalizeJsonValue(parsed.license, 'AIProfile license');
  const displayMetadata = parsed.displayMetadata === undefined
    ? undefined
    : normalizeJsonObject(parsed.displayMetadata, 'AIProfile displayMetadata');
  const capabilityRecord = requireObject(parsed.capabilities, 'AIProfile capabilities must be an object');
  const capabilityContracts = Object.keys(capabilityRecord).sort();
  if (capabilityContracts.length === 0) profileError('AIProfile must declare at least one CapabilityContract');
  const capabilities: Record<string, NimiPortableAIProfileCapability> = {};
  for (const capabilityContract of capabilityContracts) {
    const contract = requireText(capabilityContract, 'AIProfile CapabilityContract is required');
    const value = requireObject(capabilityRecord[capabilityContract], `AIProfile ${contract} must be an object`);
    assertExactKeys(value, [
      'route',
      'requiredFeatures',
      'defaults',
      'implementation',
      'driverPortableConfig',
      'resourceOccurrences',
      'loadout',
      'providerModelTarget',
    ], `AIProfile ${contract}`);
    const route = requireText(value.route, `AIProfile ${contract} route is required`);
    const requiredFeatures = parseRequiredFeatures(value.requiredFeatures, contract);
    const defaults = value.defaults === undefined
      ? undefined
      : normalizeJsonObject(value.defaults, `AIProfile ${contract} defaults`);
    if (route === 'local') {
      if (value.providerModelTarget !== undefined) {
        profileError(`AIProfile ${contract} Local intent cannot contain a Cloud recommendation`);
      }
      const implementation = value.implementation === undefined
        ? undefined
        : parsePortableImplementation(
          value.implementation,
          `AIProfile ${contract} implementation`,
          requiredFeatures,
        );
      const driverPortableConfig = value.driverPortableConfig === undefined
        ? undefined
        : normalizeJsonObject(value.driverPortableConfig, `AIProfile ${contract} driverPortableConfig`);
      const resourceOccurrences = value.resourceOccurrences === undefined
        ? undefined
        : parseResourceOccurrences(value.resourceOccurrences, contract);
      const loadout = value.loadout === undefined
        ? undefined
        : parsePortableLoadoutIntent(value.loadout, contract);
      if (!implementation && (driverPortableConfig || resourceOccurrences?.length || loadout)) {
        profileError(`AIProfile ${contract} Local portable configuration requires CapabilityImplementation`);
      }
      capabilities[contract] = Object.freeze({
        route: 'local',
        requiredFeatures,
        ...(defaults ? { defaults } : {}),
        ...(implementation ? { implementation } : {}),
        ...(driverPortableConfig ? { driverPortableConfig } : {}),
        ...(resourceOccurrences ? { resourceOccurrences } : {}),
        ...(loadout ? { loadout } : {}),
      });
      continue;
    }
    if (route !== 'cloud') profileError(`AIProfile ${contract} route must be local or cloud`);
    if (value.driverPortableConfig !== undefined || value.resourceOccurrences !== undefined || value.loadout !== undefined) {
      profileError(`AIProfile ${contract} Cloud recommendation cannot contain Local configuration intent`);
    }
    const target = normalizeJsonObject(value.providerModelTarget, `AIProfile ${contract} providerModelTarget`);
    assertExactCloudProviderModelTarget(target);
    capabilities[contract] = Object.freeze({
      route: 'cloud',
      requiredFeatures,
      ...(defaults ? { defaults } : {}),
      implementation: parsePortableImplementation(
        value.implementation,
        `AIProfile ${contract} implementation`,
        requiredFeatures,
      ),
      providerModelTarget: target,
    });
  }
  return Object.freeze({
    profileId,
    title,
    ...(description !== undefined ? { description } : {}),
    capabilities: Object.freeze(capabilities),
    ...(provenance ? { provenance } : {}),
    ...(license !== undefined ? { license } : {}),
    ...(displayMetadata ? { displayMetadata } : {}),
  });
}

export function serializeNimiPortableAIProfile(input: NimiPortableAIProfileInput): string {
  return JSON.stringify(parseNimiPortableAIProfile(input));
}

/** Projects only the Profile's Local implementation intent. Calling this does
 * not add, update, bind, or select machine configuration; a consumer must pass
 * the result to an explicit Loadout action.
 */
export function projectNimiPortableLoadoutIntent(
  input: NimiPortableAIProfileInput,
  capabilityContract: string,
): NimiPortableLoadoutIntent | null {
  const profile = parseNimiPortableAIProfile(input);
  const contract = requireText(capabilityContract, 'CapabilityContract is required');
  const capability = profile.capabilities[contract];
  if (!capability || capability.route !== 'local' || !capability.implementation) return null;
  return Object.freeze({
    capabilityContract: contract,
    implementation: capability.implementation,
    driverPortableConfig: capability.driverPortableConfig ?? Object.freeze({}),
    resourceOccurrences: capability.resourceOccurrences ?? Object.freeze([]),
    supportedFeatures: capability.implementation.supportedFeatures,
    ...(capability.loadout ? { loadout: capability.loadout } : {}),
  });
}

export function createNimiCloudAIConfigCapabilityIntent(
  input: NimiCloudAIConfigCapabilityInput,
): AIConfigCapabilityIntent {
  const capabilityContract = requireText(input.capabilityContract, 'Cloud CapabilityContract is required');
  const target = normalizeJsonObject(input.providerModelTarget, 'Cloud providerModelTarget');
  assertExactCloudProviderModelTarget(target);
  return {
    capabilityContract,
    requiredFeatures: [...parseRequiredFeatures(input.requiredFeatures, capabilityContract)],
    ...(input.defaults ? { defaults: toRuntimeStruct(normalizeJsonObject(input.defaults, 'Cloud defaults')) } : {}),
    route: {
      oneofKind: 'cloud',
      cloud: {
        implementation: parseAIConfigImplementation(input.implementation, 'Cloud implementation'),
        providerModelTarget: toRuntimeStruct(target),
      },
    },
  };
}

function assertExactCloudProviderModelTarget(target: NimiJsonObject): void {
  if (Object.hasOwn(target, 'model')) {
    profileError('Cloud providerModelTarget.model is not supported');
  }
  for (const key of ['provider', 'providerModelId', 'remoteModelCatalogId'] as const) {
    const value = target[key];
    if (typeof value !== 'string' || value.length === 0 || /^\p{White_Space}|\p{White_Space}$/u.test(value)) {
      profileError(`Cloud providerModelTarget.${key} is required`);
    }
  }
}

export function createNimiLocalAIConfigCapabilityIntent(input: {
  readonly capabilityContract: string;
  readonly requiredFeatures?: readonly string[];
  readonly defaults?: NimiJsonObject;
}): AIConfigCapabilityIntent {
  const capabilityContract = requireText(input.capabilityContract, 'Local CapabilityContract is required');
  return {
    capabilityContract,
    requiredFeatures: [...parseRequiredFeatures(input.requiredFeatures, capabilityContract)],
    ...(input.defaults ? { defaults: toRuntimeStruct(normalizeJsonObject(input.defaults, 'Local defaults')) } : {}),
    route: { oneofKind: 'local', local: {} },
  };
}

export function runtimeAIConfigStructToJson(value: Struct | undefined): NimiJsonObject {
  if (!value) return Object.freeze({});
  return normalizeJsonObject(RuntimeStruct.toJson(value), 'Runtime Struct');
}

function projectPortableProfileToAIConfig(
  source: NimiPortableAIProfile,
  client: NimiAppAIConfigClient,
): AIConfig {
  const capabilities = Object.entries(source.capabilities).map(([capabilityContract, capability]) => (
    capability.route === 'local'
      ? createNimiLocalAIConfigCapabilityIntent({
        capabilityContract,
        requiredFeatures: capability.requiredFeatures,
        defaults: capability.defaults,
      })
      : createNimiCloudAIConfigCapabilityIntent({
        capabilityContract,
        requiredFeatures: capability.requiredFeatures,
        defaults: capability.defaults,
        implementation: {
          implementationId: capability.implementation.implementationId,
          driverId: capability.implementation.driverId,
          driverDialect: capability.implementation.driverDialect,
        },
        providerModelTarget: capability.providerModelTarget,
      })
  ));
  return Object.freeze({
    owner: client.owner,
    capabilities,
  });
}

export function createNimiAppAIProfileClient(client: NimiAppAIConfigClient): NimiAppAIProfileClient {
  const readCurrent = async (): Promise<AIConfig | null> => {
    try {
      return await client.get();
    } catch (error) {
      if (extractNimiErrorFields(error).reasonCode === 'AI_CONFIG_NOT_FOUND') return null;
      throw error;
    }
  };
  return {
    async preview(input) {
      const source = parseNimiPortableAIProfile(input);
      const before = await readCurrent();
      const after = projectPortableProfileToAIConfig(source, client);
      return Object.freeze({
        source,
        before,
        after,
        identical: before !== null && canonicalConfig(before) === canonicalConfig(after),
      });
    },
    async apply(input) {
      const source = parseNimiPortableAIProfile(input);
      const after = projectPortableProfileToAIConfig(source, client);
      return client.overwrite(after.capabilities);
    },
  };
}

function parseProfileInput(input: NimiPortableAIProfile | string | Uint8Array | NimiJsonObject): Record<string, unknown> {
  if (input instanceof Uint8Array) return parseJsonText(new TextDecoder().decode(input));
  if (typeof input === 'string') return parseJsonText(input);
  return requireObject(input, 'AIProfile must be an object');
}

function parseJsonText(input: string): Record<string, unknown> {
  if (!input.trim()) profileError('AIProfile JSON is required');
  try {
    return requireObject(JSON.parse(input), 'AIProfile JSON must contain an object');
  } catch (error) {
    if (error instanceof SyntaxError) profileError('AIProfile JSON is invalid');
    throw error;
  }
}

function parsePortableImplementation(
  value: unknown,
  label: string,
  requiredFeatures: readonly string[],
): NimiPortableAIProfileImplementation {
  const record = requireObject(value, `${label} is required`);
  assertExactKeys(record, ['implementationId', 'driverId', 'driverDialect', 'supportedFeatures'], label);
  const supportedFeatures = parseFeatureSet(record.supportedFeatures, `${label}.supportedFeatures`);
  const supported = new Set(supportedFeatures);
  const unsupportedRequirement = requiredFeatures.find((feature) => !supported.has(feature));
  if (unsupportedRequirement) {
    profileError(`${label} does not support required feature ${unsupportedRequirement}`);
  }
  return Object.freeze({
    implementationId: requireText(record.implementationId, `${label}.implementationId is required`),
    driverId: requireText(record.driverId, `${label}.driverId is required`),
    driverDialect: requireText(record.driverDialect, `${label}.driverDialect is required`),
    supportedFeatures,
  });
}

function parseAIConfigImplementation(value: unknown, label: string): CapabilityImplementationIdentity {
  const record = requireObject(value, `${label} is required`);
  assertExactKeys(record, ['implementationId', 'driverId', 'driverDialect'], label);
  return Object.freeze({
    implementationId: requireText(record.implementationId, `${label}.implementationId is required`),
    driverId: requireText(record.driverId, `${label}.driverId is required`),
    driverDialect: requireText(record.driverDialect, `${label}.driverDialect is required`),
  });
}

function parseResourceOccurrences(
  value: unknown,
  capabilityContract: string,
): readonly NimiPortableAIProfileResourceOccurrence[] {
  if (!Array.isArray(value)) profileError(`AIProfile ${capabilityContract} resourceOccurrences must be an array`);
  const seen = new Set<string>();
  return Object.freeze(value.map((entry, index) => {
    const occurrence = normalizeJsonObject(entry, `AIProfile ${capabilityContract} resourceOccurrences[${index}]`);
    const occurrenceId = requireText(occurrence.occurrenceId, `AIProfile ${capabilityContract} resource occurrenceId is required`);
    if (seen.has(occurrenceId)) profileError(`AIProfile ${capabilityContract} resource occurrence ${occurrenceId} is duplicated`);
    seen.add(occurrenceId);
    return Object.freeze({ ...occurrence, occurrenceId });
  }));
}

function parsePortableLoadoutIntent(
  value: unknown,
  capabilityContract: string,
): NimiPortableAIProfileLoadoutIntent {
  const record = requireObject(value, `AIProfile ${capabilityContract} loadout must be an object`);
  assertExactKeys(record, ['recipeId', 'axes', 'options'], `AIProfile ${capabilityContract} loadout`);
  if (!Array.isArray(record.axes)) profileError(`AIProfile ${capabilityContract} loadout axes must be an array`);
  const seen = new Set<string>();
  const axes = Object.freeze(record.axes.map((value, index) => {
    const axis = requireObject(value, `AIProfile ${capabilityContract} loadout axis[${index}] must be an object`);
    assertExactKeys(axis, ['slotId', 'contentId', 'expectedHash', 'source'], `AIProfile ${capabilityContract} loadout axis[${index}]`);
    const slotId = requireText(axis.slotId, `AIProfile ${capabilityContract} loadout axis[${index}] slotId is required`);
    if (seen.has(slotId)) profileError(`AIProfile ${capabilityContract} loadout slot ${slotId} is duplicated`);
    seen.add(slotId);
    const source = axis.source === undefined
      ? undefined
      : parseModelSourceRecommendation(axis.source, capabilityContract, slotId);
    return Object.freeze({
      slotId,
      contentId: requireSHA256Identity(axis.contentId, `AIProfile ${capabilityContract} loadout ${slotId} contentId`),
      expectedHash: requireSHA256Identity(axis.expectedHash, `AIProfile ${capabilityContract} loadout ${slotId} expectedHash`),
      ...(source ? { source } : {}),
    });
  }));
  return Object.freeze({
    recipeId: requireText(record.recipeId, `AIProfile ${capabilityContract} loadout recipeId is required`),
    axes,
    options: normalizeJsonObject(record.options, `AIProfile ${capabilityContract} loadout options`),
  });
}

function parseModelSourceRecommendation(
  value: unknown,
  capabilityContract: string,
  slotId: string,
): NimiPortableAIProfileModelSourceRecommendation {
  const label = `AIProfile ${capabilityContract} loadout ${slotId} source`;
  const source = requireObject(value, `${label} must be an object`);
  assertExactKeys(source, ['repo', 'revision', 'file', 'sizeBytes'], label);
  const sizeBytes = source.sizeBytes === undefined ? undefined : requirePositiveInteger(source.sizeBytes, `${label} sizeBytes`);
  return Object.freeze({
    repo: requireText(source.repo, `${label} repo is required`),
    revision: requireText(source.revision, `${label} revision is required`),
    file: requireRelativeFile(source.file, `${label} file is required`),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
  });
}

function requireSHA256Identity(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    profileError(`${label} must be an exact sha256 identity`);
  }
  return value as `sha256:${string}`;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    profileError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireRelativeFile(value: unknown, message: string): string {
  const file = requireText(value, message).replaceAll('\\', '/');
  if (file.startsWith('/') || /^[a-z]:/iu.test(file) || file.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    profileError(message);
  }
  return file;
}

function parseRequiredFeatures(value: unknown, capabilityContract: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  return parseFeatureSet(value, `AIProfile ${capabilityContract} requiredFeatures`);
}

function parseFeatureSet(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) profileError(`${label} must be an array`);
  const features = value.map((feature) => requireText(feature, `${label} contains an invalid feature`)).sort();
  if (new Set(features).size !== features.length) profileError(`${label} must be unique`);
  return Object.freeze(features);
}

function normalizeJsonObject(value: unknown, label: string): NimiJsonObject {
  const record = requireObject(value, `${label} must be an object`);
  const normalized: Record<string, NimiJsonValue> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') profileError(`${label} contains an unsafe key`);
    normalized[key] = normalizeJsonValue(record[key], `${label}.${key}`);
  }
  return Object.freeze(normalized);
}

function normalizeJsonValue(value: unknown, label: string): NimiJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) profileError(`${label} contains a non-finite number`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) profileError(`${label} contains an unsafe integer`);
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map((entry, index) => normalizeJsonValue(entry, `${label}[${index}]`)));
  if (value && typeof value === 'object') return normalizeJsonObject(value, label);
  return profileError(`${label} is not portable JSON`);
}

const FORBIDDEN_PORTABLE_KEYS = new Set([
  'connectorgrantid', 'connectorgrant', 'grant', 'grantid', 'connectorid', 'connector',
  'accountid', 'account', 'subjectuserid', 'owneruserid', 'machine', 'machineid', 'deviceid', 'hostid',
  'assetid', 'artifactid', 'localassetid', 'localassetpath', 'binding', 'bindings', 'exactbinding', 'exactbindings',
  'path', 'filepath', 'secret', 'secrets', 'credential', 'credentials', 'credentialpayload', 'apikey', 'password', 'privatekey',
  'token', 'accesstoken', 'refreshtoken', 'oauthtoken', 'endpoint', 'endpointurl', 'baseurl',
  'runtimeprocessid', 'jobid',
]);

function assertPortableValue(value: unknown, label: string): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (isPortablePath(value)) profileError(`${label} contains a non-portable path`);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) profileError(`${label} contains a non-finite number`);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) profileError(`${label} contains an unsafe integer`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertPortableValue(entry, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') profileError(`${label} contains an unsafe key`);
      const normalized = key.toLowerCase().replaceAll('_', '').replaceAll('-', '');
      if (FORBIDDEN_PORTABLE_KEYS.has(normalized)
        || normalized.endsWith('path')
        || normalized.endsWith('bindingid')
        || normalized.includes('connectorgrant')
        || normalized.endsWith('connectorid')
        || normalized.endsWith('accountid')
        || normalized.startsWith('machine')
        || normalized.endsWith('assetid')
        || normalized.endsWith('artifactid')
        || normalized.includes('localasset')) {
        profileError(`${label}.${key} is forbidden in portable AIProfile`);
      }
      assertPortableValue(entry, `${label}.${key}`);
    }
    return;
  }
  profileError(`${label} contains unsupported portable JSON`);
}

function isPortablePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('/') || trimmed.startsWith('\\\\') || trimmed.startsWith('~/') || trimmed.toLowerCase().startsWith('file://') || /^[A-Za-z]:[\\/]/u.test(trimmed);
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) profileError(message);
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const admitted = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !admitted.has(key));
  if (unknown.length > 0) profileError(`${label} contains unsupported field ${unknown.sort()[0]}`);
}

function requireText(value: unknown, message: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value) profileError(message);
  return normalized;
}

function requireExactText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() !== value) profileError(message);
  return value;
}

function toRuntimeStruct(value: NimiJsonObject): Struct {
  return RuntimeStruct.fromJson(value as ProtoJsonValue);
}

function canonicalConfig(config: AIConfig): string {
  const capabilities = [...config.capabilities]
    .map((intent) => ({
      capabilityContract: intent.capabilityContract,
      requiredFeatures: [...intent.requiredFeatures].sort(),
      ...(intent.defaults ? { defaults: runtimeAIConfigStructToJson(intent.defaults) } : {}),
      route: intent.route.oneofKind === 'local'
        ? { oneofKind: 'local' as const }
        : intent.route.oneofKind === 'cloud'
          ? {
            oneofKind: 'cloud' as const,
            implementation: intent.route.cloud.implementation,
            providerModelTarget: runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget),
          }
          : { oneofKind: undefined },
    }))
    .sort((left, right) => left.capabilityContract.localeCompare(right.capabilityContract));
  return JSON.stringify({
    owner: config.owner,
    capabilities,
  });
}

function profileError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'AI_PROFILE_INVALID',
    actionHint: 'provide_portable_ai_profile',
    source: 'sdk',
  });
}
