import {
  NIMI_STANDARD_SHELL_COMMANDS,
  isNimiStandardShellErrorEnvelope,
} from '@nimiplatform/kit/shell/capabilities';
import { BridgeError, invokeChecked } from './invoke.js';
import { listenShell } from './tauri-api.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_PERMISSION_REASON_BYTES = 240;
const MAX_STORAGE_PATH_BYTES = 240;
const MAX_STORAGE_DOCUMENT_BYTES = 256 * 1024;
const MAX_WORLD_CORE_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_TURN_ATTACHMENTS = 1;
const MAX_ARTIFACT_DATA_BYTES = 4 * 1024 * 1024;
const MAX_ARTIFACT_DISPLAY_NAME_BYTES = 512;
const MAX_ARTIFACT_READ_BYTES = 32 * 1024 * 1024;

const FORBIDDEN_PROJECTION_KEYS = new Set([
  'endpoint', 'authorization', 'token', 'localappprincipalid', 'localapprecordid',
  'trustclass', 'provenancerevision', 'launchlease', 'bootstrap', 'processid',
  'sessionid', 'sessionproof', 'accountid', 'grantid', 'runtimebootepoch',
]);

const LOCAL_APP_STATUS_STATES = new Set([
  'authorizing', 'ready', 'denied', 'runtime-unavailable', 'revoked', 'project-changed',
]);
const LOCAL_APP_PERMISSION_STATES = new Set([
  'prompt', 'pending', 'granted', 'denied', 'unavailable',
]);

export type NimiLocalAppSessionStatus = {
  readonly state: 'authorizing' | 'ready' | 'denied' | 'runtime-unavailable' | 'revoked' | 'project-changed';
  readonly reasonCode: string;
  readonly retryable: boolean;
};

export type NimiLocalAppPermissionStatusInput = {
  readonly permissionId: string;
};

export type NimiLocalAppPermissionRequestInput = NimiLocalAppPermissionStatusInput & {
  readonly reason: string;
  readonly requestId: string;
};

export type NimiLocalAppAgentHandle = {
  readonly agentHandle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

export type NimiLocalAppPermissionStatus = {
  readonly state: 'prompt' | 'pending' | 'granted' | 'denied' | 'unavailable';
  readonly permissionId: string;
  readonly canRequest: boolean;
  readonly reasonCode: string;
  readonly agents: readonly NimiLocalAppAgentHandle[];
};

export type NimiLocalAppStorageDocument = {
  readonly value: JsonValue;
  readonly sizeBytes: number;
};

export type NimiLocalAppStorageRemoveResult = {
  readonly removed: boolean;
};

export type NimiLocalAppWorldCoreListInput = {
  readonly take?: number;
  readonly visibility?: 'private' | 'unlisted' | 'public' | 'system';
};

export type NimiLocalAppConversationScopeInput = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
};

export type NimiLocalAppConversationAttachment = {
  readonly artifactId: string;
  readonly displayName?: string;
};

export type NimiLocalAppArtifactPutInput = {
  readonly mimeType: string;
  readonly displayName: string;
  readonly data: Uint8Array;
};

export type NimiLocalAppArtifactReadInput = {
  readonly artifactId: string;
};

export type NimiLocalAppArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
};

export type NimiLocalAppAgentConfigureShell = {
  readonly configurationSnapshot: (input: { readonly agentHandle: string }) => Promise<JsonObject>;
  readonly updateConfiguration: (input: {
    readonly agentHandle: string;
    readonly expectedConfigurationRevision: string;
    readonly intents: readonly unknown[];
    readonly profileOrigin: unknown | null;
  }) => Promise<JsonObject>;
  readonly readinessSnapshot: (input: { readonly agentHandle: string }) => Promise<JsonObject>;
  readonly aiProfilePreview: (input: {
    readonly agentHandle: string;
    readonly profile: unknown;
    readonly runtimeDescriptor: unknown;
  }) => Promise<JsonObject>;
  readonly aiProfileApply: (input: {
    readonly agentHandle: string;
    readonly expectedConfigurationRevision: string;
    readonly profile: unknown;
    readonly runtimeDescriptor: unknown;
  }) => Promise<JsonObject>;
  readonly autonomySnapshot: (input: { readonly agentHandle: string }) => Promise<JsonObject>;
  readonly updateAutonomy: (input: {
    readonly agentHandle: string;
    readonly expectedAutonomyRevision: string;
    readonly intent: unknown;
  }) => Promise<JsonObject>;
  readonly presentationSnapshot: (input: { readonly agentHandle: string }) => Promise<JsonObject>;
  readonly commitPresentation: (input: {
    readonly agentHandle: string;
    readonly expectedPresentationRevision: string;
    readonly intent: unknown;
    readonly importedAssets: readonly {
      readonly role: 'avatar' | 'background';
      readonly fileName: string;
      readonly mediaType: string;
      readonly content: Uint8Array;
      readonly sha256: string;
    }[];
  }) => Promise<JsonObject>;
};

export type NimiLocalAppConversationSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppStandardShellSurface = {
  readonly session: {
    readonly status: () => Promise<NimiLocalAppSessionStatus>;
  };
  readonly permission: {
    readonly status: (input: NimiLocalAppPermissionStatusInput) => Promise<NimiLocalAppPermissionStatus>;
    readonly request: (input: NimiLocalAppPermissionRequestInput) => Promise<NimiLocalAppPermissionStatus>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiLocalAppStorageDocument>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<NimiLocalAppStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiLocalAppStorageRemoveResult>;
  };
  readonly realm: {
    readonly worldCore: {
      readonly list: (input?: NimiLocalAppWorldCoreListInput) => Promise<readonly JsonObject[]>;
      readonly create: (input: unknown) => Promise<JsonObject>;
    };
  };
  readonly agentConfigure: NimiLocalAppAgentConfigureShell;
  readonly conversation: {
    readonly open: (input: {
      readonly agentHandle: string;
    }) => Promise<JsonObject>;
    readonly send: (input: NimiLocalAppConversationScopeInput & {
      readonly requestId: string;
      readonly text: string;
      readonly attachments: readonly NimiLocalAppConversationAttachment[];
    }) => Promise<JsonObject>;
    readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
  };
  readonly artifacts: {
    readonly put: (input: NimiLocalAppArtifactPutInput) => Promise<JsonObject>;
    readonly readBytes: (input: NimiLocalAppArtifactReadInput) => Promise<NimiLocalAppArtifactBytes>;
  };
};

export function createNimiLocalAppStandardShellSurface(): NimiLocalAppStandardShellSurface {
  return {
    session: { status: getNimiLocalAppSessionStatus },
    permission: {
      status: getNimiLocalAppPermissionStatus,
      request: requestNimiLocalAppPermission,
    },
    storage: {
      readJson: readNimiLocalAppStorageJson,
      writeJson: writeNimiLocalAppStorageJson,
      removeJson: removeNimiLocalAppStorageJson,
    },
    realm: {
      worldCore: {
        list: listNimiLocalAppWorldCores,
        create: createNimiLocalAppWorldCore,
      },
    },
    agentConfigure: {
      configurationSnapshot: getNimiLocalAppAgentConfigurationSnapshot,
      updateConfiguration: updateNimiLocalAppAgentConfiguration,
      readinessSnapshot: getNimiLocalAppAgentReadinessSnapshot,
      aiProfilePreview: previewNimiLocalAppAgentAIProfile,
      aiProfileApply: applyNimiLocalAppAgentAIProfile,
      autonomySnapshot: getNimiLocalAppAgentAutonomySnapshot,
      updateAutonomy: updateNimiLocalAppAgentAutonomy,
      presentationSnapshot: getNimiLocalAppAgentPresentationSnapshot,
      commitPresentation: commitNimiLocalAppAgentPresentation,
    },
    conversation: {
      open: openNimiLocalAppConversation,
      send: sendNimiLocalAppConversationTurn,
      interruptTurn: interruptNimiLocalAppConversationTurn,
      subscribe: subscribeNimiLocalAppConversation,
      snapshot: getNimiLocalAppConversationSnapshot,
    },
    artifacts: {
      put: putNimiLocalAppArtifact,
      readBytes: readNimiLocalAppArtifactBytes,
    },
  };
}

export function getNimiLocalAppSessionStatus(): Promise<NimiLocalAppSessionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'];
  return invokeChecked(command, {}, (value) => parseSessionStatus(value, command));
}

export function getNimiLocalAppPermissionStatus(
  input: NimiLocalAppPermissionStatusInput,
): Promise<NimiLocalAppPermissionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionStatus'];
  assertExactInput(input, ['permissionId'], command);
  const permissionId = requiredText(input.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH);
  return invokeChecked(
    command,
    { payload: { permissionId } },
    (value) => parsePermissionStatus(value, permissionId, command),
  );
}

export function requestNimiLocalAppPermission(
  input: NimiLocalAppPermissionRequestInput,
): Promise<NimiLocalAppPermissionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'];
  assertExactInput(input, ['permissionId', 'reason', 'requestId'], command);
  const permissionId = requiredText(input.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH);
  return invokeChecked(
    command,
    { payload: {
      permissionId,
      reason: requiredUtf8Text(input.reason, 'reason', command, MAX_PERMISSION_REASON_BYTES),
      requestId: requiredText(input.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
    } },
    (value) => parsePermissionStatus(value, permissionId, command),
  );
}

export function listNimiLocalAppWorldCores(
  input: NimiLocalAppWorldCoreListInput = {},
): Promise<readonly JsonObject[]> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreList'];
  assertAllowedInputKeys(input, ['take', 'visibility'], [], command);
  const payload: JsonObject = {};
  if (input.take !== undefined) payload.take = nonNegativeInteger(input.take, command, 'take');
  if (input.visibility !== undefined) payload.visibility = worldVisibility(input.visibility, command);
  return invokeChecked(command, { payload }, (value) => {
    if (!Array.isArray(value)) throw new Error(`${command}: result must be an array`);
    return Object.freeze(value.map((entry) => Object.freeze(parseSafeProjection(entry, command))));
  });
}

export function createNimiLocalAppWorldCore(input: unknown): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmWorldCoreCreate'];
  const record = assertRecord(input, `${command}: input must be an object`);
  assertAllowedInputKeys(record, ['core', 'id', 'origin', 'visibility'], ['core', 'origin'], command);
  const core = assertRecord(record.core, `${command}: core must be an object`);
  const origin = assertRecord(record.origin, `${command}: origin must be an object`);
  assertAllowedInputKeys(
    origin,
    ['kind', 'parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion'],
    ['kind'],
    command,
  );
  if (!['manual', 'forge', 'worldCharacterDerivation', 'import', 'system'].includes(String(origin.kind))) {
    throw invalidInput(command, 'origin.kind is invalid');
  }
  for (const key of ['parentCharacterId', 'parentWorldId', 'sourceContentHash', 'sourceId', 'sourceVersion']) {
    if (origin[key] !== undefined) requiredText(origin[key], `origin.${key}`, command, MAX_IDENTIFIER_LENGTH);
  }
  if (record.id !== undefined) requiredText(record.id, 'id', command, MAX_IDENTIFIER_LENGTH);
  if (record.visibility !== undefined) worldVisibility(record.visibility, command);
  validateStorageJsonValue(core, command);
  const encoded = JSON.stringify(record);
  if (new TextEncoder().encode(encoded).byteLength > MAX_WORLD_CORE_REQUEST_BYTES) {
    throw invalidInput(command, 'world core exceeds the request bound');
  }
  return invokeChecked(
    command,
    { payload: record },
    (value) => Object.freeze(parseSafeProjection(value, command)),
  );
}

export function getNimiLocalAppAgentConfigurationSnapshot(input: { readonly agentHandle: string }): Promise<JsonObject> {
  return invokeAgentConfigureHandle('local-app.agentConfigurationSnapshot', input);
}

export function updateNimiLocalAppAgentConfiguration(input: {
  readonly agentHandle: string;
  readonly expectedConfigurationRevision: string;
  readonly intents: readonly unknown[];
  readonly profileOrigin: unknown | null;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentUpdateConfiguration'];
  assertExactInput(input, ['agentHandle', 'expectedConfigurationRevision', 'intents', 'profileOrigin'], command);
  if (!Array.isArray(input.intents) || input.intents.length === 0) throw invalidInput(command, 'intents is invalid');
  validateProjectionValue(input.intents as JsonValue, command);
  validateProjectionValue(input.profileOrigin as JsonValue, command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    expectedConfigurationRevision: decimalRevision(input.expectedConfigurationRevision, 'expectedConfigurationRevision', command, false),
    intents: input.intents as JsonValue,
    profileOrigin: input.profileOrigin as JsonValue,
  });
}

export function getNimiLocalAppAgentReadinessSnapshot(input: { readonly agentHandle: string }): Promise<JsonObject> {
  return invokeAgentConfigureHandle('local-app.agentReadinessSnapshot', input);
}

export function previewNimiLocalAppAgentAIProfile(input: {
  readonly agentHandle: string;
  readonly profile: unknown;
  readonly runtimeDescriptor: unknown;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentAIProfilePreview'];
  assertExactInput(input, ['agentHandle', 'profile', 'runtimeDescriptor'], command);
  validateProjectionValue(input.profile as JsonValue, command);
  validateProjectionValue(input.runtimeDescriptor as JsonValue, command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    profile: input.profile as JsonValue,
    runtimeDescriptor: input.runtimeDescriptor as JsonValue,
  });
}

export function applyNimiLocalAppAgentAIProfile(input: {
  readonly agentHandle: string;
  readonly expectedConfigurationRevision: string;
  readonly profile: unknown;
  readonly runtimeDescriptor: unknown;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentAIProfileApply'];
  assertExactInput(input, ['agentHandle', 'expectedConfigurationRevision', 'profile', 'runtimeDescriptor'], command);
  validateProjectionValue(input.profile as JsonValue, command);
  validateProjectionValue(input.runtimeDescriptor as JsonValue, command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    expectedConfigurationRevision: decimalRevision(input.expectedConfigurationRevision, 'expectedConfigurationRevision', command, false),
    profile: input.profile as JsonValue,
    runtimeDescriptor: input.runtimeDescriptor as JsonValue,
  });
}

export function getNimiLocalAppAgentAutonomySnapshot(input: { readonly agentHandle: string }): Promise<JsonObject> {
  return invokeAgentConfigureHandle('local-app.agentAutonomySnapshot', input);
}

export function updateNimiLocalAppAgentAutonomy(input: {
  readonly agentHandle: string;
  readonly expectedAutonomyRevision: string;
  readonly intent: unknown;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentUpdateAutonomy'];
  assertExactInput(input, ['agentHandle', 'expectedAutonomyRevision', 'intent'], command);
  validateProjectionValue(input.intent as JsonValue, command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    expectedAutonomyRevision: decimalRevision(input.expectedAutonomyRevision, 'expectedAutonomyRevision', command, false),
    intent: input.intent as JsonValue,
  });
}

export function getNimiLocalAppAgentPresentationSnapshot(input: { readonly agentHandle: string }): Promise<JsonObject> {
  return invokeAgentConfigureHandle('local-app.agentPresentationSnapshot', input);
}

export function commitNimiLocalAppAgentPresentation(input: {
  readonly agentHandle: string;
  readonly expectedPresentationRevision: string;
  readonly intent: unknown;
  readonly importedAssets: readonly {
    readonly role: 'avatar' | 'background';
    readonly fileName: string;
    readonly mediaType: string;
    readonly content: Uint8Array;
    readonly sha256: string;
  }[];
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentCommitPresentation'];
  assertExactInput(input, ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'], command);
  validateProjectionValue(input.intent as JsonValue, command);
  const importedAssets = input.importedAssets.map((asset) => ({
    role: asset.role,
    fileName: asset.fileName,
    mediaType: asset.mediaType,
    content: Array.from(asset.content),
    sha256: asset.sha256,
  }));
  validateProjectionValue(importedAssets as JsonValue, command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    expectedPresentationRevision: decimalRevision(input.expectedPresentationRevision, 'expectedPresentationRevision', command, true),
    intent: input.intent as JsonValue,
    importedAssets: importedAssets as JsonValue,
  });
}

function invokeAgentConfigureHandle(
  operation: 'local-app.agentConfigurationSnapshot' | 'local-app.agentReadinessSnapshot' | 'local-app.agentAutonomySnapshot' | 'local-app.agentPresentationSnapshot',
  input: { readonly agentHandle: string },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS[operation];
  assertExactInput(input, ['agentHandle'], command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
  });
}

export function openNimiLocalAppConversation(input: {
  readonly agentHandle: string;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationOpen'];
  return invokeLocalAppRecord(
    command,
    identifiers(input, ['agentHandle'], command),
  );
}

export function sendNimiLocalAppConversationTurn(input: NimiLocalAppConversationScopeInput & {
  readonly requestId: string;
  readonly text: string;
  readonly attachments: readonly NimiLocalAppConversationAttachment[];
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'requestId', 'text', 'attachments'], command);
  const attachments = turnAttachments(input.attachments, command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    requestId: requiredText(input.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
    text: turnText(input.text, attachments.length > 0, command),
    attachments,
  });
}

export function putNimiLocalAppArtifact(input: NimiLocalAppArtifactPutInput): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactPut'];
  assertExactInput(input, ['mimeType', 'displayName', 'data'], command);
  if (typeof input.displayName !== 'string'
    || input.displayName.trim() !== input.displayName
    || new TextEncoder().encode(input.displayName).byteLength > MAX_ARTIFACT_DISPLAY_NAME_BYTES) {
    throw invalidInput(command, 'displayName is invalid');
  }
  if (!(input.data instanceof Uint8Array)
    || input.data.byteLength === 0
    || input.data.byteLength > MAX_ARTIFACT_DATA_BYTES) {
    throw invalidInput(command, 'data is invalid');
  }
  return invokeLocalAppRecord(command, {
    mimeType: requiredText(input.mimeType, 'mimeType', command, MAX_IDENTIFIER_LENGTH),
    displayName: input.displayName,
    data: input.data as unknown as JsonValue,
  });
}

export function readNimiLocalAppArtifactBytes(
  input: NimiLocalAppArtifactReadInput,
): Promise<NimiLocalAppArtifactBytes> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactReadBytes'];
  assertExactInput(input, ['artifactId'], command);
  const artifactId = requiredText(input.artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH);
  return invokeChecked(command, { payload: { artifactId } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['bytes', 'mimeType'])) {
      throw new Error(`${command}: result fields must be bytes, mimeType`);
    }
    if (!(record.bytes instanceof Uint8Array)
      || record.bytes.byteLength === 0
      || record.bytes.byteLength > MAX_ARTIFACT_READ_BYTES) {
      throw new Error(`${command}: result bytes are invalid`);
    }
    return {
      bytes: record.bytes,
      mimeType: parseRequiredString(record.mimeType, 'mimeType', command),
    };
  });
}

function turnAttachments(
  value: readonly NimiLocalAppConversationAttachment[],
  command: string,
): JsonObject[] {
  if (!Array.isArray(value) || value.length > MAX_TURN_ATTACHMENTS) {
    throw invalidInput(command, 'attachments is invalid');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw invalidInput(command, 'attachments entry is invalid');
    }
    assertAllowedInputKeys(entry, ['artifactId', 'displayName'], ['artifactId'], command);
    const attachment: JsonObject = {
      artifactId: requiredText(entry.artifactId, 'attachments.artifactId', command, MAX_IDENTIFIER_LENGTH),
    };
    if (entry.displayName !== undefined) {
      attachment.displayName = requiredText(entry.displayName, 'attachments.displayName', command, MAX_IDENTIFIER_LENGTH);
    }
    return attachment;
  });
}

function turnText(value: unknown, allowEmpty: boolean, command: string): string {
  if (allowEmpty && value === '') return '';
  return requiredUtf8Text(value, 'text', command, 64 * 1024);
}

export function interruptNimiLocalAppConversationTurn(
  input: NimiLocalAppConversationScopeInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationInterruptTurn'];
  return invokeLocalAppRecord(
    command,
    identifiers(input, ['agentHandle', 'conversationAnchorId'], command),
  );
}

export async function subscribeNimiLocalAppConversation(
  input: NimiLocalAppConversationScopeInput,
): Promise<NimiLocalAppConversationSubscription> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSubscribe'];
  const scope = identifiers(input, ['agentHandle', 'conversationAnchorId'], command);
  const opened = await invokeChecked(command, { payload: scope }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    assertProjectionKeys(record, ['subscriptionId', 'eventName'], command, 'conversation subscription');
    return {
      subscriptionId: requiredText(record.subscriptionId, 'subscriptionId', command, MAX_IDENTIFIER_LENGTH),
      eventName: requiredText(record.eventName, 'eventName', command, MAX_IDENTIFIER_LENGTH),
    };
  });
  const subscription = new LocalAppConversationEventSubscription(command, opened.subscriptionId);
  try {
    subscription.attach(await listenShell(opened.eventName, ({ payload }) => subscription.accept(payload)));
  } catch (error) {
    await subscription.cancel().catch(() => undefined);
    throw error;
  }
  return subscription;
}

export function getNimiLocalAppConversationSnapshot(
  input: NimiLocalAppConversationScopeInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSnapshot'];
  return invokeLocalAppRecord(
    command,
    identifiers(input, ['agentHandle', 'conversationAnchorId'], command),
  );
}

export function readNimiLocalAppStorageJson(relativePath: string): Promise<NimiLocalAppStorageDocument> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'];
  const normalizedPath = canonicalStoragePath(relativePath, command);
  return invokeChecked(
    command,
    { payload: { relativePath: normalizedPath } },
    (value) => parseStorageDocument(value, command),
  );
}

export function writeNimiLocalAppStorageJson(
  relativePath: string,
  value: JsonValue,
): Promise<NimiLocalAppStorageDocument> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'];
  const normalizedPath = canonicalStoragePath(relativePath, command);
  validateStorageJsonValue(value, command);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_STORAGE_DOCUMENT_BYTES) {
    throw new Error(`${command}: value exceeds the JSON document bound`);
  }
  return invokeChecked(
    command,
    { payload: { relativePath: normalizedPath, value } },
    (result) => parseStorageDocument(result, command),
  );
}

export function removeNimiLocalAppStorageJson(relativePath: string): Promise<NimiLocalAppStorageRemoveResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'];
  const normalizedPath = canonicalStoragePath(relativePath, command);
  return invokeChecked(command, { payload: { relativePath: normalizedPath } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    assertProjectionKeys(record, ['removed'], command, 'storage remove result');
    if (typeof record.removed !== 'boolean') throw new Error(`${command}: removed is invalid`);
    return { removed: record.removed };
  });
}

class LocalAppConversationEventSubscription implements NimiLocalAppConversationSubscription {
  readonly events: AsyncIterable<unknown> = this;
  private readonly queued: unknown[] = [];
  private readonly waiting: Array<{
    resolve: (result: IteratorResult<unknown>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private unlisten: (() => void) | undefined;
  private terminalError: unknown;
  private done = false;
  private remoteCompleted = false;
  private cancelPromise: Promise<void> | undefined;

  constructor(
    private readonly command: string,
    private readonly subscriptionId: string,
  ) {}

  attach(unlisten: () => void): void {
    if (this.done) unlisten();
    else this.unlisten = unlisten;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => this.next(),
      return: async () => {
        await this.cancel();
        return { done: true, value: undefined };
      },
    };
  }

  cancel(): Promise<void> {
    if (this.cancelPromise) return this.cancelPromise;
    if (this.remoteCompleted) {
      this.cancelPromise = Promise.resolve();
      return this.cancelPromise;
    }
    this.finish();
    this.cancelPromise = invokeChecked(
      this.command,
      { payload: { action: 'cancel', subscriptionId: this.subscriptionId } },
      (value) => {
        const record = assertRecord(value, `${this.command} returned invalid cancel payload`);
        assertProjectionKeys(record, ['subscriptionId', 'closed'], this.command, 'conversation cancel');
        if (record.subscriptionId !== this.subscriptionId || typeof record.closed !== 'boolean') {
          throw new Error(`${this.command}: conversation cancel projection is invalid`);
        }
      },
    );
    return this.cancelPromise;
  }

  accept(value: unknown): void {
    if (this.done) return;
    try {
      const record = assertRecord(value, `${this.command} emitted invalid payload`);
      if (record.subscriptionId !== this.subscriptionId) {
        throw new Error(`${this.command}: subscription binding is invalid`);
      }
      if (record.eventType === 'completed') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType'], this.command, 'conversation completion');
        this.remoteCompleted = true;
        this.finish();
        return;
      }
      if (record.eventType === 'error') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType', 'error'], this.command, 'conversation error');
        this.fail(parseConversationStreamError(record.error, this.command));
        return;
      }
      if (record.eventType !== 'next') throw new Error(`${this.command}: conversation event type is invalid`);
      assertProjectionKeys(record, ['subscriptionId', 'eventType', 'event'], this.command, 'conversation event');
      const event = parseSafeProjection(record.event, this.command);
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve({ done: false, value: event });
      else if (this.queued.length < 32) this.queued.push(event);
      else {
        const error = new BridgeError('Local-app conversation event buffer is exhausted', this.command, {
          code: 'resource-exhausted',
          reasonCode: 'renderer-local-app-conversation-buffer-exhausted',
          actionHint: 'consume_or_cancel_conversation_subscription',
          source: 'renderer',
        });
        this.fail(error);
        void this.cancel().catch(() => undefined);
      }
    } catch (error) {
      this.fail(error instanceof BridgeError ? error : new BridgeError(
        error instanceof Error ? error.message : 'Local-app conversation event is invalid',
        this.command,
        {
          code: 'invalid-payload',
          reasonCode: 'renderer-standard-shell-result-invalid',
          actionHint: 'inspect_standard_shell_host_result',
          source: 'renderer',
        },
      ));
    }
  }

  private next(): Promise<IteratorResult<unknown>> {
    if (this.queued.length > 0) {
      return Promise.resolve({ done: false, value: this.queued.shift() });
    }
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const waiter of this.waiting.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  private fail(error: unknown): void {
    if (this.done) return;
    this.terminalError = error;
    this.done = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }
}

function parseConversationStreamError(value: unknown, command: string): BridgeError {
  const envelope = assertRecord(value, `${command} emitted invalid error`);
  if (!isNimiStandardShellErrorEnvelope(envelope)) {
    throw new Error(`${command}: conversation error envelope is invalid`);
  }
  return new BridgeError(envelope.reasonCode, command, envelope);
}

function invokeLocalAppRecord(command: string, payload: JsonObject): Promise<JsonObject> {
  return invokeChecked(command, { payload }, (value) => parseSafeProjection(value, command));
}

function parseSessionStatus(value: unknown, command: string): NimiLocalAppSessionStatus {
  const record = parseSafeProjection(value, command);
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['reasonCode', 'retryable', 'state'])) {
    throw new Error(`${command}: result fields must be state, reasonCode, retryable`);
  }
  const state = parseRequiredString(record.state, 'state', command);
  const reasonCode = parseRequiredString(record.reasonCode, 'reasonCode', command);
  if (!LOCAL_APP_STATUS_STATES.has(state) || typeof record.retryable !== 'boolean') {
    throw new Error(`${command}: session status projection is invalid`);
  }
  return { state: state as NimiLocalAppSessionStatus['state'], reasonCode, retryable: record.retryable };
}

function parsePermissionStatus(
  value: unknown,
  requestedPermissionId: string,
  command: string,
): NimiLocalAppPermissionStatus {
  const record = parseSafeProjection(value, command);
  assertProjectionKeys(
    record,
    ['state', 'permissionId', 'canRequest', 'reasonCode', 'agents'],
    command,
    'permission status',
  );
  const state = requiredText(record.state, 'state', command, MAX_IDENTIFIER_LENGTH);
  const permissionId = requiredText(record.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH);
  const reasonCode = requiredText(record.reasonCode, 'reasonCode', command, MAX_IDENTIFIER_LENGTH);
  if (!LOCAL_APP_PERMISSION_STATES.has(state)
    || permissionId !== requestedPermissionId
    || typeof record.canRequest !== 'boolean'
    || record.canRequest !== (state === 'prompt')
    || !Array.isArray(record.agents)
    || (state !== 'granted' && record.agents.length > 0)) {
    throw new Error(`${command}: permission status projection is invalid`);
  }
  const seen = new Set<string>();
  const agents = record.agents.map((value) => {
    const agent = assertRecord(value, `${command} returned invalid agent handle`);
    assertProjectionKeys(agent, ['agentHandle', 'displayName', 'avatarUrl'], command, 'permission agent');
    const agentHandle = requiredText(agent.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH);
    const displayName = requiredUtf8Text(agent.displayName, 'displayName', command, 240);
    const avatarUrl = stableAvatarUrlOrNull(agent.avatarUrl, command);
    if (seen.has(agentHandle)) throw new Error(`${command}: permission agent handle is duplicated`);
    seen.add(agentHandle);
    return Object.freeze({ agentHandle, displayName, avatarUrl });
  });
  return Object.freeze({
    state: state as NimiLocalAppPermissionStatus['state'],
    permissionId,
    canRequest: record.canRequest,
    reasonCode,
    agents: Object.freeze(agents),
  });
}

function parseStorageDocument(value: unknown, command: string): NimiLocalAppStorageDocument {
  const record = assertRecord(value, `${command} returned invalid payload`);
  assertProjectionKeys(record, ['value', 'sizeBytes'], command, 'storage document');
  const sizeBytes = nonNegativeInteger(record.sizeBytes, command, 'sizeBytes');
  if (sizeBytes > MAX_STORAGE_DOCUMENT_BYTES) throw new Error(`${command}: sizeBytes exceeds the document bound`);
  validateStorageJsonValue(record.value, command);
  return { value: record.value as JsonValue, sizeBytes };
}

function stableAvatarUrlOrNull(value: unknown, command: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string'
    || !value
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > 4096) {
    throw new Error(`${command}: permission agent avatarUrl is invalid`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${command}: permission agent avatarUrl is invalid`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new Error(`${command}: permission agent avatarUrl is invalid`);
  }
  return value;
}

function canonicalStoragePath(value: string, command: string): string {
  if (
    !value
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_STORAGE_PATH_BYTES
    || !value.endsWith('.json')
    || value.startsWith('/')
    || /[\\:\0]/u.test(value)
  ) {
    throw new Error(`${command}: relativePath is invalid`);
  }
  for (const segment of value.split('/')) {
    const base = segment.split('.', 1)[0]?.toUpperCase() ?? '';
    if (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.length > 128
      || segment.endsWith('.')
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)
    ) {
      throw new Error(`${command}: relativePath is invalid`);
    }
  }
  return value;
}

function validateStorageJsonValue(value: unknown, command: string, depth = 0, nodes = { value: 0 }): void {
  nodes.value += 1;
  if (depth > 32 || nodes.value > 100_000) throw new Error(`${command}: value exceeds structural bounds`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateStorageJsonValue(entry, command, depth + 1, nodes);
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${command}: value is not JSON-compatible`);
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    validateStorageJsonValue(entry, command, depth + 1, nodes);
  }
}

function parseSafeProjection(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command} returned invalid payload`);
  validateProjectionValue(record, command);
  return record;
}

function validateProjectionValue(value: JsonValue, command: string): void {
  if (value === undefined) throw new Error(`${command}: result cannot contain undefined`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateProjectionValue(entry, command);
    return;
  }
  if (!value || typeof value !== 'object') throw new Error(`${command}: result is not JSON-compatible`);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(normalizeFieldName(key))) {
      throw new Error(`${command}: protected field ${key} is forbidden`);
    }
    validateProjectionValue(entry, command);
  }
}

function assertProjectionKeys(
  record: JsonObject,
  keys: readonly string[],
  command: string,
  label: string,
): void {
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${command}: ${label} fields are invalid`);
  }
}

function nonNegativeInteger(value: unknown, command: string, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${command}: ${field} is invalid`);
  }
  return value;
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function identifiers<T extends object>(
  input: T,
  keys: readonly (keyof T & string)[],
  command: string,
  exactKeys: readonly (keyof T & string)[] = keys,
): JsonObject {
  assertExactInput(input, exactKeys, command);
  return Object.fromEntries(keys.map((key) => [
    key,
    requiredText(input[key], key, command, MAX_IDENTIFIER_LENGTH),
  ]));
}

function assertExactInput<T extends object>(input: T, keys: readonly (keyof T & string)[], command: string): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput(command, 'input must be an object');
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([...keys].sort())) {
    throw invalidInput(command, `input fields must be exactly ${keys.join(', ')}`);
  }
}

function assertAllowedInputKeys(
  input: object,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  command: string,
): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput(command, 'input must be an object');
  const keys = Object.keys(input);
  if (keys.some((key) => !allowedKeys.includes(key))
    || requiredKeys.some((key) => !Object.hasOwn(input, key))) {
    throw invalidInput(command, `input fields must be limited to ${allowedKeys.join(', ')}`);
  }
}

function worldVisibility(value: unknown, command: string): 'private' | 'unlisted' | 'public' | 'system' {
  if (value !== 'private' && value !== 'unlisted' && value !== 'public' && value !== 'system') {
    throw invalidInput(command, 'visibility is invalid');
  }
  return value;
}

function requiredText(value: unknown, field: string, command: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return normalized;
}

function decimalRevision(value: unknown, field: string, command: string, allowZero: boolean): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value) || (!allowZero && value === '0')) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return value;
}

function requiredUtf8Text(value: unknown, field: string, command: string, maxBytes: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || new TextEncoder().encode(normalized).byteLength > maxBytes) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return normalized;
}

function invalidInput(command: string, reason: string): BridgeError {
  return new BridgeError(`Local-app operation input is invalid: ${reason}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-local-app-payload-invalid',
    actionHint: 'send_only_declared_local_app_operation_fields',
    source: 'renderer',
  });
}
