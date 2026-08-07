import {
  NIMI_STANDARD_SHELL_COMMANDS,
  isNimiStandardShellErrorEnvelope,
} from '@nimiplatform/kit/shell/capabilities';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/kit/core/sdk-contract';
import { BridgeError, invokeChecked } from './invoke.js';
import { listenShell } from './tauri-api.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_TEXT_CANDIDATE_MESSAGES = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES = 64 * 1024;
const MAX_TEXT_CANDIDATE_RESULT_BYTES = 256 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS = 4096;
const MAX_STORAGE_PATH_BYTES = 240;
const MAX_STORAGE_DOCUMENT_BYTES = 256 * 1024;
const MAX_WORLD_CORE_REQUEST_BYTES = 2 * 1024 * 1024;

const FORBIDDEN_PROJECTION_KEYS = new Set([
  'endpoint', 'authorization', 'token', 'localappprincipalid', 'localapprecordid',
  'trustclass', 'provenancerevision', 'launchlease', 'bootstrap', 'processid',
  'sessionid', 'sessionproof', 'accountid', 'grantid', 'runtimebootepoch',
]);
const FORBIDDEN_AI_CONFIG_INPUT_KEYS = new Set([
  ...FORBIDDEN_PROJECTION_KEYS,
  'owner', 'appid',
]);
const FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS = new Set([
  ...FORBIDDEN_PROJECTION_KEYS,
  'binding', 'bindingid', 'connectorgrant', 'connectorgrantid', 'custody',
]);

const LOCAL_APP_STATUS_STATES = new Set([
  'authorizing', 'ready', 'denied', 'runtime-unavailable', 'revoked', 'project-changed',
]);

type NimiLocalAppAIConfigIntentInput = {
  readonly capabilityContract: unknown;
  readonly requiredFeatures: unknown;
  readonly defaults?: unknown;
  readonly route: unknown;
};
export type NimiLocalAppCurrentUserDisplay = {
  readonly handle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

export type NimiLocalAppAgentReference = {
  readonly agentHandle: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
};

export type NimiLocalAppCurrentUserStatus = {
  readonly state: 'ready' | 'unavailable';
  readonly value: NimiLocalAppCurrentUserDisplay | null;
  readonly reasonCode: string;
  readonly retryable: boolean;
};

export type NimiLocalAppSessionStatus = {
  readonly state: 'authorizing' | 'ready' | 'denied' | 'runtime-unavailable' | 'revoked' | 'project-changed';
  readonly reasonCode: string;
  readonly retryable: boolean;
  readonly currentUser: NimiLocalAppCurrentUserStatus;
};

export type NimiLocalAppTextCandidateMessage = {
  readonly role: 'system' | 'user';
  readonly text: string;
};

export type NimiLocalAppTextCandidateInput = {
  readonly messages: readonly NimiLocalAppTextCandidateMessage[];
  readonly temperature: number;
  readonly topP: number;
  readonly maxTokens: number;
};

export type NimiLocalAppTextCandidateResult = {
  readonly text: string;
  readonly finishReason: 'stop' | 'length' | 'content-filter';
  readonly traceId: string;
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

export type NimiLocalAppConversationSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppAgentConfigureShellSurface = {
  readonly sharedAIConfig: {
    readonly get: () => Promise<NimiCapabilityAIConfig>;
    readonly overwrite: (
      capabilities: readonly NimiCapabilityAIConfigIntent[],
    ) => Promise<NimiCapabilityAIConfig>;
  };
  readonly autonomy: {
    readonly snapshot: (input: { readonly agentHandle: string }) => Promise<JsonObject>;
    readonly update: (input: {
      readonly agentHandle: string;
      readonly expectedAutonomyRevision: string;
      readonly intent: unknown;
    }) => Promise<JsonObject>;
  };
  readonly presentation: {
    readonly snapshot: (input: { readonly agentHandle: string }) => Promise<JsonObject>;
    readonly commit: (input: {
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
};

export type NimiLocalAppStandardShellSurface = {
  readonly session: {
    readonly status: () => Promise<NimiLocalAppSessionStatus>;
  };
  readonly ai: {
    readonly text: {
      readonly generateCandidate: (
        input: NimiLocalAppTextCandidateInput,
      ) => Promise<NimiLocalAppTextCandidateResult>;
    };
  };
  readonly aiConfig: {
    readonly get: () => Promise<NimiPortableAppAIConfig>;
    readonly overwrite: (
      capabilities: readonly NimiPortableAppAIConfigIntent[],
    ) => Promise<NimiPortableAppAIConfig>;
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
  readonly agents: {
    readonly listReferences: () => Promise<readonly NimiLocalAppAgentReference[]>;
  };
  readonly agentConfigure: NimiLocalAppAgentConfigureShellSurface;
  readonly conversation: {
    readonly open: (input: {
      readonly agentHandle: string;
    }) => Promise<JsonObject>;
    readonly send: (input: NimiLocalAppConversationScopeInput & {
      readonly requestId: string;
      readonly text: string;
    }) => Promise<JsonObject>;
    readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
  };
};

export function createNimiLocalAppStandardShellSurface(): NimiLocalAppStandardShellSurface {
  return {
    session: { status: getNimiLocalAppSessionStatus },
    ai: {
      text: {
        generateCandidate: generateNimiLocalAppTextCandidate,
      },
    },
    aiConfig: {
      get: getNimiLocalAppAIConfig,
      overwrite: overwriteNimiLocalAppAIConfig,
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
    agents: {
      listReferences: listNimiLocalAppAgentReferences,
    },
    agentConfigure: {
      sharedAIConfig: {
        get: getNimiLocalAppSharedAgentAIConfig,
        overwrite: overwriteNimiLocalAppSharedAgentAIConfig,
      },
      autonomy: {
        snapshot: getNimiLocalAppAgentAutonomySnapshot,
        update: updateNimiLocalAppAgentAutonomy,
      },
      presentation: {
        snapshot: getNimiLocalAppAgentPresentationSnapshot,
        commit: commitNimiLocalAppAgentPresentation,
      },
    },
    conversation: {
      open: openNimiLocalAppConversation,
      send: sendNimiLocalAppConversationTurn,
      interruptTurn: interruptNimiLocalAppConversationTurn,
      subscribe: subscribeNimiLocalAppConversation,
      snapshot: getNimiLocalAppConversationSnapshot,
    },
  };
}

export function getNimiLocalAppAIConfig(): Promise<NimiPortableAppAIConfig> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigGet'];
  return invokeChecked(command, {}, (value) => parseAppAIConfig(value, command));
}

export function overwriteNimiLocalAppAIConfig(
  capabilities: readonly NimiPortableAppAIConfigIntent[],
): Promise<NimiPortableAppAIConfig> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigOverwrite'];
  rejectPortableAppAIConfigFields(capabilities, command, true);
  const payload = canonicalAIConfigCapabilities(capabilities, command);
  return invokeChecked(
    command,
    { payload: { capabilities: payload } },
    (value) => parseAppAIConfig(value, command),
  );
}

export function getNimiLocalAppSessionStatus(): Promise<NimiLocalAppSessionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'];
  return invokeChecked(command, {}, (value) => parseSessionStatus(value, command));
}

export function generateNimiLocalAppTextCandidate(
  input: NimiLocalAppTextCandidateInput,
): Promise<NimiLocalAppTextCandidateResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'];
  assertExactInput(input, ['messages', 'temperature', 'topP', 'maxTokens'], command);
  if (!Array.isArray(input.messages)
    || input.messages.length === 0
    || input.messages.length > MAX_TEXT_CANDIDATE_MESSAGES) {
    throw invalidInput(command, 'messages is invalid');
  }
  let promptBytes = 0;
  let sawSystem = false;
  let sawUser = false;
  const messages = input.messages.map((message, index) => {
    assertExactInput(message, ['role', 'text'], command);
    if (message.role === 'system') {
      if (sawSystem || sawUser) throw invalidInput(command, 'system message order is invalid');
      sawSystem = true;
    } else if (message.role === 'user') {
      sawUser = true;
    } else {
      throw invalidInput(command, `messages[${index}].role is invalid`);
    }
    const text = requiredUtf8Text(
      message.text,
      `messages[${index}].text`,
      command,
      MAX_TEXT_CANDIDATE_MESSAGE_BYTES,
    );
    promptBytes += new TextEncoder().encode(message.role).byteLength
      + new TextEncoder().encode(text).byteLength;
    if (promptBytes > MAX_TEXT_CANDIDATE_PROMPT_BYTES) {
      throw invalidInput(command, 'messages exceed the prompt bound');
    }
    return { role: message.role, text };
  });
  if (!sawUser) throw invalidInput(command, 'at least one user message is required');
  const temperature = boundedFiniteNumber(input.temperature, 'temperature', command, 0, 2);
  const topP = boundedFiniteNumber(input.topP, 'topP', command, 0, 1);
  if (!Number.isSafeInteger(input.maxTokens)
    || input.maxTokens < 1
    || input.maxTokens > MAX_TEXT_CANDIDATE_TOKENS) {
    throw invalidInput(command, 'maxTokens is invalid');
  }
  return invokeChecked(
    command,
    { payload: { messages, temperature, topP, maxTokens: input.maxTokens } },
    (value) => parseTextCandidate(value, command),
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

export function listNimiLocalAppAgentReferences(): Promise<readonly NimiLocalAppAgentReference[]> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentReferenceList'];
  return invokeChecked(command, {}, (value) => {
    if (!Array.isArray(value)) throw new Error(`${command}: result must be an array`);
    const seen = new Set<string>();
    return Object.freeze(value.map((entry) => {
      const record = assertRecord(entry, `${command}: reference must be an object`);
      assertProjectionKeys(record, ['agentHandle', 'displayName', 'avatarUrl'], command, 'Agent reference');
      const agentHandle = requiredText(record.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH);
      const displayName = requiredText(record.displayName, 'displayName', command, 256);
      if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(agentHandle) || seen.has(agentHandle)) {
        throw new Error(`${command}: agentHandle is invalid`);
      }
      seen.add(agentHandle);
      const avatarUrl = record.avatarUrl;
      if (avatarUrl !== null && !safeAgentAvatarUrl(avatarUrl)) {
        throw new Error(`${command}: avatarUrl is invalid`);
      }
      return Object.freeze({ agentHandle, displayName, avatarUrl: avatarUrl as string | null });
    }));
  });
}

export function getNimiLocalAppSharedAgentAIConfig(): Promise<NimiCapabilityAIConfig> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet'];
  return invokeChecked(command, {}, (value) => parseSharedAgentAIConfig(value, command));
}

export function overwriteNimiLocalAppSharedAgentAIConfig(
  capabilities: readonly NimiCapabilityAIConfigIntent[],
): Promise<NimiCapabilityAIConfig> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigOverwrite'];
  const payload = canonicalAIConfigCapabilities(capabilities, command);
  return invokeChecked(
    command,
    { payload: { capabilities: payload } },
    (value) => parseSharedAgentAIConfig(value, command),
  );
}

export function getNimiLocalAppAgentAutonomySnapshot(
  input: { readonly agentHandle: string },
): Promise<JsonObject> {
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
    expectedAutonomyRevision: decimalRevision(
      input.expectedAutonomyRevision,
      'expectedAutonomyRevision',
      command,
      false,
    ),
    intent: input.intent as JsonValue,
  });
}

export function getNimiLocalAppAgentPresentationSnapshot(
  input: { readonly agentHandle: string },
): Promise<JsonObject> {
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
  assertExactInput(
    input,
    ['agentHandle', 'expectedPresentationRevision', 'intent', 'importedAssets'],
    command,
  );
  validateProjectionValue(input.intent as JsonValue, command);
  if (!Array.isArray(input.importedAssets) || input.importedAssets.length > 2) {
    throw invalidInput(command, 'importedAssets is invalid');
  }
  const importedAssets = input.importedAssets.map((asset, index) => {
    assertExactInput(asset, ['role', 'fileName', 'mediaType', 'content', 'sha256'], command);
    if (asset.role !== 'avatar' && asset.role !== 'background') {
      throw invalidInput(command, `importedAssets[${index}].role is invalid`);
    }
    if (!(asset.content instanceof Uint8Array)
      || asset.content.byteLength === 0
      || asset.content.byteLength > 64 * 1024 * 1024) {
      throw invalidInput(command, `importedAssets[${index}].content is invalid`);
    }
    return {
      role: asset.role,
      fileName: requiredText(asset.fileName, `importedAssets[${index}].fileName`, command, 512),
      mediaType: requiredText(asset.mediaType, `importedAssets[${index}].mediaType`, command, 512),
      content: Array.from(asset.content, (byte) => Number(byte)),
      sha256: requiredText(asset.sha256, `importedAssets[${index}].sha256`, command, 512),
    };
  });
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    expectedPresentationRevision: decimalRevision(
      input.expectedPresentationRevision,
      'expectedPresentationRevision',
      command,
      true,
    ),
    intent: input.intent as JsonValue,
    importedAssets: importedAssets as unknown as JsonValue,
  });
}

function invokeAgentConfigureHandle(
  operation: 'local-app.agentAutonomySnapshot' | 'local-app.agentPresentationSnapshot',
  input: { readonly agentHandle: string },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS[operation];
  return invokeLocalAppRecord(command, identifiers(input, ['agentHandle'], command));
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
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'requestId', 'text'], command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    requestId: requiredText(input.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
    text: requiredUtf8Text(input.text, 'text', command, 64 * 1024),
  });
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
  return invokeChecked(
    command,
    { payload: identifiers(input, ['agentHandle', 'conversationAnchorId'], command) },
    (value) => parseConversationSnapshot(value, command),
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

function parseConversationEvent(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command} emitted invalid conversation event`);
  if (typeof record.type !== 'string'
    || typeof record.sequence !== 'string'
    || !/^[1-9][0-9]*$/u.test(record.sequence)) {
    throw new Error(`${command}: conversation event envelope is invalid`);
  }
  const common = ['type', 'conversationAnchorId', 'sequence', 'turnId'];
  parseRequiredString(record.conversationAnchorId, 'conversationAnchorId', command);
  parseRequiredString(record.turnId, 'turnId', command);
  switch (record.type) {
    case 'turn-accepted':
      assertProjectionKeys(record, [...common, 'requestId'], command, 'turn accepted event');
      parseRequiredString(record.requestId, 'requestId', command);
      break;
    case 'turn-started':
      assertProjectionKeys(record, common, command, 'turn started event');
      break;
    case 'text-delta':
      assertProjectionKeys(record, [...common, 'text'], command, 'text delta event');
      parseRequiredString(record.text, 'text', command);
      break;
    case 'message-committed':
      assertProjectionKeys(record, [...common, 'messageId', 'text'], command, 'message committed event');
      parseRequiredString(record.messageId, 'messageId', command);
      parseRequiredString(record.text, 'text', command);
      break;
    case 'turn-completed':
      assertProjectionKeys(record, [...common, 'terminalReason'], command, 'turn completed event');
      if (typeof record.terminalReason !== 'string'
        || !['', 'stop', 'length', 'tool_call', 'content_filter', 'error', 'unspecified'].includes(record.terminalReason)) {
        throw new Error(`${command}: terminalReason is invalid`);
      }
      break;
    case 'turn-failed':
      assertProjectionKeys(record, [...common, 'reasonCode', 'message'], command, 'turn failed event');
      if (typeof record.reasonCode !== 'string'
        || !/^[A-Z0-9_-]{1,128}$/u.test(record.reasonCode)
        || (record.message !== null && typeof record.message !== 'string')) {
        throw new Error(`${command}: turn failure is invalid`);
      }
      if (typeof record.message === 'string') parseRequiredString(record.message, 'message', command);
      break;
    case 'turn-interrupted':
      assertProjectionKeys(record, [...common, 'reason'], command, 'turn interrupted event');
      if (typeof record.reason !== 'string'
        || !['user_cancel', 'room_closed', 'superseded_turn', 'budget_exhausted', 'timeout', 'gateway_revoked', 'policy_refusal'].includes(record.reason)) {
        throw new Error(`${command}: interrupt reason is invalid`);
      }
      break;
    default:
      throw new Error(`${command}: conversation event type is invalid`);
  }
  return Object.freeze({ ...record }) as JsonObject;
}

function parseConversationSnapshot(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command} returned invalid conversation snapshot`);
  assertProjectionKeys(
    record,
    ['conversationAnchorId', 'activeTurnId', 'messages', 'truncatedBefore'],
    command,
    'conversation snapshot',
  );
  const conversationAnchorId = parseRequiredString(record.conversationAnchorId, 'conversationAnchorId', command);
  if (record.activeTurnId !== null) parseRequiredString(record.activeTurnId, 'activeTurnId', command);
  if (!Array.isArray(record.messages) || record.messages.length > 200 || typeof record.truncatedBefore !== 'boolean') {
    throw new Error(`${command}: conversation snapshot is invalid`);
  }
  let textBytes = 0;
  const messages = record.messages.map((value) => {
    const message = assertRecord(value, `${command} returned invalid conversation message`);
    assertProjectionKeys(message, ['turnId', 'role', 'text'], command, 'conversation message');
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error(`${command}: conversation message role is invalid`);
    }
    const turnId = parseRequiredString(message.turnId, 'turnId', command);
    const text = parseRequiredString(message.text, 'text', command);
    textBytes += new TextEncoder().encode(text).byteLength;
    if (textBytes > 1024 * 1024) throw new Error(`${command}: conversation snapshot is too large`);
    return Object.freeze({ turnId, role: message.role, text });
  });
  return Object.freeze({
    conversationAnchorId,
    activeTurnId: record.activeTurnId as string | null,
    messages: Object.freeze(messages),
    truncatedBefore: record.truncatedBefore,
  }) as JsonObject;
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
      const event = parseConversationEvent(record.event, this.command);
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
  assertProjectionKeys(record, ['state', 'reasonCode', 'retryable', 'currentUser'], command, 'session status');
  const state = parseRequiredString(record.state, 'state', command);
  const reasonCode = parseRequiredString(record.reasonCode, 'reasonCode', command);
  if (!LOCAL_APP_STATUS_STATES.has(state) || typeof record.retryable !== 'boolean') {
    throw new Error(`${command}: session status projection is invalid`);
  }
  return {
    state: state as NimiLocalAppSessionStatus['state'],
    reasonCode,
    retryable: record.retryable,
    currentUser: parseCurrentUserStatus(record.currentUser, command),
  };
}

function parseCurrentUserStatus(value: unknown, command: string): NimiLocalAppCurrentUserStatus {
  const status = assertRecord(value, `${command}: Current User status is invalid`);
  assertProjectionKeys(status, ['state', 'value', 'reasonCode', 'retryable'], command, 'Current User status');
  const state = parseRequiredString(status.state, 'currentUser.state', command);
  const reasonCode = parseRequiredString(status.reasonCode, 'currentUser.reasonCode', command);
  if (typeof status.retryable !== 'boolean') throw new Error(`${command}: Current User retryable is invalid`);
  if (state === 'unavailable' && status.value === null && reasonCode === 'current-user-display-unavailable') {
    return { state, value: null, reasonCode, retryable: status.retryable };
  }
  if (state !== 'ready' || reasonCode !== 'action-executed' || status.retryable) {
    throw new Error(`${command}: Current User status posture is invalid`);
  }
  const display = assertRecord(status.value, `${command}: Current User display is invalid`);
  assertProjectionKeys(display, ['handle', 'displayName', 'avatarUrl'], command, 'Current User display');
  const handle = boundedCurrentUserText(display.handle, 'handle', 160, command);
  const displayName = boundedCurrentUserText(display.displayName, 'displayName', 256, command);
  if (display.avatarUrl !== null && !safeCurrentUserAvatarUrl(display.avatarUrl)) {
    throw new Error(`${command}: Current User avatarUrl is invalid`);
  }
  return {
    state,
    value: { handle, displayName, avatarUrl: display.avatarUrl as string | null },
    reasonCode,
    retryable: false,
  };
}

function boundedCurrentUserText(value: unknown, field: string, maximum: number, command: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${command}: Current User ${field} is invalid`);
  }
  return value;
}

function safeAgentAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && (parsed.port === '' || parsed.port === '443')
      && parsed.hostname !== 'localhost'
      && !parsed.hostname.endsWith('.localhost')
      && !parsed.hostname.endsWith('.local')
      && !parsed.hostname.endsWith('.internal')
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(parsed.hostname)
      && !parsed.hostname.includes(':');
  } catch {
    return false;
  }
}

function safeCurrentUserAvatarUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    if (parsed.protocol === 'https:') return !parsed.port || parsed.port === '443';
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === '3002';
  } catch {
    return false;
  }
}

function parseTextCandidate(value: unknown, command: string): NimiLocalAppTextCandidateResult {
  const record = parseSafeProjection(value, command);
  assertProjectionKeys(record, ['text', 'finishReason', 'traceId'], command, 'text candidate');
  const text = requiredUtf8Content(record.text, 'text', command, MAX_TEXT_CANDIDATE_RESULT_BYTES);
  const finishReason = requiredText(record.finishReason, 'finishReason', command, MAX_IDENTIFIER_LENGTH);
  if (finishReason !== 'stop' && finishReason !== 'length' && finishReason !== 'content-filter') {
    throw new Error(`${command}: finishReason is invalid`);
  }
  return Object.freeze({
    text,
    finishReason,
    traceId: requiredText(record.traceId, 'traceId', command, MAX_IDENTIFIER_LENGTH),
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

function parseAppAIConfig(value: unknown, command: string): NimiPortableAppAIConfig {
  const config = parseSafeProjection(value, command);
  rejectPortableAppAIConfigFields(config, command, false);
  assertProjectionKeys(config, ['owner', 'capabilities'], command, 'App AIConfig');
  const owner = assertRecord(config.owner, `${command}: App AIConfig owner is invalid`);
  assertProjectionKeys(owner, ['owner'], command, 'App AIConfig owner');
  const ownerVariant = assertRecord(owner.owner, `${command}: App AIConfig owner variant is invalid`);
  assertProjectionKeys(ownerVariant, ['oneofKind', 'app'], command, 'App AIConfig owner variant');
  if (ownerVariant.oneofKind !== 'app') throw new Error(`${command}: App AIConfig owner variant is invalid`);
  const app = assertRecord(ownerVariant.app, `${command}: App AIConfig App owner is invalid`);
  assertProjectionKeys(app, ['appId'], command, 'App AIConfig App owner');
  requiredText(app.appId, 'appId', command, MAX_IDENTIFIER_LENGTH);
  if (!Array.isArray(config.capabilities)) throw new Error(`${command}: App AIConfig capabilities are invalid`);
  return config as unknown as NimiPortableAppAIConfig;
}

function parseSharedAgentAIConfig(value: unknown, command: string): NimiCapabilityAIConfig {
  const config = parseSafeProjection(value, command);
  assertProjectionKeys(config, ['owner', 'capabilities'], command, 'shared LocalAgent AIConfig');
  const owner = assertRecord(config.owner, `${command}: shared LocalAgent AIConfig owner is invalid`);
  assertProjectionKeys(owner, ['owner'], command, 'shared LocalAgent AIConfig owner');
  const ownerVariant = assertRecord(
    owner.owner,
    `${command}: shared LocalAgent AIConfig owner variant is invalid`,
  );
  assertProjectionKeys(
    ownerVariant,
    ['oneofKind', 'runtimeLocalAgentSubsystem'],
    command,
    'shared LocalAgent AIConfig owner variant',
  );
  if (ownerVariant.oneofKind !== 'runtimeLocalAgentSubsystem') {
    throw new Error(`${command}: shared LocalAgent AIConfig owner variant is invalid`);
  }
  const marker = assertRecord(
    ownerVariant.runtimeLocalAgentSubsystem,
    `${command}: shared LocalAgent AIConfig owner marker is invalid`,
  );
  assertProjectionKeys(marker, [], command, 'shared LocalAgent AIConfig owner marker');
  if (!Array.isArray(config.capabilities)) {
    throw new Error(`${command}: shared LocalAgent AIConfig capabilities are invalid`);
  }
  return config as unknown as NimiCapabilityAIConfig;
}

function canonicalAIConfigCapabilities(
  capabilities: readonly NimiLocalAppAIConfigIntentInput[],
  command: string,
): JsonObject[] {
  if (!Array.isArray(capabilities)) throw invalidInput(command, 'capabilities must be an array');
  try {
    return capabilities.map((intent, index) => {
      rejectAIConfigAuthorityFields(intent, command);
      assertAllowedInputKeys(
        intent,
        ['capabilityContract', 'requiredFeatures', 'defaults', 'route'],
        ['capabilityContract', 'requiredFeatures', 'route'],
        command,
      );
      if (!Array.isArray(intent.requiredFeatures)
        || intent.requiredFeatures.some((feature: unknown) => typeof feature !== 'string'
          || !feature.trim()
          || feature.trim() !== feature)) {
        throw invalidInput(command, `capabilities[${index}].requiredFeatures is invalid`);
      }
      const route = assertRecord(intent.route, `${command}: capabilities[${index}].route is invalid`);
      const output: JsonObject = {
        capabilityContract: requiredText(
          intent.capabilityContract,
          `capabilities[${index}].capabilityContract`,
          command,
          MAX_IDENTIFIER_LENGTH,
        ),
        requiredFeatures: [...intent.requiredFeatures],
        route: canonicalAIConfigRoute(route, index, command),
      };
      if (intent.defaults !== undefined) {
        output.defaults = canonicalAIConfigJsonValue(intent.defaults, command);
      }
      return output;
    });
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw invalidInput(command, 'capabilities are invalid');
  }
}

function canonicalAIConfigRoute(route: JsonObject, index: number, command: string): JsonObject {
  if (route.oneofKind === 'local') {
    assertProjectionKeys(route, ['oneofKind', 'local'], command, `capabilities[${index}].route`);
    const local = assertRecord(route.local, `${command}: capabilities[${index}].route.local is invalid`);
    assertProjectionKeys(local, [], command, `capabilities[${index}].route.local`);
    return { oneofKind: 'local', local: {} };
  }
  if (route.oneofKind !== 'cloud') {
    throw invalidInput(command, `capabilities[${index}].route is invalid`);
  }
  assertProjectionKeys(route, ['oneofKind', 'cloud'], command, `capabilities[${index}].route`);
  const cloud = assertRecord(route.cloud, `${command}: capabilities[${index}].route.cloud is invalid`);
  assertAllowedInputKeys(
    cloud,
    ['implementation', 'providerModelTarget'],
    ['implementation'],
    command,
  );
  const implementation = assertRecord(
    cloud.implementation,
    `${command}: capabilities[${index}].route.cloud.implementation is invalid`,
  );
  assertProjectionKeys(
    implementation,
    ['implementationId', 'driverId', 'driverDialect'],
    command,
    `capabilities[${index}].route.cloud.implementation`,
  );
  const canonicalCloud: JsonObject = {
    implementation: {
      implementationId: requiredText(implementation.implementationId, 'implementationId', command, MAX_IDENTIFIER_LENGTH),
      driverId: requiredText(implementation.driverId, 'driverId', command, MAX_IDENTIFIER_LENGTH),
      driverDialect: requiredText(implementation.driverDialect, 'driverDialect', command, MAX_IDENTIFIER_LENGTH),
    },
  };
  if (cloud.providerModelTarget !== undefined) {
    canonicalCloud.providerModelTarget = canonicalAIConfigJsonValue(cloud.providerModelTarget, command);
  }
  return { oneofKind: 'cloud', cloud: canonicalCloud };
}

function canonicalAIConfigJsonValue(value: unknown, command: string): JsonValue {
  validateStorageJsonValue(value, command);
  rejectAIConfigAuthorityFields(value, command);
  return value as JsonValue;
}

function rejectAIConfigAuthorityFields(value: unknown, command: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) rejectAIConfigAuthorityFields(entry, command);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_AI_CONFIG_INPUT_KEYS.has(normalizeFieldName(key))) {
      throw invalidInput(command, `AIConfig authority field ${key} is forbidden`);
    }
    rejectAIConfigAuthorityFields(entry, command);
  }
}

function rejectPortableAppAIConfigFields(value: unknown, command: string, input: boolean): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) rejectPortableAppAIConfigFields(entry, command, input);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS.has(normalizeFieldName(key))) {
      if (input) throw invalidInput(command, `portable App AIConfig field ${key} is forbidden`);
      throw new Error(`${command}: portable App AIConfig field ${key} is forbidden`);
    }
    rejectPortableAppAIConfigFields(entry, command, input);
  }
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

function boundedFiniteNumber(
  value: unknown,
  field: string,
  command: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidInput(command, `${field} is invalid`);
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

function decimalRevision(
  value: unknown,
  field: string,
  command: string,
  allowZero: boolean,
): string {
  if (typeof value !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || (!allowZero && value === '0')) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return value;
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

function requiredUtf8Text(value: unknown, field: string, command: string, maxBytes: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || new TextEncoder().encode(normalized).byteLength > maxBytes) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return normalized;
}

function requiredUtf8Content(value: unknown, field: string, command: string, maxBytes: number): string {
  if (typeof value !== 'string'
    || !value.trim()
    || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return value;
}

function invalidInput(command: string, reason: string): BridgeError {
  return new BridgeError(`Local-app operation input is invalid: ${reason}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-local-app-payload-invalid',
    actionHint: 'send_only_declared_local_app_operation_fields',
    source: 'renderer',
  });
}
