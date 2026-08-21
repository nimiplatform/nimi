import type { JsonValue } from '../../types';
import {
  asRecord,
  assertExactKeys,
  assertExactMethodNamespace,
  localAppError,
  localAppProjectionError,
} from './local-app-runtime-platform-validation.js';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_IDENTIFIER_BYTES = 512;
const MAX_ARRAY_ITEMS = 20_000;
const MAX_DEPTH = 32;
const MAX_NODES = 100_000;
const DEFAULT_TAKE = 50;
const MAX_TAKE = 500;

const CREDENTIAL_QUERY_PARAMETER = /^(?:x-amz-.+|x-goog-.+|access[_-]?token|token|api[_-]?key|apikey|key|secret|sig(?:nature)?|credential|expires?|policy|auth(?:orization)?|awsaccesskeyid|googleaccessid)$/iu;
const ENCODED_CREDENTIAL_SEPARATOR = /(?:%3f|%26|%23)(?:x-amz-[^=&%#]+|x-goog-[^=&%#]+|access[_-]?token|token|api[_-]?key|apikey|key|secret|sig(?:nature)?|credential|expires?|policy|auth(?:orization)?|awsaccesskeyid|googleaccessid)=/iu;
const RESOURCE_REF_CREDENTIAL = /(?:[?&#]|%3f|%26|%23)(?:x-amz-[^=&%#]+|x-goog-[^=&%#]+|access[_-]?token|token|api[_-]?key|apikey|key|secret|sig(?:nature)?|credential|expires?|policy|auth(?:orization)?)=/iu;

export type NimiLocalAppPersonaCharacterVisibility = 'private' | 'unlisted' | 'public' | 'system';
export type NimiLocalAppPersonaCharacterWritableVisibility = Exclude<NimiLocalAppPersonaCharacterVisibility, 'system'>;

export type NimiLocalAppPersonaCharacterOrigin = {
  readonly kind: 'manual' | 'forge' | 'worldCharacterDerivation' | 'import' | 'system';
  readonly parentCharacterId?: string;
  readonly parentWorldId?: string;
  readonly sourceContentHash?: string;
  readonly sourceId?: string;
  readonly sourceVersion?: string;
};

export type NimiLocalAppPersonaCharacterResourceRef = {
  readonly refId: string;
  readonly kind: string;
  readonly label?: string;
  readonly purpose?: string;
};

export type NimiLocalAppPersonaCharacterExternalRef = NimiLocalAppPersonaCharacterResourceRef & {
  readonly uri: string;
};

export type NimiLocalAppPersonaCharacterAssetIntent = {
  readonly intentId: string;
  readonly kind: string;
  readonly summary?: string;
};

export type NimiLocalAppPersonaCharacterExtension = {
  readonly extensionSchemaVersion: string;
  readonly namespace: string;
  readonly productSemantic: boolean;
  readonly fields: Readonly<Record<string, JsonValue>>;
};

type NimiLocalAppPersonaCharacterProfileBase = {
  readonly profileSchemaVersion: 'realm.character-profile-core/v1';
  readonly identity: {
    readonly name: string;
    readonly summary: string;
    readonly handle?: string;
    readonly aliases?: readonly string[];
  };
  readonly presentation: {
    readonly displayName: string;
    readonly avatarResourceRef?: string;
    readonly profileCoverResourceRef?: string;
    readonly profileLine?: string;
    readonly shortBio?: string;
  };
  readonly narrative: {
    readonly summary: string;
    readonly archetype?: string;
    readonly traits?: readonly string[];
    readonly milestones?: readonly {
      readonly milestoneId: string;
      readonly sequence?: number;
      readonly summary?: string;
      readonly title?: string;
    }[];
  };
  readonly interactionProfile: {
    readonly interactionModes: readonly string[];
    readonly cadence?: string;
    readonly greeting?: string;
    readonly greetingVariants?: readonly string[];
    readonly scenario?: string;
    readonly tone?: string;
    readonly dialogueExemplars?: readonly {
      readonly exemplarId: string;
      readonly character: string;
      readonly user?: string;
    }[];
  };
  readonly assets: {
    readonly resourceRefs: readonly NimiLocalAppPersonaCharacterResourceRef[];
    readonly intents: readonly NimiLocalAppPersonaCharacterAssetIntent[];
    readonly externalRefs?: readonly NimiLocalAppPersonaCharacterExternalRef[];
  };
  readonly authoring: {
    readonly source: string;
    readonly notes?: readonly string[];
    readonly extensions?: Readonly<Record<string, NimiLocalAppPersonaCharacterExtension>>;
  };
  readonly capabilities?: {
    readonly tools?: readonly { readonly toolId: string; readonly name?: string; readonly summary?: string }[];
  };
  readonly knowledge?: { readonly topics?: readonly string[]; readonly constraints?: readonly string[] };
  readonly psychology?: { readonly drives?: readonly string[]; readonly boundaries?: readonly string[] };
  readonly relationships?: readonly {
    readonly relationshipId: string;
    readonly relationType: string;
    readonly summary?: string;
    readonly targetRef: { readonly kind: 'worldEntity'; readonly worldId: string; readonly entityId: string };
  }[];
};

export type NimiLocalAppPersonaCharacterProfileInput = NimiLocalAppPersonaCharacterProfileBase & {
  readonly profileCoverage?: never;
  readonly profileHash?: never;
};

export type NimiLocalAppPersonaCharacterProfileCoverage = {
  readonly manifestSchemaVersion: 'realm.character-profile-coverage/v1';
  readonly requiredSections: readonly NimiLocalAppPersonaCharacterProfileCoverageSection[];
  readonly optionalSections: readonly NimiLocalAppPersonaCharacterProfileCoverageSection[];
  readonly requiredRefs: readonly NimiLocalAppPersonaCharacterProfileCoverageRef[];
  readonly optionalRefs: readonly NimiLocalAppPersonaCharacterProfileCoverageRef[];
  readonly diagnostics: readonly NimiLocalAppPersonaCharacterDiagnostic[];
  readonly aggregateStatus: 'complete' | 'incomplete' | 'invalid';
  readonly profileCoverageHash: string;
};

export type NimiLocalAppPersonaCharacterProfileCoverageSection = {
  readonly path: string;
  readonly state: 'present' | 'missing' | 'empty' | 'invalid';
};

export type NimiLocalAppPersonaCharacterProfileCoverageRef = {
  readonly path: string;
  readonly refKind: string;
  readonly refId: string;
  readonly state: 'resolved' | 'missing' | 'empty' | 'invalid';
};

export type NimiLocalAppPersonaCharacterDiagnostic = {
  readonly path: string;
  readonly code: string;
  readonly message: string;
};

export type NimiLocalAppPersonaCharacterProfile = NimiLocalAppPersonaCharacterProfileBase & {
  readonly profileCoverage: NimiLocalAppPersonaCharacterProfileCoverage;
  readonly profileHash: string;
};

export type NimiLocalAppPersonaCharacter = {
  readonly id: string;
  readonly worldId: string;
  readonly schemaVersion: 'realm.persona-character-core/v1';
  readonly contentHash: string;
  readonly contentRevision: number;
  readonly sourceHash: string;
  readonly visibility: NimiLocalAppPersonaCharacterVisibility;
  readonly origin: NimiLocalAppPersonaCharacterOrigin;
  readonly profile: NimiLocalAppPersonaCharacterProfile;
  readonly validity: {
    readonly status: 'valid' | 'invalid';
    readonly issues: readonly NimiLocalAppPersonaCharacterDiagnostic[];
  };
  readonly materializationReadiness: {
    readonly status: 'ready' | 'blocked' | 'invalid';
    readonly blockers: readonly NimiLocalAppPersonaCharacterDiagnostic[];
  };
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NimiLocalAppPersonaCharacterListOwnedInput = {
  readonly worldId?: string;
  readonly visibility?: NimiLocalAppPersonaCharacterWritableVisibility;
  readonly afterId?: string;
  readonly take?: number;
};

export type NimiLocalAppPersonaCharacterListOwnedPage = {
  readonly items: readonly NimiLocalAppPersonaCharacter[];
  readonly nextAfterId?: string;
};

export type NimiLocalAppPersonaCharacterCreateInput = {
  readonly worldId: string;
  readonly visibility: NimiLocalAppPersonaCharacterWritableVisibility;
  readonly origin: NimiLocalAppPersonaCharacterOrigin;
  readonly profile: NimiLocalAppPersonaCharacterProfileInput;
};

export type NimiLocalAppPersonaCharacterReplaceInput = NimiLocalAppPersonaCharacterCreateInput & {
  readonly personaCharacterId: string;
  readonly baseContentHash: string;
};

export type NimiLocalAppPersonaCharacterFailureReason =
  | 'capability-unavailable'
  | 'invalid-input'
  | 'session-invalid'
  | 'access-denied'
  | 'owner-authority-missing'
  | 'not-found'
  | 'content-conflict'
  | 'realm-unavailable'
  | 'rate-limited'
  | 'upstream-failed'
  | 'contract-invalid'
  | 'request-too-large'
  | 'response-too-large';

export type NimiLocalAppPersonaCharacterShell = {
  readonly listOwned: (input: NimiLocalAppPersonaCharacterListOwnedInput) => Promise<unknown>;
  readonly getOwned: (personaCharacterId: string) => Promise<unknown>;
  readonly create: (input: NimiLocalAppPersonaCharacterCreateInput) => Promise<unknown>;
  readonly replace: (input: NimiLocalAppPersonaCharacterReplaceInput) => Promise<unknown>;
};

export type NimiLocalAppPersonaCharacterClient = {
  readonly listOwned: (input?: NimiLocalAppPersonaCharacterListOwnedInput) => Promise<NimiLocalAppPersonaCharacterListOwnedPage>;
  readonly getOwned: (personaCharacterId: string) => Promise<NimiLocalAppPersonaCharacter>;
  readonly create: (input: NimiLocalAppPersonaCharacterCreateInput) => Promise<NimiLocalAppPersonaCharacter>;
  readonly replace: (input: NimiLocalAppPersonaCharacterReplaceInput) => Promise<NimiLocalAppPersonaCharacter>;
  readonly toProfileInput: (profile: NimiLocalAppPersonaCharacterProfile) => NimiLocalAppPersonaCharacterProfileInput;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.r104
export function createNimiLocalAppPersonaCharacterClient(
  shell: NimiLocalAppPersonaCharacterShell,
): NimiLocalAppPersonaCharacterClient {
  assertExactMethodNamespace(shell, ['listOwned', 'getOwned', 'create', 'replace'], 'realm.personaCharacter');
  return Object.freeze({
    listOwned: async (input: NimiLocalAppPersonaCharacterListOwnedInput = {}) => personaCall(async () => {
      assertExactKeys(input, ['worldId', 'visibility', 'afterId', 'take'], 'PersonaCharacter listOwned input');
      const take = input.take === undefined ? DEFAULT_TAKE : boundedTake(input.take);
      const normalized: NimiLocalAppPersonaCharacterListOwnedInput = {
        ...(input.worldId === undefined ? {} : { worldId: inputText(input.worldId, 'worldId') }),
        ...(input.visibility === undefined ? {} : { visibility: writableVisibility(input.visibility) }),
        ...(input.afterId === undefined ? {} : { afterId: inputText(input.afterId, 'afterId') }),
        take,
      };
      const items = projectNimiLocalAppPersonaCharacterList(await shell.listOwned(normalized));
      const last = items.at(-1);
      return Object.freeze({
        items,
        ...(items.length === take && last ? { nextAfterId: last.id } : {}),
      });
    }),
    getOwned: async (personaCharacterId: string) => personaCall(async () => {
      return projectNimiLocalAppPersonaCharacter(await shell.getOwned(inputText(personaCharacterId, 'personaCharacterId')));
    }),
    create: async (input: NimiLocalAppPersonaCharacterCreateInput) => personaCall(async () => {
      validateNimiLocalAppPersonaCharacterWriteInput(input, false);
      return projectNimiLocalAppPersonaCharacter(await shell.create(input));
    }),
    replace: async (input: NimiLocalAppPersonaCharacterReplaceInput) => personaCall(async () => {
      validateNimiLocalAppPersonaCharacterWriteInput(input, true);
      return projectNimiLocalAppPersonaCharacter(await shell.replace(input));
    }),
    toProfileInput: toNimiLocalAppPersonaCharacterProfileInput,
  });
}

export function toNimiLocalAppPersonaCharacterProfileInput(
  profile: NimiLocalAppPersonaCharacterProfile,
): NimiLocalAppPersonaCharacterProfileInput {
  const cloned = freezeClone(profile);
  const object = asRecord(cloned);
  if (!object || !Object.hasOwn(object, 'profileHash') || !Object.hasOwn(object, 'profileCoverage')) {
    projectionInvalid('profile roundtrip input');
  }
  const { profileHash: _profileHash, profileCoverage: _profileCoverage, ...input } = object;
  validateProfile(input, false, false);
  return freezeClone(input) as NimiLocalAppPersonaCharacterProfileInput;
}

async function personaCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const reason = normalizeFailureReason(error) ?? 'contract-invalid';
    return localAppError(
      `PersonaCharacter owner operation failed: ${reason}.`,
      reason,
      'handle_persona_character_owner_failure',
    );
  }
}

function normalizeFailureReason(error: unknown): NimiLocalAppPersonaCharacterFailureReason | null {
  const reason = reasonCodeOf(error);
  if (typeof reason !== 'string') return null;
  const exact = new Set<NimiLocalAppPersonaCharacterFailureReason>([
    'capability-unavailable', 'invalid-input', 'session-invalid', 'access-denied',
    'owner-authority-missing', 'not-found', 'content-conflict', 'realm-unavailable',
    'rate-limited', 'upstream-failed', 'contract-invalid', 'request-too-large', 'response-too-large',
  ]);
  if (exact.has(reason as NimiLocalAppPersonaCharacterFailureReason)) return reason as NimiLocalAppPersonaCharacterFailureReason;
  if (['protected-carrier-required', 'runtime-service-unavailable', 'local-app-operation-unavailable', 'local-app-operation-unsupported'].includes(reason)) return 'capability-unavailable';
  if (['invalid-payload', 'SDK_LOCAL_APP_INPUT_INVALID'].includes(reason)) return 'invalid-input';
  if (['runtime-unauthenticated', 'revoked', 'process-replaced', 'account-changed', 'runtime-restarted', 'local-app-snapshot-unavailable'].includes(reason)) return 'session-invalid';
  if (['runtime-access-denied', 'runtime-permission-denied', 'local-app-access-denied'].includes(reason)) return 'access-denied';
  if (reason === 'local-app-owner-unavailable') return 'owner-authority-missing';
  if (reason === 'runtime-service-untrusted' || reason === 'SDK_LOCAL_APP_PROJECTION_INVALID') return 'contract-invalid';
  if (reason === 'resource-exhausted') return 'response-too-large';
  if (reason === 'app-message-payload-too-large' || reason === 'APP_MESSAGE_PAYLOAD_TOO_LARGE') return 'request-too-large';
  return null;
}

export function validateNimiLocalAppPersonaCharacterWriteInput(
  value: unknown,
  replace: boolean,
): asserts value is NimiLocalAppPersonaCharacterCreateInput | NimiLocalAppPersonaCharacterReplaceInput {
  try {
    const object = closed(value, replace
      ? ['personaCharacterId', 'baseContentHash', 'worldId', 'visibility', 'origin', 'profile']
      : ['worldId', 'visibility', 'origin', 'profile'], 'PersonaCharacter write input');
    const encoded = JSON.stringify(object);
    if (utf8(encoded) > MAX_REQUEST_BYTES) failure('request-too-large');
    if (replace) {
      inputText(object.personaCharacterId, 'personaCharacterId');
      if (!hash(object.baseContentHash)) inputInvalid('baseContentHash');
    }
    inputText(object.worldId, 'worldId');
    writableVisibility(object.visibility);
    validateOrigin(object.origin, true);
    validateProfile(object.profile, false, true);
  } catch (error) {
    if (reasonCodeOf(error) === 'SDK_LOCAL_APP_PROJECTION_INVALID') inputInvalid('write input');
    throw error;
  }
}

export function projectNimiLocalAppPersonaCharacterList(value: unknown): readonly NimiLocalAppPersonaCharacter[] {
  responseBound(value);
  if (!Array.isArray(value) || value.length > MAX_TAKE) projectionInvalid('PersonaCharacter listOwned');
  return Object.freeze(value.map((entry) => projectPersonaCharacter(entry)));
}

export function projectNimiLocalAppPersonaCharacter(value: unknown): NimiLocalAppPersonaCharacter {
  responseBound(value);
  return projectPersonaCharacter(value);
}

function projectPersonaCharacter(value: unknown): NimiLocalAppPersonaCharacter {
  const cloned = freezeClone(value);
  const object = closed(cloned, [
    'id', 'worldId', 'schemaVersion', 'contentHash', 'contentRevision', 'sourceHash', 'visibility',
    'origin', 'profile', 'validity', 'materializationReadiness', 'createdAt', 'updatedAt',
  ], 'PersonaCharacter projection');
  projectionText(object.id, 'id', MAX_IDENTIFIER_BYTES, true);
  projectionText(object.worldId, 'worldId', MAX_IDENTIFIER_BYTES, true);
  if (object.schemaVersion !== 'realm.persona-character-core/v1' || !hash(object.contentHash) ||
    !hash(object.sourceHash) || typeof object.contentRevision !== 'number' || !Number.isSafeInteger(object.contentRevision)
    || object.contentRevision < 0) {
    projectionInvalid('PersonaCharacter canonical fields');
  }
  outputVisibility(object.visibility);
  validateOrigin(object.origin, false);
  validateProfile(object.profile, true, false);
  validateStatus(object.validity, 'validity', 'issues', ['valid', 'invalid']);
  validateStatus(object.materializationReadiness, 'materializationReadiness', 'blockers', ['ready', 'blocked', 'invalid']);
  timestamp(object.createdAt, 'createdAt');
  timestamp(object.updatedAt, 'updatedAt');
  return object as unknown as NimiLocalAppPersonaCharacter;
}

function validateOrigin(value: unknown, input: boolean): void {
  const object = closedAllowed(value,
    ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'],
    ['kind'], 'origin');
  if (!['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(object.kind))) invalid(input, 'origin.kind');
  for (const key of ['parentCharacterId', 'parentWorldId', 'sourceId', 'sourceVersion']) {
    if (object[key] !== undefined) realmOwnedText(object[key], `origin.${key}`, false, input);
  }
  if (object.sourceContentHash !== undefined && !hash(object.sourceContentHash)) invalid(input, 'origin.sourceContentHash');
}

function validateProfile(value: unknown, output: boolean, input: boolean): void {
  const profile = asRecord(value);
  if (!profile || profile.profileSchemaVersion !== 'realm.character-profile-core/v1') invalid(input, 'profile');
  validateDynamicJson(profile, 'profile', input);
  if (!output) {
    if (Object.hasOwn(profile, 'profileHash') || Object.hasOwn(profile, 'profileCoverage')) {
      invalid(input, 'profile output-only fields');
    }
    validateExternalRefs(profile, input);
    validateResourceAuthorityRefs(profile, input);
    return;
  }

  const projected = closedAllowed(profile, [
    'profileSchemaVersion', 'identity', 'presentation', 'narrative', 'interactionProfile',
    'assets', 'authoring', 'capabilities', 'knowledge', 'psychology', 'relationships',
    'profileCoverage', 'profileHash',
  ], [
    'profileSchemaVersion', 'identity', 'presentation', 'narrative', 'interactionProfile',
    'assets', 'authoring', 'profileCoverage', 'profileHash',
  ], 'profile');
  validateProfileIdentity(projected.identity);
  validateProfilePresentation(projected.presentation);
  validateProfileNarrative(projected.narrative);
  validateProfileInteraction(projected.interactionProfile);
  validateProfileAssets(projected.assets);
  validateProfileAuthoring(projected.authoring);
  if (projected.capabilities !== undefined) validateProfileCapabilities(projected.capabilities);
  if (projected.knowledge !== undefined) validateProfileStringLists(projected.knowledge, ['topics', 'constraints'], 'profile.knowledge');
  if (projected.psychology !== undefined) validateProfileStringLists(projected.psychology, ['drives', 'boundaries'], 'profile.psychology');
  if (projected.relationships !== undefined) profileObjectArray(projected.relationships, 'profile.relationships', validateProfileRelationship);
  if (!hash(projected.profileHash)) projectionInvalid('profile.profileHash');
  validateProfileCoverage(projected.profileCoverage);
}

function validateProfileIdentity(value: unknown): void {
  const object = closedAllowed(value, ['name', 'summary', 'handle', 'aliases'], ['name', 'summary'], 'profile.identity');
  realmOwnedText(object.name, 'profile.identity.name', true, false);
  realmOwnedText(object.summary, 'profile.identity.summary', true, false);
  optionalRealmOwnedText(object.handle, 'profile.identity.handle');
  optionalProfileTextArray(object.aliases, 'profile.identity.aliases');
}

function validateProfilePresentation(value: unknown): void {
  const object = closedAllowed(value,
    ['displayName', 'avatarResourceRef', 'profileCoverResourceRef', 'profileLine', 'shortBio'],
    ['displayName'], 'profile.presentation');
  realmOwnedText(object.displayName, 'profile.presentation.displayName', true, false);
  for (const key of ['avatarResourceRef', 'profileCoverResourceRef', 'profileLine', 'shortBio']) {
    optionalRealmOwnedText(object[key], `profile.presentation.${key}`);
  }
  for (const key of ['avatarResourceRef', 'profileCoverResourceRef']) {
    if (object[key] !== undefined && !safeResourceRefId(object[key], true)) projectionInvalid(`profile.presentation.${key}`);
  }
}

function validateProfileNarrative(value: unknown): void {
  const object = closedAllowed(value, ['summary', 'archetype', 'traits', 'milestones'], ['summary'], 'profile.narrative');
  realmOwnedText(object.summary, 'profile.narrative.summary', true, false);
  optionalRealmOwnedText(object.archetype, 'profile.narrative.archetype');
  optionalProfileTextArray(object.traits, 'profile.narrative.traits');
  if (object.milestones !== undefined) profileObjectArray(object.milestones, 'profile.narrative.milestones', (item, path) => {
    const row = closedAllowed(item, ['milestoneId', 'sequence', 'summary', 'title'], ['milestoneId'], path);
    realmOwnedText(row.milestoneId, `${path}.milestoneId`, true, false);
    if (row.sequence !== undefined && (typeof row.sequence !== 'number' || !Number.isFinite(row.sequence))) projectionInvalid(`${path}.sequence`);
    optionalRealmOwnedText(row.summary, `${path}.summary`);
    optionalRealmOwnedText(row.title, `${path}.title`);
  });
}

function validateProfileInteraction(value: unknown): void {
  const object = closedAllowed(value,
    ['interactionModes', 'cadence', 'greeting', 'greetingVariants', 'scenario', 'tone', 'dialogueExemplars'],
    ['interactionModes'], 'profile.interactionProfile');
  profileTextArray(object.interactionModes, 'profile.interactionProfile.interactionModes');
  for (const key of ['cadence', 'greeting', 'scenario', 'tone']) {
    optionalRealmOwnedText(object[key], `profile.interactionProfile.${key}`);
  }
  optionalProfileTextArray(object.greetingVariants, 'profile.interactionProfile.greetingVariants');
  if (object.dialogueExemplars !== undefined) profileObjectArray(object.dialogueExemplars, 'profile.interactionProfile.dialogueExemplars', (item, path) => {
    const row = closedAllowed(item, ['exemplarId', 'character', 'user'], ['exemplarId', 'character'], path);
    realmOwnedText(row.exemplarId, `${path}.exemplarId`, true, false);
    realmOwnedText(row.character, `${path}.character`, true, false);
    optionalRealmOwnedText(row.user, `${path}.user`);
  });
}

function validateProfileAssets(value: unknown): void {
  const object = closedAllowed(value, ['resourceRefs', 'intents', 'externalRefs'], ['resourceRefs', 'intents'], 'profile.assets');
  profileObjectArray(object.resourceRefs, 'profile.assets.resourceRefs', (item, path) => {
    const row = closedAllowed(item, ['refId', 'kind', 'label', 'purpose'], ['refId', 'kind'], path);
    realmOwnedText(row.refId, `${path}.refId`, true, false);
    if (!safeResourceRefId(row.refId, false)) projectionInvalid(`${path}.refId`);
    realmOwnedText(row.kind, `${path}.kind`, true, false);
    optionalRealmOwnedText(row.label, `${path}.label`);
    optionalRealmOwnedText(row.purpose, `${path}.purpose`);
  });
  profileObjectArray(object.intents, 'profile.assets.intents', (item, path) => {
    const row = closedAllowed(item, ['intentId', 'kind', 'summary'], ['intentId', 'kind'], path);
    realmOwnedText(row.intentId, `${path}.intentId`, true, false);
    realmOwnedText(row.kind, `${path}.kind`, true, false);
    optionalRealmOwnedText(row.summary, `${path}.summary`);
  });
  if (object.externalRefs !== undefined) profileObjectArray(object.externalRefs, 'profile.assets.externalRefs', (item, path) => {
    const row = closedAllowed(item, ['refId', 'kind', 'uri', 'label', 'purpose'], ['refId', 'kind', 'uri'], path);
    realmOwnedText(row.refId, `${path}.refId`, true, false);
    realmOwnedText(row.kind, `${path}.kind`, true, false);
    optionalRealmOwnedText(row.label, `${path}.label`);
    optionalRealmOwnedText(row.purpose, `${path}.purpose`);
    if (!safeHttps(row.uri)) projectionInvalid(`${path}.uri`);
  });
}

function validateProfileAuthoring(value: unknown): void {
  const object = closedAllowed(value, ['source', 'notes', 'extensions'], ['source'], 'profile.authoring');
  realmOwnedText(object.source, 'profile.authoring.source', true, false);
  optionalProfileTextArray(object.notes, 'profile.authoring.notes');
  if (object.extensions === undefined) return;
  const extensions = asRecord(object.extensions);
  if (!extensions || Object.keys(extensions).length > MAX_ARRAY_ITEMS) projectionInvalid('profile.authoring.extensions');
  for (const [key, value] of Object.entries(extensions)) {
    realmOwnedText(key, `profile.authoring.extensions.${key}`, false, false);
    const row = closed(value,
      ['extensionSchemaVersion', 'namespace', 'productSemantic', 'fields'],
      `profile.authoring.extensions.${key}`);
    realmOwnedText(row.extensionSchemaVersion, `${key}.extensionSchemaVersion`, false, false);
    realmOwnedText(row.namespace, `${key}.namespace`, false, false);
    if (typeof row.productSemantic !== 'boolean') projectionInvalid(`${key}.productSemantic`);
    const fields = asRecord(row.fields);
    if (!fields) projectionInvalid(`${key}.fields`);
    validateDynamicJson(fields, `${key}.fields`, false);
  }
}

function validateProfileCapabilities(value: unknown): void {
  const object = closedAllowed(value, ['tools'], [], 'profile.capabilities');
  if (object.tools === undefined) return;
  profileObjectArray(object.tools, 'profile.capabilities.tools', (item, path) => {
    const row = closedAllowed(item, ['toolId', 'name', 'summary'], ['toolId'], path);
    realmOwnedText(row.toolId, `${path}.toolId`, true, false);
    optionalRealmOwnedText(row.name, `${path}.name`);
    optionalRealmOwnedText(row.summary, `${path}.summary`);
  });
}

function validateProfileStringLists(value: unknown, keys: readonly string[], path: string): void {
  const object = closedAllowed(value, [...keys], [], path);
  for (const key of keys) optionalProfileTextArray(object[key], `${path}.${key}`);
}

function validateProfileRelationship(value: unknown, path: string): void {
  const object = closedAllowed(value,
    ['relationshipId', 'relationType', 'summary', 'targetRef'],
    ['relationshipId', 'relationType', 'targetRef'], path);
  realmOwnedText(object.relationshipId, `${path}.relationshipId`, true, false);
  realmOwnedText(object.relationType, `${path}.relationType`, true, false);
  optionalRealmOwnedText(object.summary, `${path}.summary`);
  const target = closed(object.targetRef, ['kind', 'worldId', 'entityId'], `${path}.targetRef`);
  if (target.kind !== 'worldEntity') projectionInvalid(`${path}.targetRef.kind`);
  realmOwnedText(target.worldId, `${path}.targetRef.worldId`, true, false);
  realmOwnedText(target.entityId, `${path}.targetRef.entityId`, true, false);
}

function validateProfileCoverage(value: unknown): void {
  const object = closed(value, [
    'manifestSchemaVersion', 'requiredSections', 'optionalSections', 'requiredRefs', 'optionalRefs',
    'diagnostics', 'aggregateStatus', 'profileCoverageHash',
  ], 'profile.profileCoverage');
  if (object.manifestSchemaVersion !== 'realm.character-profile-coverage/v1'
    || !['complete', 'incomplete', 'invalid'].includes(String(object.aggregateStatus))
    || !hash(object.profileCoverageHash)) projectionInvalid('profile.profileCoverage');
  for (const key of ['requiredSections', 'optionalSections']) {
    profileObjectArray(object[key], `profile.profileCoverage.${key}`, (item, path) => {
      const row = closed(item, ['path', 'state'], path);
      realmOwnedText(row.path, `${path}.path`, true, false);
      if (!['present', 'missing', 'empty', 'invalid'].includes(String(row.state))) projectionInvalid(`${path}.state`);
    });
  }
  for (const key of ['requiredRefs', 'optionalRefs']) {
    profileObjectArray(object[key], `profile.profileCoverage.${key}`, (item, path) => {
      const row = closed(item, ['path', 'refKind', 'refId', 'state'], path);
      realmOwnedText(row.path, `${path}.path`, true, false);
      realmOwnedText(row.refKind, `${path}.refKind`, true, false);
      realmOwnedText(row.refId, `${path}.refId`, false, false);
      if (!['resolved', 'missing', 'empty', 'invalid'].includes(String(row.state))) projectionInvalid(`${path}.state`);
    });
  }
  profileObjectArray(object.diagnostics, 'profile.profileCoverage.diagnostics', (item, path) => {
    const row = closed(item, ['path', 'code', 'message'], path);
    realmOwnedText(row.path, `${path}.path`, true, false);
    realmOwnedText(row.code, `${path}.code`, true, false);
    realmOwnedText(row.message, `${path}.message`, true, false);
  });
}

function validateExternalRefs(profile: Record<string, unknown>, input: boolean): void {
  if (profile.assets === undefined) return;
  const assets = asRecord(profile.assets);
  if (!assets) invalid(input, 'profile.assets');
  if (assets.externalRefs === undefined) return;
  if (!Array.isArray(assets.externalRefs) || assets.externalRefs.length > MAX_ARRAY_ITEMS) invalid(input, 'profile.assets.externalRefs');
  assets.externalRefs.forEach((value, index) => {
    const row = asRecord(value);
    if (!row || !safeHttps(row.uri)) invalid(input, `profile.assets.externalRefs[${index}].uri`);
  });
}

function validateResourceAuthorityRefs(profile: Record<string, unknown>, input: boolean): void {
  const presentation = asRecord(profile.presentation);
  if (presentation) {
    for (const key of ['avatarResourceRef', 'profileCoverResourceRef']) {
      if (presentation[key] !== undefined && !safeResourceRefId(presentation[key], true)) {
        invalid(input, `profile.presentation.${key}`);
      }
    }
  }
  const assets = asRecord(profile.assets);
  if (!assets || !Array.isArray(assets.resourceRefs)) return;
  assets.resourceRefs.forEach((value, index) => {
    const row = asRecord(value);
    if (row?.refId !== undefined && !safeResourceRefId(row.refId, false)) {
      invalid(input, `profile.assets.resourceRefs[${index}].refId`);
    }
  });
}

function profileObjectArray(value: unknown, path: string, validate: (item: unknown, path: string) => void): void {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) projectionInvalid(path);
  value.forEach((item, index) => validate(item, `${path}[${index}]`));
}

function profileTextArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length > MAX_ARRAY_ITEMS) projectionInvalid(path);
  value.forEach((item, index) => realmOwnedText(item, `${path}[${index}]`, false, false));
}

function optionalProfileTextArray(value: unknown, path: string): void {
  if (value !== undefined) profileTextArray(value, path);
}

function optionalRealmOwnedText(value: unknown, path: string): void {
  if (value !== undefined) realmOwnedText(value, path, false, false);
}

function validateStatus(value: unknown, path: string, listKey: string, statuses: readonly string[]): void {
  const object = closed(value, ['status', listKey], path);
  if (!statuses.includes(String(object.status)) || !Array.isArray(object[listKey]) || object[listKey].length > MAX_ARRAY_ITEMS) {
    projectionInvalid(path);
  }
  object[listKey].forEach((item, index) => {
    const diagnostic = closed(item, ['path', 'code', 'message'], `${path}.${listKey}[${index}]`);
    realmOwnedText(diagnostic.path, `${path}.path`, true, false);
    realmOwnedText(diagnostic.code, `${path}.code`, true, false);
    realmOwnedText(diagnostic.message, `${path}.message`, true, false);
  });
}

function responseBound(value: unknown): void {
  let encoded: string | undefined;
  try { encoded = JSON.stringify(value); } catch { projectionInvalid('PersonaCharacter response'); }
  if (typeof encoded !== 'string') projectionInvalid('PersonaCharacter response');
  if (utf8(encoded) > MAX_RESPONSE_BYTES) failure('response-too-large');
}

function closed(value: unknown, keys: string[], path: string): Record<string, unknown> {
  return closedAllowed(value, keys, keys, path);
}

function closedAllowed(value: unknown, allowed: string[], required: string[], path: string): Record<string, unknown> {
  const object = asRecord(value);
  if (!object || Object.keys(object).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(object, key))) projectionInvalid(path);
  return object;
}

function validateDynamicJson(value: unknown, path: string, input: boolean, depth = 0, state = { nodes: 0 }): void {
  state.nodes += 1;
  if (depth > MAX_DEPTH || state.nodes > MAX_NODES) invalid(input, path);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(input, path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) invalid(input, path);
    value.forEach((item, index) => validateDynamicJson(item, `${path}[${index}]`, input, depth + 1, state));
    return;
  }
  const object = asRecord(value);
  if (!object || Object.keys(object).length > MAX_ARRAY_ITEMS) invalid(input, path);
  Object.entries(object).forEach(([key, child]) => {
    validateDynamicJson(child, `${path}.${key}`, input, depth + 1, state);
  });
}

function reasonCodeOf(error: unknown): unknown {
  return error && typeof error === 'object' && 'reasonCode' in error
    ? (error as { readonly reasonCode?: unknown }).reasonCode
    : undefined;
}

function inputText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !value || utf8(value) > MAX_IDENTIFIER_BYTES || /[\u0000-\u001f\u007f]/u.test(value)) inputInvalid(path);
  return value;
}

function realmOwnedText(value: unknown, path: string, nonempty: boolean, input: boolean): string {
  if (typeof value !== 'string' || (nonempty && value.trim().length === 0)) invalid(input, path);
  return value;
}

function projectionText(value: unknown, path: string, max: number, nonempty: boolean): string {
  if (typeof value !== 'string' || value.trim() !== value || (nonempty && !value) || utf8(value) > max || /[\u0000-\u001f\u007f]/u.test(value)) projectionInvalid(path);
  return value;
}

function boundedTake(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_TAKE) inputInvalid('take');
  return value;
}

function writableVisibility(value: unknown): NimiLocalAppPersonaCharacterWritableVisibility {
  if (!['private', 'unlisted', 'public'].includes(String(value))) inputInvalid('visibility');
  return value as NimiLocalAppPersonaCharacterWritableVisibility;
}

function outputVisibility(value: unknown): void {
  if (!['private', 'unlisted', 'public', 'system'].includes(String(value))) projectionInvalid('visibility');
}

function hash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function timestamp(value: unknown, path: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) projectionInvalid(path);
}

function safeHttps(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value.trim() !== value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname) && !parsed.username && !parsed.password && !parsed.hash
      && !ENCODED_CREDENTIAL_SEPARATOR.test(value)
      && ![...parsed.searchParams.keys()].some((name) => CREDENTIAL_QUERY_PARAMETER.test(name));
  } catch { return false; }
}

function safeResourceRefId(value: unknown, allowEmpty: boolean): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n').normalize('NFC');
  if (normalized.trim().length === 0) return allowEmpty;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(normalized)
    && !/[?&#]/u.test(normalized)
    && !RESOURCE_REF_CREDENTIAL.test(normalized);
}

function freezeClone(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeClone));
  const object = asRecord(value);
  if (object) return Object.freeze(Object.fromEntries(Object.entries(object).map(([key, child]) => [key, freezeClone(child)])));
  return value;
}

function utf8(value: string): number { return new TextEncoder().encode(value).byteLength; }
function invalid(input: boolean, path: string): never { return input ? inputInvalid(path) : projectionInvalid(path); }
function inputInvalid(path: string): never { return localAppError(`PersonaCharacter input is invalid: ${path}.`, 'invalid-input', 'provide_exact_persona_character_input'); }
function projectionInvalid(path: string): never { return localAppProjectionError(`PersonaCharacter ${path}`); }
function failure(reason: NimiLocalAppPersonaCharacterFailureReason): never { return localAppError(`PersonaCharacter owner operation failed: ${reason}.`, reason, 'handle_persona_character_owner_failure'); }
