import {
  NIMI_STANDARD_SHELL_COMMANDS,
  isNimiStandardShellErrorEnvelope,
} from '@nimiplatform/kit/shell/capabilities';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
  NimiAIConfigOptionsQuery,
  NimiAIConfigOptionsResult,
  NimiAIConfigOverwriteInput,
  NimiAIConfigOverwriteResult,
  NimiAIConfigSnapshot,
  NimiSharedLocalAgentAIConfigSnapshot,
  NimiSharedLocalAgentAIConfigOverwriteResult,
  NimiSharedLocalAgentAIConfigOptionsQuery,
  NimiSharedLocalAgentAIConfigOptionsResult,
  NimiLocalAppAgentHandle,
  NimiPortableAppAIConfig,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import { BridgeError, invoke, invokeChecked } from './invoke.js';
import { listenShell } from './tauri-api.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const AIC_COMMANDS = {
  textTurnStream: NIMI_STANDARD_SHELL_COMMANDS['local-app.textTurnStream'],
  scenarioExecute: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioExecute'],
  scenarioJobSubmit: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubmit'],
  scenarioJobGet: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobGet'],
  scenarioJobSubscribe: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobSubscribe'],
  scenarioJobCancel: NIMI_STANDARD_SHELL_COMMANDS['local-app.scenarioJobCancel'],
  artifactRead: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactRead'],
  artifactUpload: NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactUpload'],
  voiceAssetsList: NIMI_STANDARD_SHELL_COMMANDS['local-app.voiceAssetsList'],
} as const;

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_TEXT_CANDIDATE_MESSAGES = 8;
const MAX_TEXT_CANDIDATE_MESSAGE_BYTES = 32 * 1024;
const MAX_TEXT_CANDIDATE_PROMPT_BYTES = 64 * 1024;
const MAX_TEXT_CANDIDATE_RESULT_BYTES = 256 * 1024;
const MAX_TEXT_CANDIDATE_TOKENS = 4096;
const MAX_STORAGE_PATH_BYTES = 240;
const MAX_ASSET_PATH_BYTES = 1024;
const MAX_ASSET_PATH_COMPONENTS = 32;
const MAX_ASSET_COMPONENT_BYTES = 255;
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
  readonly agentHandle: NimiLocalAppAgentHandle;
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
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly topK?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stop?: readonly string[];
  readonly seed?: number;
};

export type NimiLocalAppTextCandidateResult = {
  readonly text: string;
  readonly finishReason: 'stop' | 'length' | 'content-filter';
  readonly traceId: string;
};

export type NimiLocalAppScenarioExecuteSpec =
  | { readonly type: 'text-embed'; readonly inputs: readonly string[] }
  | NimiLocalAppImageGenerateSpec;

export type NimiLocalAppImageGenerateSpec = {
  readonly type: 'image-generate';
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly n?: number;
  readonly size: string;
  readonly aspectRatio: string;
  readonly quality: string;
  readonly style: string;
  readonly seed?: number;
  readonly referenceImages: readonly string[];
  readonly referenceImageArtifactId: string;
  readonly mask: string;
  readonly responseFormat: '' | 'b64_json' | 'url';
};

export type NimiLocalAppVideoContent =
  | { readonly type: 'text'; readonly role: NimiLocalAppVideoContentRole; readonly text: string }
  | { readonly type: 'image-url' | 'video-url' | 'audio-url'; readonly role: NimiLocalAppVideoContentRole; readonly url: string }
  | { readonly type: 'artifact-ref'; readonly role: NimiLocalAppVideoContentRole; readonly artifactId: string };
export type NimiLocalAppVideoContentRole =
  | 'prompt' | 'first-frame' | 'last-frame' | 'reference-image' | 'reference-video' | 'reference-audio';

export type NimiLocalAppScenarioJobSpec =
  | NimiLocalAppImageGenerateSpec
  | {
      readonly type: 'video-generate'; readonly prompt: string; readonly negativePrompt: string;
      readonly mode: 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference';
      readonly content: readonly NimiLocalAppVideoContent[];
      readonly options: {
        readonly resolution: string; readonly ratio: string; readonly durationSec?: number;
        readonly frames?: number; readonly fps?: number; readonly seed?: number;
        readonly cameraFixed?: boolean; readonly watermark?: boolean; readonly generateAudio?: boolean;
        readonly draft?: boolean; readonly returnLastFrame?: boolean;
      };
    }
  | {
      readonly type: 'speech-synthesize'; readonly text: string; readonly language: string;
      readonly audioFormat: string; readonly sampleRateHz?: number; readonly speed?: number;
      readonly pitch?: number; readonly volume?: number; readonly emotion: string;
      readonly voiceRef: { readonly type: 'preset' | 'voice-asset'; readonly id: string } | null;
      readonly timingMode: 'none' | 'word' | 'char';
      readonly voiceRenderHints: {
        readonly stability: number; readonly similarityBoost: number; readonly style: number;
        readonly useSpeakerBoost: boolean; readonly speed: number;
      } | null;
    }
  | {
      readonly type: 'speech-transcribe'; readonly mimeType: string; readonly language: string;
      readonly timestamps?: boolean; readonly diarization?: boolean; readonly speakerCount?: number;
      readonly prompt: string; readonly responseFormat: string;
      readonly audioSource: { readonly type: 'bytes'; readonly bytes: readonly number[] }
        | { readonly type: 'uri'; readonly uri: string };
    }
  | {
      readonly type: 'voice-create'; readonly creationSource: 'reference-audio';
      readonly referenceAudio: { readonly type: 'bytes'; readonly bytes: readonly number[] }
        | { readonly type: 'uri'; readonly uri: string };
      readonly referenceAudioMime: string; readonly languageHints: readonly string[];
      readonly preferredName: string; readonly text: string;
    }
  | {
      readonly type: 'voice-create'; readonly creationSource: 'text-description';
      readonly instructionText: string; readonly previewText: string;
      readonly language: string; readonly preferredName: string;
    }
  | { readonly type: 'music-generate'; readonly prompt: string; readonly lyrics: string };

export type NimiLocalAppScenarioJobSubmitOptions = {
  readonly timeoutMs?: number;
};

export type NimiLocalAppScenarioTimestamp = { readonly seconds: string; readonly nanos: number };
export type NimiLocalAppScenarioArtifact = {
  readonly artifactId: string; readonly mimeType: string; readonly bytes: readonly number[];
  readonly sizeBytes: number; readonly sha256: string; readonly durationMs: number;
  readonly width: number; readonly height: number; readonly sampleRateHz: number; readonly channels: number;
};
export type NimiLocalAppScenarioJob = {
  readonly jobId: string;
  readonly scenarioType: 'image-generate' | 'video-generate' | 'speech-synthesize' | 'speech-transcribe' | 'voice-create' | 'music-generate';
  readonly status: 'submitted' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'timeout';
  readonly progressPercent: number; readonly progressCurrentStep: number; readonly progressTotalSteps: number;
  readonly reasonCode: string; readonly reasonDetail: string;
  readonly artifacts: readonly NimiLocalAppScenarioArtifact[]; readonly traceId: string;
  readonly createdAt: NimiLocalAppScenarioTimestamp | null; readonly updatedAt: NimiLocalAppScenarioTimestamp | null;
  readonly transcriptionText: string;
};
export type NimiLocalAppVoiceAsset = {
  readonly voiceAssetId: string; readonly creationSource: 'reference-audio' | 'text-description';
  readonly status: 'active' | 'expired' | 'deleted' | 'failed';
  readonly createdAt: NimiLocalAppScenarioTimestamp | null; readonly updatedAt: NimiLocalAppScenarioTimestamp | null;
  readonly expiresAt: NimiLocalAppScenarioTimestamp | null;
};
export type NimiLocalAppScenarioExecuteResult =
  | { readonly output: { readonly type: 'text-embed'; readonly vectors: readonly (readonly number[])[] }; readonly traceId: string }
  | { readonly output: { readonly type: 'image-generate'; readonly artifacts: readonly NimiLocalAppScenarioArtifact[] }; readonly traceId: string };
export type NimiLocalAppScenarioJobSubmitResult = {
  readonly job: NimiLocalAppScenarioJob;
};
export type NimiLocalAppScenarioJobGetResult = {
  readonly job: NimiLocalAppScenarioJob;
  readonly asset: NimiLocalAppVoiceAsset | null;
  readonly voiceReference: { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string } | null;
};
export type NimiLocalAppArtifactUploadResult = {
  readonly artifactId: string;
  readonly sizeBytes: number;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
};
export type NimiLocalAppTextTurnEvent =
  | { readonly type: 'delta'; readonly sequence: string; readonly traceId: string; readonly text: string }
  | { readonly type: 'completed'; readonly sequence: string; readonly traceId: string; readonly finishReason: 'stop' | 'length' | 'content-filter' }
  | { readonly type: 'failed'; readonly sequence: string; readonly traceId: string; readonly reasonCode: string; readonly actionHint: string };
export type NimiLocalAppScenarioJobEvent = {
  readonly eventType: 'submitted' | 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'timeout';
  readonly sequence: string; readonly traceId: string; readonly timestamp: NimiLocalAppScenarioTimestamp | null;
  readonly job: NimiLocalAppScenarioJob;
};

export type NimiLocalAppStream<T> = {
  readonly events: AsyncIterable<T>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppStorageDocument = {
  readonly value: JsonValue;
  readonly sizeBytes: number;
};

export type NimiLocalAppStorageRemoveResult = {
  readonly removed: boolean;
};

export type NimiLocalAppAssetRecord = {
  readonly relativePath: string;
  readonly mediaType?: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type NimiLocalAppAssetBody = Uint8Array | Blob | AsyncIterable<Uint8Array>;
export type NimiLocalAppAssetReadResult = {
  readonly asset: NimiLocalAppAssetRecord;
  readonly range: { readonly offset: number; readonly length: number; readonly totalSize: number };
  readonly body: AsyncIterable<Uint8Array>;
};

export type NimiLocalAppAssetShell = {
  readonly stat: (relativePath: string) => Promise<NimiLocalAppAssetRecord>;
  readonly list: (input: { readonly prefix: string; readonly cursor?: string; readonly pageSize?: number }) => Promise<{ readonly assets: readonly NimiLocalAppAssetRecord[]; readonly nextCursor: string }>;
  readonly write: (input: { readonly relativePath: string; readonly body: NimiLocalAppAssetBody; readonly mediaType?: string; readonly overwrite?: boolean }) => Promise<NimiLocalAppAssetRecord>;
  readonly read: (input: { readonly relativePath: string; readonly offset?: number; readonly length?: number }) => Promise<NimiLocalAppAssetReadResult>;
  readonly remove: (relativePath: string) => Promise<NimiLocalAppStorageRemoveResult>;
  readonly move: (input: { readonly from: string; readonly to: string; readonly overwrite?: boolean }) => Promise<NimiLocalAppAssetRecord>;
  readonly reveal: (relativePath: string) => Promise<{ readonly revealed: true }>;
  readonly adoptArtifact: (input: { readonly artifactId: string; readonly relativePath: string; readonly overwrite?: boolean }) => Promise<NimiLocalAppAssetRecord>;
};

export type NimiLocalAppAssetMediaHandle = {
  readonly url: string;
  readonly revoke: () => Promise<void>;
};

export type NimiLocalAppWorldCoreListInput = {
  readonly take?: number;
  readonly visibility?: 'private' | 'unlisted' | 'public' | 'system';
};

export type NimiLocalAppPersonaCharacterListOwnedInput = {
  readonly worldId?: string;
  readonly visibility?: 'private' | 'unlisted' | 'public';
  readonly afterId?: string;
  readonly take?: number;
};

export type NimiLocalAppConversationScopeInput = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
};

export type NimiLocalAppConversationSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppRealtimeSubscription = NimiLocalAppConversationSubscription;

export type NimiLocalAppAgentConfigureShellSurface = {
  readonly manager: {
    readonly snapshot: (input: {
      readonly agentHandle: string;
      readonly conversationAnchorId?: string;
    }) => Promise<JsonObject>;
  };
  readonly sharedAIConfig: {
    readonly get: () => Promise<NimiAIConfigSnapshot>;
    readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<NimiAIConfigOverwriteResult>;
    readonly listOptions: (query: NimiSharedLocalAgentAIConfigOptionsQuery) => Promise<NimiSharedLocalAgentAIConfigOptionsResult>;
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
  readonly memory: {
    readonly inspect: (input: {
      readonly agentHandle: string;
      readonly limit?: number;
      readonly pageToken?: string;
    }) => Promise<JsonObject>;
    readonly correct: (input: { readonly agentHandle: string; readonly memoryId: string; readonly correctedContent: string }) => Promise<JsonObject>;
    readonly forget: (input: { readonly agentHandle: string; readonly memoryIds: readonly string[]; readonly confirmed: true }) => Promise<JsonObject>;
    readonly setEnabled: (input: { readonly agentHandle: string; readonly enabled: boolean }) => Promise<JsonObject>;
    readonly deleteAll: (input: { readonly agentHandle: string; readonly confirmed: true }) => Promise<JsonObject>;
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
      readonly streamTurn: (
        input: NimiLocalAppTextCandidateInput,
      ) => Promise<NimiLocalAppStream<NimiLocalAppTextTurnEvent>>;
    };
    readonly scenario: {
      readonly execute: (spec: NimiLocalAppScenarioExecuteSpec) => Promise<NimiLocalAppScenarioExecuteResult>;
    };
    readonly scenarioJobs: {
      readonly submit: (
        spec: NimiLocalAppScenarioJobSpec,
        options?: NimiLocalAppScenarioJobSubmitOptions,
      ) => Promise<NimiLocalAppScenarioJobSubmitResult>;
      readonly get: (jobId: string) => Promise<NimiLocalAppScenarioJobGetResult>;
      readonly subscribe: (jobId: string) => Promise<NimiLocalAppStream<NimiLocalAppScenarioJobEvent>>;
      readonly cancel: (jobId: string, reason?: string) => Promise<{ readonly job: NimiLocalAppScenarioJob }>;
    };
    readonly artifacts: {
      readonly read: (artifactId: string) => Promise<{ readonly bytes: readonly number[]; readonly mimeType: string; readonly sizeBytes: number }>;
      readonly upload: (input: { readonly bytes: readonly number[]; readonly mimeType: NimiLocalAppArtifactUploadResult['mimeType'] }) => Promise<NimiLocalAppArtifactUploadResult>;
    };
    readonly voiceAssets: {
      readonly list: (input?: { readonly pageSize?: number; readonly pageToken?: string }) => Promise<{ readonly assets: readonly NimiLocalAppVoiceAsset[]; readonly nextPageToken: string }>;
    };
    readonly realtime: {
      readonly open: (input: JsonObject) => Promise<JsonObject>;
      readonly appendInput: (input: JsonObject) => Promise<JsonObject>;
      readonly submitOwnerControl: (input: JsonObject) => Promise<JsonObject>;
      readonly subscribe: (input: JsonObject) => Promise<NimiLocalAppRealtimeSubscription>;
      readonly interruptOutput: (input: JsonObject) => Promise<JsonObject>;
      readonly close: (input: JsonObject) => Promise<JsonObject>;
    };
  };
  readonly aiConfig: {
    readonly get: () => Promise<NimiAIConfigSnapshot>;
    readonly overwrite: (input: NimiAIConfigOverwriteInput) => Promise<NimiAIConfigOverwriteResult>;
    readonly listOptions: (query: NimiAIConfigOptionsQuery) => Promise<NimiAIConfigOptionsResult>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiLocalAppStorageDocument>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<NimiLocalAppStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiLocalAppStorageRemoveResult>;
    readonly assets: NimiLocalAppAssetShell;
  };
  readonly realm: {
    readonly chat: {
      readonly list: (input?: { readonly cursor?: string; readonly limit?: number }) => Promise<JsonObject>;
    };
    readonly worldCore: {
      readonly list: (input?: NimiLocalAppWorldCoreListInput) => Promise<readonly JsonObject[]>;
      readonly create: (input: unknown) => Promise<JsonObject>;
    };
    readonly personaCharacter: {
      readonly listOwned: (input?: NimiLocalAppPersonaCharacterListOwnedInput) => Promise<readonly JsonObject[]>;
      readonly getOwned: (personaCharacterId: string) => Promise<JsonObject>;
      readonly create: (input: JsonObject) => Promise<JsonObject>;
      readonly replace: (input: JsonObject) => Promise<JsonObject>;
      readonly delete: (personaCharacterId: string) => Promise<JsonObject>;
    };
    readonly realtime: {
      readonly open: () => Promise<JsonObject>;
      readonly subscribe: (input: JsonObject) => Promise<NimiLocalAppRealtimeSubscription>;
      readonly ack: (input: JsonObject) => Promise<JsonObject>;
      readonly closeSubscription: (input: JsonObject) => Promise<JsonObject>;
      readonly closeChannel: (input: JsonObject) => Promise<JsonObject>;
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
      readonly parts: readonly (
        | { readonly kind: 'text'; readonly text: string }
        | { readonly kind: 'artifact-ref'; readonly artifactId: string }
      )[];
    }) => Promise<JsonObject>;
    readonly uploadAttachment: (input: NimiLocalAppConversationScopeInput & {
      readonly mimeType: string;
      readonly displayName?: string;
      readonly bytes: readonly number[];
    }) => Promise<JsonObject>;
    readonly readArtifact: (input: NimiLocalAppConversationScopeInput & {
      readonly artifactId: string;
    }) => Promise<JsonObject>;
    readonly transcribeVoice: (input: NimiLocalAppConversationScopeInput & {
      readonly requestId: string;
      readonly mimeType: string;
      readonly audioBytes: readonly number[];
    }, options?: { readonly signal?: AbortSignal }) => Promise<JsonObject>;
    readonly renderVoice: (input: NimiLocalAppConversationScopeInput & {
      readonly messageId: string;
      readonly requestId: string;
    }) => Promise<JsonObject>;
    readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
  };
  readonly agentRealtime: {
    readonly open: (input: JsonObject) => Promise<JsonObject>;
    readonly appendInput: (input: JsonObject) => Promise<JsonObject>;
    readonly subscribe: (input: JsonObject) => Promise<NimiLocalAppRealtimeSubscription>;
    readonly status: (input: JsonObject) => Promise<JsonObject>;
    readonly interruptOutput: (input: JsonObject) => Promise<JsonObject>;
    readonly close: (input: JsonObject) => Promise<JsonObject>;
  };
};

export function createNimiLocalAppStandardShellSurface(): NimiLocalAppStandardShellSurface {
  return {
    session: { status: getNimiLocalAppSessionStatus },
    ai: {
      text: {
        generateCandidate: generateNimiLocalAppTextCandidate,
        streamTurn: streamNimiLocalAppTextTurn,
      },
      scenario: {
        execute: executeNimiLocalAppScenario,
      },
      scenarioJobs: {
        submit: submitNimiLocalAppScenarioJob,
        get: getNimiLocalAppScenarioJob,
        subscribe: subscribeNimiLocalAppScenarioJob,
        cancel: cancelNimiLocalAppScenarioJob,
      },
      artifacts: {
        read: readNimiLocalAppScenarioArtifact,
        upload: uploadNimiLocalAppScenarioArtifact,
      },
      voiceAssets: {
        list: listNimiLocalAppVoiceAssets,
      },
      realtime: {
        open: openNimiLocalAppAiRealtime,
        appendInput: appendNimiLocalAppAiRealtimeInput,
        submitOwnerControl: submitNimiLocalAppAiRealtimeOwnerControl,
        subscribe: subscribeNimiLocalAppAiRealtime,
        interruptOutput: interruptNimiLocalAppAiRealtimeOutput,
        close: closeNimiLocalAppAiRealtime,
      },
    },
    aiConfig: {
      get: getNimiLocalAppAIConfig,
      overwrite: overwriteNimiLocalAppAIConfig,
      listOptions: listNimiLocalAppAIConfigOptions,
    },
    storage: {
      readJson: readNimiLocalAppStorageJson,
      writeJson: writeNimiLocalAppStorageJson,
      removeJson: removeNimiLocalAppStorageJson,
      assets: createNimiLocalAppAssetShell(),
    },
    realm: {
      chat: {
        list: listNimiLocalAppRealmChats,
      },
      worldCore: {
        list: listNimiLocalAppWorldCores,
        create: createNimiLocalAppWorldCore,
      },
      personaCharacter: {
        listOwned: listNimiLocalAppOwnedPersonaCharacters,
        getOwned: getNimiLocalAppOwnedPersonaCharacter,
        create: createNimiLocalAppPersonaCharacter,
        replace: replaceNimiLocalAppPersonaCharacter,
        delete: deleteNimiLocalAppPersonaCharacter,
      },
      realtime: {
        open: openNimiLocalAppRealmRealtime,
        subscribe: subscribeNimiLocalAppRealmRealtime,
        ack: ackNimiLocalAppRealmRealtime,
        closeSubscription: closeNimiLocalAppRealmRealtimeSubscription,
        closeChannel: closeNimiLocalAppRealmRealtimeChannel,
      },
    },
    agents: {
      listReferences: listNimiLocalAppAgentReferences,
    },
    agentConfigure: {
      manager: {
        snapshot: getNimiLocalAppAgentManagerSnapshot,
      },
      sharedAIConfig: {
        get: getNimiLocalAppSharedAgentAIConfig,
        overwrite: overwriteNimiLocalAppSharedAgentAIConfig,
        listOptions: listNimiLocalAppSharedAgentAIConfigOptions,
      },
      autonomy: {
        snapshot: getNimiLocalAppAgentAutonomySnapshot,
        update: updateNimiLocalAppAgentAutonomy,
      },
      presentation: {
        snapshot: getNimiLocalAppAgentPresentationSnapshot,
        commit: commitNimiLocalAppAgentPresentation,
      },
      memory: {
        inspect: inspectNimiLocalAppAgentMemory,
        correct: correctNimiLocalAppAgentMemory,
        forget: forgetNimiLocalAppAgentMemory,
        setEnabled: setNimiLocalAppAgentMemoryEnabled,
        deleteAll: deleteAllNimiLocalAppAgentMemory,
      },
    },
    conversation: {
      open: openNimiLocalAppConversation,
      send: sendNimiLocalAppConversationTurn,
      uploadAttachment: uploadNimiLocalAppConversationAttachment,
      readArtifact: readNimiLocalAppConversationArtifact,
      transcribeVoice: transcribeNimiLocalAppConversationVoice,
      renderVoice: renderNimiLocalAppConversationVoice,
      interruptTurn: interruptNimiLocalAppConversationTurn,
      subscribe: subscribeNimiLocalAppConversation,
      snapshot: getNimiLocalAppConversationSnapshot,
    },
    agentRealtime: {
      open: openNimiLocalAppAgentRealtime,
      appendInput: appendNimiLocalAppAgentRealtimeInput,
      subscribe: subscribeNimiLocalAppAgentRealtime,
      status: getNimiLocalAppAgentRealtimeStatus,
      interruptOutput: interruptNimiLocalAppAgentRealtimeOutput,
      close: closeNimiLocalAppAgentRealtime,
    },
  };
}

export function getNimiLocalAppAIConfig(): Promise<NimiAIConfigSnapshot> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigGet'];
  return invokeChecked(command, {}, (value) => parseAppAIConfigSnapshot(value, command));
}

export function overwriteNimiLocalAppAIConfig(
  input: NimiAIConfigOverwriteInput,
): Promise<NimiAIConfigOverwriteResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigOverwrite'];
  const payload = {
    expectedRevision: requiredText(input.expectedRevision, 'expectedRevision', command, MAX_IDENTIFIER_LENGTH),
    capabilities: canonicalAIConfigCapabilities(input.capabilities, command),
  };
  return invokeChecked(command, payload, (value) => parseAppAIConfigOverwrite(value, command));
}

export function listNimiLocalAppAIConfigOptions(
  query: NimiAIConfigOptionsQuery,
): Promise<NimiAIConfigOptionsResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.aiConfigLocalOptions'];
  const payload = {
    kind: query.kind,
    capabilityContract: requiredText(query.capabilityContract, 'capabilityContract', command, MAX_IDENTIFIER_LENGTH),
    ...(query.kind === 'cloud-targets'
      ? { connectorRef: requiredText(query.connectorRef, 'connectorRef', command, MAX_IDENTIFIER_LENGTH) }
      : {}),
    search: query.search ?? '',
  };
  return invokeChecked(command, payload, (value) => parseAppAIConfigOptions(value, command));
}

export function getNimiLocalAppSessionStatus(): Promise<NimiLocalAppSessionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'];
  return invokeChecked(command, {}, (value) => parseSessionStatus(value, command));
}

export function generateNimiLocalAppTextCandidate(
  input: NimiLocalAppTextCandidateInput,
): Promise<NimiLocalAppTextCandidateResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.textGenerateCandidate'];
  const payload = canonicalTextTurnInput(input, command);
  return invokeChecked(
    command,
    { payload },
    (value) => parseTextCandidate(value, command),
  );
}

function canonicalTextTurnInput(
  input: NimiLocalAppTextCandidateInput,
  command: string,
): JsonObject {
  assertAllowedInputKeys(
    input,
    ['messages', 'temperature', 'topP', 'maxTokens', 'topK', 'presencePenalty', 'frequencyPenalty', 'stop', 'seed'],
    ['messages'],
    command,
  );
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
  const output: JsonObject = { messages: messages as unknown as JsonValue };
  if (input.temperature !== undefined) output.temperature = boundedFiniteNumber(input.temperature, 'temperature', command, 0, 2);
  if (input.topP !== undefined) output.topP = boundedFiniteNumber(input.topP, 'topP', command, 0, 1);
  if (input.maxTokens !== undefined) output.maxTokens = boundedSafeInteger(input.maxTokens, 'maxTokens', command, 0, MAX_TEXT_CANDIDATE_TOKENS);
  if (input.topK !== undefined) output.topK = boundedSafeInteger(input.topK, 'topK', command, 0, 2_147_483_647);
  if (input.presencePenalty !== undefined) output.presencePenalty = boundedFiniteNumber(input.presencePenalty, 'presencePenalty', command, -2, 2);
  if (input.frequencyPenalty !== undefined) output.frequencyPenalty = boundedFiniteNumber(input.frequencyPenalty, 'frequencyPenalty', command, -2, 2);
  if (input.stop !== undefined) {
    if (!Array.isArray(input.stop)
      || input.stop.some((value) => typeof value !== 'string' || value.trim() === '')) {
      throw invalidInput(command, 'stop is invalid');
    }
    output.stop = [...input.stop];
  }
  if (input.seed !== undefined) output.seed = boundedSafeInteger(input.seed, 'seed', command, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  return output;
}

export async function streamNimiLocalAppTextTurn(
  input: NimiLocalAppTextCandidateInput,
): Promise<NimiLocalAppStream<NimiLocalAppTextTurnEvent>> {
  const command = AIC_COMMANDS.textTurnStream;
  let deltaBytes = 0;
  return openNimiLocalAppAIStream(
    command,
    canonicalTextTurnInput(input, command),
    (value) => {
      const event = parseTextTurnEvent(value, command);
      if (event.type === 'delta' && typeof event.text === 'string') {
        deltaBytes += new TextEncoder().encode(event.text).byteLength;
        if (deltaBytes > MAX_TEXT_CANDIDATE_RESULT_BYTES) throw new Error(`${command}: text-turn output is too large`);
      }
      return event as NimiLocalAppTextTurnEvent;
    },
  );
}

export function executeNimiLocalAppScenario(
  spec: NimiLocalAppScenarioExecuteSpec,
): Promise<NimiLocalAppScenarioExecuteResult> {
  const command = AIC_COMMANDS.scenarioExecute;
  return invokeChecked(command, { payload: { spec: canonicalScenarioSpec(spec, command) } },
    (value) => parseScenarioExecute(value, command));
}

export function submitNimiLocalAppScenarioJob(
  spec: NimiLocalAppScenarioJobSpec,
  options: NimiLocalAppScenarioJobSubmitOptions = {},
): Promise<NimiLocalAppScenarioJobSubmitResult> {
  const command = AIC_COMMANDS.scenarioJobSubmit;
  const timeoutMs = options.timeoutMs ?? 0;
  return invokeChecked(command, { payload: {
    spec: canonicalScenarioSpec(spec, command),
    timeoutMs: boundedSafeInteger(timeoutMs, 'timeoutMs', command, 0, 2_147_483_647),
  } },
    (value) => parseScenarioJobSubmit(value, command));
}

export function getNimiLocalAppScenarioJob(jobId: string): Promise<NimiLocalAppScenarioJobGetResult> {
  const command = AIC_COMMANDS.scenarioJobGet;
  return invokeChecked(command, { payload: { jobId: requiredText(jobId, 'jobId', command, 128) } },
    (value) => parseScenarioJobGet(value, command));
}

export async function subscribeNimiLocalAppScenarioJob(
  jobId: string,
): Promise<NimiLocalAppStream<NimiLocalAppScenarioJobEvent>> {
  const command = AIC_COMMANDS.scenarioJobSubscribe;
  return openNimiLocalAppAIStream(
    command,
    { jobId: requiredText(jobId, 'jobId', command, 128) },
    (value) => parseScenarioJobEvent(value, command) as NimiLocalAppScenarioJobEvent,
  );
}

export function cancelNimiLocalAppScenarioJob(
  jobId: string,
  reason = '',
): Promise<{ readonly job: NimiLocalAppScenarioJob }> {
  const command = AIC_COMMANDS.scenarioJobCancel;
  if (typeof reason !== 'string' || reason.trim() !== reason || reason.length > 512 || reason.includes('\0')) {
    throw invalidInput(command, 'reason is invalid');
  }
  return invokeChecked(command, { payload: {
    jobId: requiredText(jobId, 'jobId', command, 128), reason,
  } }, (value) => parseScenarioJobEnvelope(value, command));
}

export function readNimiLocalAppScenarioArtifact(artifactId: string): Promise<{ readonly bytes: readonly number[]; readonly mimeType: string; readonly sizeBytes: number }> {
  const command = AIC_COMMANDS.artifactRead;
  return invokeChecked(command, { payload: {
    artifactId: requiredText(artifactId, 'artifactId', command, 128),
  } }, (value) => parseArtifactRead(value, command));
}

export function uploadNimiLocalAppScenarioArtifact(input: {
  readonly bytes: readonly number[];
  readonly mimeType: NimiLocalAppArtifactUploadResult['mimeType'];
}): Promise<NimiLocalAppArtifactUploadResult> {
  const command = AIC_COMMANDS.artifactUpload;
  assertAllowedInputKeys(input, ['bytes', 'mimeType'], ['bytes', 'mimeType'], command);
  if (!Array.isArray(input.bytes) || input.bytes.length === 0 || input.bytes.length > 32 * 1024 * 1024
    || input.bytes.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mimeType)) {
    throw invalidInput(command, 'artifact upload is invalid');
  }
  return invokeChecked(command, { payload: { bytes: [...input.bytes], mimeType: input.mimeType } },
    (value) => parseArtifactUpload(value, command, input.bytes.length, input.mimeType));
}

export function listNimiLocalAppVoiceAssets(
  input: { readonly pageSize?: number; readonly pageToken?: string } = {},
): Promise<{ readonly assets: readonly NimiLocalAppVoiceAsset[]; readonly nextPageToken: string }> {
  const command = AIC_COMMANDS.voiceAssetsList;
  assertAllowedInputKeys(input, ['pageSize', 'pageToken'], [], command);
  const pageSize = input.pageSize === undefined ? 0 : nonNegativeInteger(input.pageSize, command, 'pageSize');
  const pageToken = input.pageToken ?? '';
  if (pageSize > 200 || !/^[0-9]{0,10}$/u.test(pageToken)) throw invalidInput(command, 'page is invalid');
  return invokeChecked(command, { payload: { pageSize, pageToken } },
    (value) => parseVoiceAssetsList(value, command));
}

function canonicalScenarioSpec(spec: Readonly<JsonObject>, command: string): JsonObject {
  const record = assertRecord(spec, `${command}: scenario spec must be an object`);
  validateProjectionValue(record as JsonValue, command);
  const encoded = JSON.stringify(record);
  if (new TextEncoder().encode(encoded).byteLength > 40 * 1024 * 1024) {
    throw invalidInput(command, 'scenario spec exceeds the input bound');
  }
  return { ...record } as JsonObject;
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
  assertAllowedInputKeys(
    record,
    ['core', 'id', 'lorebookDeclaration', 'origin', 'visibility'],
    ['core', 'lorebookDeclaration', 'origin'],
    command,
  );
  const core = assertRecord(record.core, `${command}: core must be an object`);
  const lorebookDeclaration = assertRecord(
    record.lorebookDeclaration,
    `${command}: lorebookDeclaration must be an object`,
  );
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
  validateStorageJsonValue(lorebookDeclaration, command);
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

export function listNimiLocalAppOwnedPersonaCharacters(
  input: NimiLocalAppPersonaCharacterListOwnedInput = {},
): Promise<readonly JsonObject[]> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterListOwned'];
  assertAllowedInputKeys(input, ['worldId', 'visibility', 'afterId', 'take'], [], command);
  const payload: JsonObject = {};
  if (input.worldId !== undefined) payload.worldId = requiredText(input.worldId, 'worldId', command, MAX_IDENTIFIER_LENGTH);
  if (input.visibility !== undefined) payload.visibility = personaWritableVisibility(input.visibility, command);
  if (input.afterId !== undefined) payload.afterId = requiredText(input.afterId, 'afterId', command, MAX_IDENTIFIER_LENGTH);
  if (input.take !== undefined) payload.take = boundedSafeInteger(input.take, 'take', command, 1, 500);
  return invokeChecked(command, { payload }, (value) => {
    if (!Array.isArray(value) || value.length > 500) throw new Error(`${command}: result must be a bounded array`);
    return Object.freeze(value.map((entry) => parseOpaquePersonaProjection(entry, command)));
  });
}

export function getNimiLocalAppOwnedPersonaCharacter(personaCharacterId: string): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterGetOwned'];
  return invokeChecked(
    command,
    { payload: { personaCharacterId: requiredText(personaCharacterId, 'personaCharacterId', command, MAX_IDENTIFIER_LENGTH) } },
    (value) => parseOpaquePersonaProjection(value, command),
  );
}

export function createNimiLocalAppPersonaCharacter(input: JsonObject): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterCreate'];
  const payload = personaCharacterWriteInput(input, false, command);
  return invokeChecked(command, { payload }, (value) => parseOpaquePersonaProjection(value, command));
}

export function replaceNimiLocalAppPersonaCharacter(input: JsonObject): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterReplace'];
  const payload = personaCharacterWriteInput(input, true, command);
  return invokeChecked(command, { payload }, (value) => parseOpaquePersonaProjection(value, command));
}

export function deleteNimiLocalAppPersonaCharacter(personaCharacterId: string): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmPersonaCharacterDelete'];
  const id = requiredText(personaCharacterId, 'personaCharacterId', command, MAX_IDENTIFIER_LENGTH);
  return invokeChecked(command, { payload: { personaCharacterId: id } }, (value) => {
    const result = assertRecord(value, `${command}: result must be an object`);
    assertAllowedInputKeys(result, ['personaCharacterId', 'deleted'], ['personaCharacterId', 'deleted'], command);
    if (result.personaCharacterId !== id || result.deleted !== true) {
      throw new Error(`${command}: result is invalid`);
    }
    return Object.freeze({ personaCharacterId: id, deleted: true });
  });
}

export function listNimiLocalAppRealmChats(
  input: { readonly cursor?: string; readonly limit?: number } = {},
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.realmChatList'];
  assertAllowedInputKeys(input, ['cursor', 'limit'], [], command);
  const payload: JsonObject = {};
  if (input.cursor !== undefined) payload.cursor = requiredText(input.cursor, 'cursor', command, MAX_IDENTIFIER_LENGTH);
  if (input.limit !== undefined) payload.limit = boundedSafeInteger(input.limit, 'limit', command, 1, 50);
  return invokeChecked(command, { payload }, (value) => Object.freeze(parseSafeProjection(value, command)));
}

function personaCharacterWriteInput(input: JsonObject, replace: boolean, command: string): JsonObject {
  const record = assertRecord(input, `${command}: input must be an object`);
  const keys = replace
    ? ['personaCharacterId', 'baseContentHash', 'worldId', 'visibility', 'origin', 'lorebookDeclaration', 'profile']
    : ['worldId', 'visibility', 'origin', 'lorebookDeclaration', 'profile'];
  assertAllowedInputKeys(record, keys, keys, command);
  requiredText(record.worldId, 'worldId', command, MAX_IDENTIFIER_LENGTH);
  personaWritableVisibility(record.visibility, command);
  if (!record.origin || typeof record.origin !== 'object' || Array.isArray(record.origin)
    || !record.lorebookDeclaration || typeof record.lorebookDeclaration !== 'object' || Array.isArray(record.lorebookDeclaration)
    || !record.profile || typeof record.profile !== 'object' || Array.isArray(record.profile)) {
    throw invalidInput(command, 'origin, lorebookDeclaration, and profile must be objects');
  }
  if (replace) {
    requiredText(record.personaCharacterId, 'personaCharacterId', command, MAX_IDENTIFIER_LENGTH);
    if (typeof record.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(record.baseContentHash)) {
      throw invalidInput(command, 'baseContentHash is invalid');
    }
  }
  validateStorageJsonValue(record, command);
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_WORLD_CORE_REQUEST_BYTES) {
    throw new BridgeError('PersonaCharacter request is too large', command, {
      code: 'request-too-large', reasonCode: 'request-too-large', actionHint: 'reduce_persona_character_request', source: 'renderer',
    });
  }
  return { ...record } as JsonObject;
}

function parseOpaquePersonaProjection(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command}: PersonaCharacter result must be an object`);
  validateStorageJsonValue(record, command);
  return Object.freeze(record);
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
      return Object.freeze({
        agentHandle: agentHandle as NimiLocalAppAgentHandle,
        displayName,
        avatarUrl: avatarUrl as string | null,
      });
    }));
  });
}

export function getNimiLocalAppSharedAgentAIConfig(): Promise<NimiAIConfigSnapshot> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigGet'];
  return invokeChecked(command, {}, (value) => parseSharedAgentAIConfigSnapshot(value, command));
}

export function overwriteNimiLocalAppSharedAgentAIConfig(
  input: NimiAIConfigOverwriteInput,
): Promise<NimiAIConfigOverwriteResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigOverwrite'];
  const payload = canonicalAIConfigCapabilities(input.capabilities, command);
  return invokeChecked(
    command,
    { payload: { expectedRevision: input.expectedRevision, capabilities: payload } },
    (value) => parseSharedAgentAIConfigOverwrite(value, command),
  );
}

export function listNimiLocalAppSharedAgentAIConfigOptions(
  query: NimiSharedLocalAgentAIConfigOptionsQuery,
): Promise<NimiSharedLocalAgentAIConfigOptionsResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sharedAgentAIConfigLocalOptions'];
  return invokeChecked(command, {
    kind: query.kind,
    capabilityContract: query.kind === 'preset-voices'
      ? ''
      : requiredText(query.capabilityContract, 'capabilityContract', command, MAX_IDENTIFIER_LENGTH),
    ...(query.kind === 'cloud-targets'
      ? { connectorRef: requiredText(query.connectorRef, 'connectorRef', command, MAX_IDENTIFIER_LENGTH) }
      : {}),
    search: query.kind === 'preset-voices' ? '' : query.search ?? '',
  }, (value) => parseSharedAgentAIConfigOptions(value, command));
}

export function getNimiLocalAppAgentManagerSnapshot(input: {
  readonly agentHandle: string;
  readonly conversationAnchorId?: string;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentManagerSnapshot'];
  assertAllowedInputKeys(input, ['agentHandle', 'conversationAnchorId'], ['agentHandle'], command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    ...(input.conversationAnchorId === undefined
      ? {}
      : { conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH) }),
  });
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

function agentPresentationIntentPayload(value: unknown, command: string): JsonObject {
  const intent = assertRecord(value, `${command}: intent must be an object`);
  const allowed = [
    'backendKind', 'avatarAssetRef', 'expressionProfileRef', 'idlePreset',
    'interactionPolicyRef', 'defaultVoiceReference', 'avatarAutoplay', 'backgroundAssetRef',
  ];
  assertAllowedInputKeys(intent, allowed, [], command);
  if (Object.keys(intent).length === 0) throw invalidInput(command, 'intent requires a patch field');
  if (intent.backendKind !== undefined
    && !['vrm', 'live2d', 'sprite2d', 'canvas2d', 'video'].includes(String(intent.backendKind))) {
    throw invalidInput(command, 'intent.backendKind is invalid');
  }
  if (intent.avatarAutoplay !== undefined && typeof intent.avatarAutoplay !== 'boolean') {
    throw invalidInput(command, 'intent.avatarAutoplay is invalid');
  }
  const projected: JsonObject = {};
  if (intent.backendKind !== undefined) projected.backendKind = intent.backendKind as string;
  for (const key of [
    'avatarAssetRef', 'expressionProfileRef', 'idlePreset', 'interactionPolicyRef',
    'defaultVoiceReference', 'backgroundAssetRef',
  ]) {
    if (intent[key] !== undefined) {
      if (typeof intent[key] !== 'string' || intent[key].trim() !== intent[key]
        || new TextEncoder().encode(intent[key]).byteLength > MAX_IDENTIFIER_LENGTH) {
        throw invalidInput(command, `intent.${key} is invalid`);
      }
      projected[key] = intent[key] as string;
    }
  }
  if (intent.avatarAutoplay !== undefined) projected.avatarAutoplay = intent.avatarAutoplay;
  return projected;
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
  const intent = agentPresentationIntentPayload(input.intent, command);
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
    intent,
    importedAssets: importedAssets as unknown as JsonValue,
  });
}

export function inspectNimiLocalAppAgentMemory(input: {
  readonly agentHandle: string;
  readonly limit?: number;
  readonly pageToken?: string;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemoryInspect'];
  assertAllowedInputKeys(input, ['agentHandle', 'limit', 'pageToken'], ['agentHandle'], command);
  const limit = input.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw invalidInput(command, 'limit is invalid');
  }
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    limit,
    pageToken: memoryPageToken(input.pageToken ?? '', command),
  });
}

export function correctNimiLocalAppAgentMemory(input: { readonly agentHandle: string; readonly memoryId: string; readonly correctedContent: string }): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemoryCorrect'];
  assertExactInput(input, ['agentHandle', 'memoryId', 'correctedContent'], command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    memoryId: requiredText(input.memoryId, 'memoryId', command, MAX_IDENTIFIER_LENGTH),
    correctedContent: requiredText(input.correctedContent, 'correctedContent', command, 16 * 1024),
  });
}

export function forgetNimiLocalAppAgentMemory(input: { readonly agentHandle: string; readonly memoryIds: readonly string[]; readonly confirmed: true }): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemoryForget'];
  assertExactInput(input, ['agentHandle', 'memoryIds', 'confirmed'], command);
  if (input.confirmed !== true || !Array.isArray(input.memoryIds) || input.memoryIds.length === 0 || input.memoryIds.length > 100) throw invalidInput(command, 'confirmed exact Memory targets are required');
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    memoryIds: input.memoryIds.map((id, index) => requiredText(id, `memoryIds[${index}]`, command, MAX_IDENTIFIER_LENGTH)),
    confirmed: true,
  });
}

export function setNimiLocalAppAgentMemoryEnabled(input: { readonly agentHandle: string; readonly enabled: boolean }): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemorySwitch'];
  assertExactInput(input, ['agentHandle', 'enabled'], command);
  if (typeof input.enabled !== 'boolean') throw invalidInput(command, 'enabled is invalid');
  return invokeLocalAppRecord(command, { agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH), enabled: input.enabled });
}

export function deleteAllNimiLocalAppAgentMemory(input: { readonly agentHandle: string; readonly confirmed: true }): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentMemoryDelete'];
  assertExactInput(input, ['agentHandle', 'confirmed'], command);
  if (input.confirmed !== true) throw invalidInput(command, 'confirmation is required');
  return invokeLocalAppRecord(command, { agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH), confirmed: true });
}

function invokeAgentConfigureHandle(
  operation: 'local-app.agentAutonomySnapshot' | 'local-app.agentPresentationSnapshot',
  input: { readonly agentHandle: string },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS[operation];
  return invokeLocalAppRecord(command, identifiers(input, ['agentHandle'], command));
}

function memoryPageToken(value: unknown, command: string): string {
  if (typeof value !== 'string' || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > 1024
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw invalidInput(command, 'pageToken is invalid');
  }
  return value;
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
  readonly parts: readonly (
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'artifact-ref'; readonly artifactId: string }
  )[];
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'requestId', 'parts'], command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    requestId: requiredText(input.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
    parts: parseConversationInputParts(input.parts, command),
  });
}

export function uploadNimiLocalAppConversationAttachment(
  input: NimiLocalAppConversationScopeInput & {
    readonly mimeType: string;
    readonly displayName?: string;
    readonly bytes: readonly number[];
  },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationAttachmentUpload'];
  assertExactInput(
    input,
    input.displayName === undefined
      ? ['agentHandle', 'conversationAnchorId', 'mimeType', 'bytes']
      : ['agentHandle', 'conversationAnchorId', 'mimeType', 'displayName', 'bytes'],
    command,
  );
  if (!Array.isArray(input.bytes) || input.bytes.length === 0 || input.bytes.length > 4 * 1024 * 1024
    || input.bytes.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mimeType)) {
    throw new Error(`${command}: attachment upload is invalid`);
  }
  const displayName = input.displayName === undefined
    ? undefined
    : requiredUtf8Text(input.displayName, 'displayName', command, 255);
  return invokeChecked(command, { payload: {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    mimeType: input.mimeType,
    ...(displayName ? { displayName } : {}),
    bytes: [...input.bytes],
  } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid attachment upload`);
    assertProjectionKeys(record, ['artifactId', 'expiresAt'], command, 'conversation attachment upload');
    const expiresAt = parseRequiredString(record.expiresAt, 'expiresAt', command);
    if (!Number.isFinite(Date.parse(expiresAt))) throw new Error(`${command}: expiresAt is invalid`);
    return Object.freeze({
      artifactId: requiredText(record.artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH),
      expiresAt,
    });
  });
}

export function readNimiLocalAppConversationArtifact(
  input: NimiLocalAppConversationScopeInput & { readonly artifactId: string },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationArtifactRead'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'artifactId'], command);
  return invokeChecked(command, { payload: identifiers(input, ['agentHandle', 'conversationAnchorId', 'artifactId'], command) }, (value) => {
    const record = assertRecord(value, `${command} returned invalid artifact read`);
    assertProjectionKeys(record, ['artifactId', 'bytes', 'mimeType', 'byteLength'], command, 'conversation artifact read');
    if (!Array.isArray(record.bytes) || record.bytes.length === 0 || record.bytes.length > 32 * 1024 * 1024
      || record.bytes.some((entry) => !Number.isInteger(entry) || Number(entry) < 0 || Number(entry) > 255)
      || typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength)
      || record.byteLength !== record.bytes.length) {
      throw new Error(`${command}: artifact read body is invalid`);
    }
    return Object.freeze({
      artifactId: requiredText(record.artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH),
      bytes: Object.freeze([...record.bytes] as number[]),
      mimeType: requiredText(record.mimeType, 'mimeType', command, 128),
      byteLength: record.byteLength,
    });
  });
}

export function transcribeNimiLocalAppConversationVoice(
  input: NimiLocalAppConversationScopeInput & {
    readonly requestId: string;
    readonly mimeType: string;
    readonly audioBytes: readonly number[];
  },
  options?: { readonly signal?: AbortSignal },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationVoiceTranscribe'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'requestId', 'mimeType', 'audioBytes'], command);
  if (!Array.isArray(input.audioBytes) || input.audioBytes.length === 0 || input.audioBytes.length > 6 * 1024 * 1024
    || input.audioBytes.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)
    || !input.mimeType.startsWith('audio/') || input.mimeType.trim() !== input.mimeType
    || /[\u0000-\u001f\u007f]/u.test(input.mimeType)) {
    throw new Error(`${command}: voice input is invalid`);
  }
  const operation = invokeChecked(command, { payload: {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    requestId: requiredText(input.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
    mimeType: input.mimeType,
    audioBytes: [...input.audioBytes],
  } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid transcription`);
    assertProjectionKeys(record, ['text'], command, 'conversation voice transcription');
    return Object.freeze({ text: requiredUtf8Content(record.text, 'text', command, 64 * 1024) });
  });
  const signal = options?.signal;
  if (!signal) return operation;
  return abortableConversationVoiceTranscription(command, input.requestId, signal, operation);
}

export function renderNimiLocalAppConversationVoice(
  input: NimiLocalAppConversationScopeInput & {
    readonly messageId: string;
    readonly requestId: string;
  },
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationVoiceRender'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'messageId', 'requestId'], command);
  return invokeChecked(command, { payload: identifiers(
    input,
    ['agentHandle', 'conversationAnchorId', 'messageId', 'requestId'],
    command,
  ) }, (value) => {
    const record = assertRecord(value, `${command} returned invalid voice render`);
    assertProjectionKeys(record, ['voice'], command, 'conversation voice render');
    return Object.freeze({ voice: parseConversationVoice(record.voice, command) });
  });
}

function abortableConversationVoiceTranscription(
  command: string,
  requestId: string,
  signal: AbortSignal,
  operation: Promise<JsonObject>,
): Promise<JsonObject> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => {
      void invoke(command, { payload: { action: 'cancel', requestId } }).catch(() => undefined);
      const error = new Error('Local-app conversation voice transcription was canceled.');
      error.name = 'AbortError';
      finish(() => reject(error));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
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

export function openNimiLocalAppAiRealtime(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.aiRealtimeOpen'], input);
}

export function openNimiLocalAppRealmRealtime(): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.realmRealtimeOpen'], {});
}

export function subscribeNimiLocalAppRealmRealtime(input: JsonObject): Promise<NimiLocalAppRealtimeSubscription> {
  return subscribeNimiLocalAppRealtime(NIMI_STANDARD_SHELL_COMMANDS['local-app.realmRealtimeSubscribe'], input);
}

export function ackNimiLocalAppRealmRealtime(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.realmRealtimeAck'], input);
}

export function closeNimiLocalAppRealmRealtimeSubscription(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.realmRealtimeSubscriptionClose'], input);
}

export function closeNimiLocalAppRealmRealtimeChannel(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.realmRealtimeChannelClose'], input);
}

export function appendNimiLocalAppAiRealtimeInput(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.aiRealtimeAppendInput'], input);
}

export function submitNimiLocalAppAiRealtimeOwnerControl(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.aiRealtimeSubmitOwnerControl'], input);
}

export function interruptNimiLocalAppAiRealtimeOutput(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.aiRealtimeInterruptOutput'], input);
}

export function closeNimiLocalAppAiRealtime(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.aiRealtimeClose'], input);
}

export function openNimiLocalAppAgentRealtime(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.agentRealtimeOpen'], input);
}

export function appendNimiLocalAppAgentRealtimeInput(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.agentRealtimeAppendInput'], input);
}

export function getNimiLocalAppAgentRealtimeStatus(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.agentRealtimeStatus'], input);
}

export function interruptNimiLocalAppAgentRealtimeOutput(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.agentRealtimeInterruptOutput'], input);
}

export function closeNimiLocalAppAgentRealtime(input: JsonObject): Promise<JsonObject> {
  return invokeRealtimeRecord(NIMI_STANDARD_SHELL_COMMANDS['local-app.agentRealtimeClose'], input);
}

export function subscribeNimiLocalAppAiRealtime(input: JsonObject): Promise<NimiLocalAppRealtimeSubscription> {
  return subscribeNimiLocalAppRealtime(NIMI_STANDARD_SHELL_COMMANDS['local-app.aiRealtimeSubscribe'], input);
}

export function subscribeNimiLocalAppAgentRealtime(input: JsonObject): Promise<NimiLocalAppRealtimeSubscription> {
  return subscribeNimiLocalAppRealtime(NIMI_STANDARD_SHELL_COMMANDS['local-app.agentRealtimeSubscribe'], input);
}

async function subscribeNimiLocalAppRealtime(
  command: string,
  input: JsonObject,
): Promise<NimiLocalAppRealtimeSubscription> {
  const opened = await invokeChecked(command, { payload: input }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    assertProjectionKeys(record, ['subscriptionId', 'eventName'], command, 'Realtime subscription');
    return {
      subscriptionId: requiredText(record.subscriptionId, 'subscriptionId', command, MAX_IDENTIFIER_LENGTH),
      eventName: requiredText(record.eventName, 'eventName', command, MAX_IDENTIFIER_LENGTH),
    };
  });
  const subscription = new LocalAppRealtimeEventSubscription(command, opened.subscriptionId);
  try {
    subscription.attach(await listenShell(opened.eventName, ({ payload }) => subscription.accept(payload)));
  } catch (error) {
    await subscription.cancel().catch(() => undefined);
    throw error;
  }
  return subscription;
}

function invokeRealtimeRecord(command: string, payload: JsonObject): Promise<JsonObject> {
  return invokeChecked(command, { payload }, (value) => parseSafeProjection(value, command));
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

export function createNimiLocalAppAssetShell(): NimiLocalAppAssetShell {
  return Object.freeze({
    stat: statNimiLocalAppAsset,
    list: listNimiLocalAppAssets,
    write: writeNimiLocalAppAsset,
    read: readNimiLocalAppAsset,
    remove: removeNimiLocalAppAsset,
    move: moveNimiLocalAppAsset,
    reveal: revealNimiLocalAppAsset,
    adoptArtifact: adoptNimiLocalAppArtifact,
  });
}

export function statNimiLocalAppAsset(relativePath: string): Promise<NimiLocalAppAssetRecord> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetStat'];
  return invokeChecked(command, { payload: { relativePath: canonicalAssetPath(relativePath, command) } },
    (value) => parseAssetRecord(value, command));
}

export function listNimiLocalAppAssets(input: {
  readonly prefix: string; readonly cursor?: string; readonly pageSize?: number;
}): Promise<{ readonly assets: readonly NimiLocalAppAssetRecord[]; readonly nextCursor: string }> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetList'];
  if (!input || typeof input !== 'object') throw new Error(`${command}: input is invalid`);
  const prefix = input.prefix === '' ? '' : canonicalAssetPrefix(input.prefix, command);
  const cursor = input.cursor ?? '';
  const pageSize = input.pageSize ?? 0;
  if (typeof cursor !== 'string' || cursor.length > 4096 || !Number.isSafeInteger(pageSize) || pageSize < 0 || pageSize > 500) {
    throw new Error(`${command}: page is invalid`);
  }
  return invokeChecked(command, { payload: { prefix, cursor, pageSize } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    assertProjectionKeys(record, ['assets', 'nextCursor'], command, 'asset list');
    if (!Array.isArray(record.assets) || record.assets.length > 500 || typeof record.nextCursor !== 'string') {
      throw new Error(`${command}: asset list is invalid`);
    }
    return Object.freeze({ assets: Object.freeze(record.assets.map((asset) => parseAssetRecord(asset, command))), nextCursor: record.nextCursor });
  });
}

export async function writeNimiLocalAppAsset(input: {
  readonly relativePath: string; readonly body: NimiLocalAppAssetBody; readonly mediaType?: string; readonly overwrite?: boolean;
}): Promise<NimiLocalAppAssetRecord> {
  const openCommand = NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteOpen'];
  const relativePath = canonicalAssetPath(input.relativePath, openCommand);
  const mediaType = input.mediaType === undefined ? '' : canonicalMediaType(input.mediaType, openCommand);
  if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') throw new Error(`${openCommand}: overwrite is invalid`);
  const opened = await invokeChecked(openCommand, { payload: { relativePath, mediaType, overwrite: input.overwrite ?? false } },
    (value) => parseStreamId(value, openCommand));
  let committed = false;
  try {
    for await (const chunk of assetBodyChunks(input.body, openCommand)) {
      await invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteChunk'],
        { payload: { streamId: opened.streamId, bodyChunk: chunk } },
        (value) => parseBooleanResult(value, 'accepted', openCommand));
    }
    const asset = await invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteCommit'],
      { payload: { streamId: opened.streamId } }, (value) => parseAssetRecord(value, openCommand));
    committed = true;
    return asset;
  } finally {
    if (!committed) {
      await invoke(NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteAbort'], { payload: { streamId: opened.streamId } }).catch(() => undefined);
    }
  }
}

export async function readNimiLocalAppAsset(input: {
  readonly relativePath: string; readonly offset?: number; readonly length?: number;
}): Promise<NimiLocalAppAssetReadResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadOpen'];
  const payload: Record<string, unknown> = { relativePath: canonicalAssetPath(input.relativePath, command) };
  if (input.offset !== undefined) payload.offset = boundedAssetRange(input.offset, false, command);
  if (input.length !== undefined) payload.length = boundedAssetRange(input.length, true, command);
  const opened = await invokeChecked(command, { payload }, (value) => parseAssetReadOpen(value, command));
  const body = Object.freeze({
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      try {
        while (true) {
          const next = await invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadNext'],
            { payload: { streamId: opened.streamId } }, (value) => parseAssetReadNext(value, command));
          if (next.completed) return;
          yield next.bodyChunk;
        }
      } finally {
        await invoke(NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadClose'], { payload: { streamId: opened.streamId } }).catch(() => undefined);
      }
    },
  });
  return Object.freeze({ asset: opened.asset, range: opened.range, body });
}

export function removeNimiLocalAppAsset(relativePath: string): Promise<NimiLocalAppStorageRemoveResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetRemove'];
  return invokeChecked(command, { payload: { relativePath: canonicalAssetPath(relativePath, command) } },
    (value) => parseBooleanResult(value, 'removed', command) as NimiLocalAppStorageRemoveResult);
}

export function moveNimiLocalAppAsset(input: { readonly from: string; readonly to: string; readonly overwrite?: boolean }): Promise<NimiLocalAppAssetRecord> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetMove'];
  if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') throw new Error(`${command}: overwrite is invalid`);
  return invokeChecked(command, { payload: { fromRelativePath: canonicalAssetPath(input.from, command),
    toRelativePath: canonicalAssetPath(input.to, command), overwrite: input.overwrite ?? false } },
  (value) => parseAssetRecord(value, command));
}

export function revealNimiLocalAppAsset(relativePath: string): Promise<{ readonly revealed: true }> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetReveal'];
  return invokeChecked(command, { payload: { relativePath: canonicalAssetPath(relativePath, command) } }, (value) => {
    const result = parseBooleanResult(value, 'revealed', command);
    if (result.revealed !== true) throw new Error(`${command}: reveal did not complete`);
    return Object.freeze({ revealed: true as const });
  });
}

export function adoptNimiLocalAppArtifact(input: { readonly artifactId: string; readonly relativePath: string; readonly overwrite?: boolean }): Promise<NimiLocalAppAssetRecord> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetAdopt'];
  if (input.overwrite !== undefined && typeof input.overwrite !== 'boolean') throw new Error(`${command}: overwrite is invalid`);
  return invokeChecked(command, { payload: { artifactId: requiredText(input.artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH),
    relativePath: canonicalAssetPath(input.relativePath, command), overwrite: input.overwrite ?? false } },
  (value) => parseAssetRecord(value, command));
}

export async function openNimiLocalAppAssetMediaUrl(relativePath: string): Promise<NimiLocalAppAssetMediaHandle> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaOpen'];
  const opened = await invokeChecked(command, { payload: { relativePath: canonicalAssetPath(relativePath, command) } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid handle`);
    assertProjectionKeys(record, ['url', 'handle'], command, 'asset media handle');
    const handle = requiredText(record.handle, 'handle', command, 64);
    const url = requiredText(record.url, 'url', command, 256);
    if (url !== `nimi-app-asset://media/${handle}` || !/^[A-Za-z0-9_-]{43}$/u.test(handle)) {
      throw new Error(`${command}: opaque handle is invalid`);
    }
    return { url, handle };
  });
  let active = true;
  return Object.freeze({
    url: opened.url,
    async revoke() {
      if (!active) return;
      active = false;
      await invokeChecked(NIMI_STANDARD_SHELL_COMMANDS['storage.assetMediaRevoke'],
        { payload: { handle: opened.handle } }, (value) => parseBooleanResult(value, 'revoked', command));
    },
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
    case 'turn-started':
      assertProjectionKeys(record, common, command, 'turn started event');
      break;
    case 'text-delta':
      assertProjectionKeys(record, [...common, 'delta'], command, 'text delta event');
      if (typeof record.delta !== 'string' || !record.delta || new TextEncoder().encode(record.delta).byteLength > 16 * 1024 || record.delta.includes('\0')) {
        throw new Error(`${command}: text delta is invalid`);
      }
      break;
    case 'reasoning-status':
      assertProjectionKeys(record, [...common, 'state'], command, 'reasoning status event');
      if (!['started', 'active', 'completed'].includes(String(record.state))) throw new Error(`${command}: reasoning status is invalid`);
      break;
    case 'live-action': {
      assertProjectionKeys(record, [...common, 'action'], command, 'live action event');
      const action = parseConversationLiveChild(record.action, command, 'actionId');
      if (action.turnId !== record.turnId) throw new Error(`${command}: live action linkage is invalid`);
      break;
    }
    case 'live-tool': {
      assertProjectionKeys(record, [...common, 'tool'], command, 'live tool event');
      const tool = parseConversationLiveChild(record.tool, command, 'toolId');
      if (tool.turnId !== record.turnId) throw new Error(`${command}: live tool linkage is invalid`);
      break;
    }
    case 'message-committed':
      assertProjectionKeys(record, [...common, 'message'], command, 'message committed event');
      parseConversationMessage(record.message, command);
      break;
    case 'action-planned':
    case 'action-started':
    case 'action-completed':
    case 'action-failed': {
      assertProjectionKeys(record, [...common, 'action'], command, `${record.type} event`);
      const action = parseConversationAction(record.action, command);
      if (action.turnId !== record.turnId || action.status !== record.type.slice('action-'.length)) {
        throw new Error(`${command}: action event linkage is invalid`);
      }
      break;
    }
    case 'artifact-ready':
      assertProjectionKeys(
        record,
        [...common, 'actionId', 'capabilityContract', 'projectionMessageId', 'artifactId'],
        command,
        'artifact ready event',
      );
      if (record.capabilityContract !== 'image.generate') throw new Error(`${command}: artifact capability is invalid`);
      parseRequiredString(record.actionId, 'actionId', command);
      parseRequiredString(record.projectionMessageId, 'projectionMessageId', command);
      parseRequiredString(record.artifactId, 'artifactId', command);
      break;
    case 'voice-ready':
    case 'voice-failed': {
      assertProjectionKeys(record, [...common, 'voice'], command, `${record.type} event`);
      const voice = parseConversationVoice(record.voice, command);
      if (voice.turnId !== record.turnId || voice.state !== record.type.slice('voice-'.length)) {
        throw new Error(`${command}: voice event linkage is invalid`);
      }
      break;
    }
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

function parseConversationLiveChild(
  value: unknown,
  command: string,
  idField: 'actionId' | 'toolId',
): JsonObject {
  const child = assertRecord(value, `${command} emitted invalid live child`);
  assertProjectionKeys(child, ['turnId', idField, 'name', 'lifecycle', 'progress', 'result', 'reasonCode'], command, 'live child');
  parseRequiredString(child.turnId, 'turnId', command);
  parseRequiredString(child[idField], idField, command);
  const name = parseRequiredString(child.name, 'name', command);
  if (new TextEncoder().encode(name).byteLength > 256
    || !['started', 'updated', 'completed', 'failed'].includes(String(child.lifecycle))
    || (child.progress !== null && (typeof child.progress !== 'string' || !child.progress || child.progress.length > 16 * 1024 || child.progress.includes('\0')))
    || (child.result !== null && (typeof child.result !== 'string' || !child.result || child.result.length > 16 * 1024 || child.result.includes('\0')))
    || (child.reasonCode !== null && (typeof child.reasonCode !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(child.reasonCode)))) {
    throw new Error(`${command}: live child is invalid`);
  }
  const valid = child.lifecycle === 'started'
    ? child.progress === null && child.result === null && child.reasonCode === null
    : child.lifecycle === 'updated'
      ? ((child.progress === null) !== (child.result === null)) && child.reasonCode === null
      : child.lifecycle === 'completed'
        ? child.progress === null && child.reasonCode === null
        : child.result === null && child.reasonCode !== null;
  if (!valid) throw new Error(`${command}: live child terminal is invalid`);
  return child;
}

function parseConversationSnapshot(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command} returned invalid conversation snapshot`);
  assertProjectionKeys(
    record,
    ['conversationAnchorId', 'throughSequence', 'turns', 'messages', 'actions', 'voices', 'truncatedBefore'],
    command,
    'conversation snapshot',
  );
  const conversationAnchorId = parseRequiredString(record.conversationAnchorId, 'conversationAnchorId', command);
  if (typeof record.throughSequence !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(record.throughSequence)
    || !Array.isArray(record.turns) || record.turns.length > 201
    || !Array.isArray(record.messages) || record.messages.length > 203
    || !Array.isArray(record.actions) || record.actions.length > 201
    || !Array.isArray(record.voices) || record.voices.length > 201
    || typeof record.truncatedBefore !== 'boolean') {
    throw new Error(`${command}: conversation snapshot is invalid`);
  }
  let textBytes = 0;
  const turns = record.turns.map((value) => parseConversationTurn(value, command));
  const messages = record.messages.map((value) => parseConversationMessage(value, command, (text) => {
    textBytes += new TextEncoder().encode(text).byteLength;
    if (textBytes > 1024 * 1024 + 128 * 1024) throw new Error(`${command}: conversation snapshot is too large`);
  }));
  const actions = record.actions.map((value) => parseConversationAction(value, command));
  const voices = record.voices.map((value) => parseConversationVoice(value, command));
  const turnIds = new Set(turns.map((turn) => turn.turnId));
  if (turnIds.size !== turns.length
    || messages.some((message) => !turnIds.has(message.turnId))
    || actions.some((action) => !turnIds.has(action.turnId))
    || voices.some((voice) => !turnIds.has(voice.turnId))) {
    throw new Error(`${command}: conversation snapshot references are invalid`);
  }
  return Object.freeze({
    conversationAnchorId,
    throughSequence: record.throughSequence,
    turns: Object.freeze(turns),
    messages: Object.freeze(messages),
    actions: Object.freeze(actions),
    voices: Object.freeze(voices),
    truncatedBefore: record.truncatedBefore,
  }) as JsonObject;
}

function parseConversationMessage(
  value: unknown,
  command: string,
  observeText: (text: string) => void = () => {},
): JsonObject {
  const message = assertRecord(value, `${command} returned invalid conversation message`);
  assertProjectionKeys(message, ['messageId', 'turnId', 'role', 'parts'], command, 'conversation message');
  if ((message.role !== 'user' && message.role !== 'assistant')
    || !Array.isArray(message.parts) || message.parts.length < 1 || message.parts.length > 2) {
    throw new Error(`${command}: conversation message is invalid`);
  }
  let textCount = 0;
  let artifactCount = 0;
  const parts = message.parts.map((value) => {
    const part = assertRecord(value, `${command} returned invalid conversation message part`);
    if (part.kind === 'text') {
      assertProjectionKeys(part, ['kind', 'text'], command, 'conversation text part');
      const text = parseRequiredString(part.text, 'text', command);
      textCount += 1;
      observeText(text);
      return Object.freeze({ kind: 'text', text });
    }
    if (part.kind === 'artifact-ref') {
      assertProjectionKeys(
        part,
        ['kind', 'artifactId', 'mediaKind', 'mimeType', 'displayName'],
        command,
        'conversation artifact part',
      );
      if (part.mediaKind !== 'image'
        || typeof part.mimeType !== 'string'
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mimeType)
        || (part.displayName !== null && typeof part.displayName !== 'string')) {
        throw new Error(`${command}: conversation artifact part is invalid`);
      }
      artifactCount += 1;
      return Object.freeze({
        kind: 'artifact-ref',
        artifactId: parseRequiredString(part.artifactId, 'artifactId', command),
        mediaKind: 'image',
        mimeType: part.mimeType,
        displayName: part.displayName,
      });
    }
    throw new Error(`${command}: conversation message part kind is invalid`);
  });
  if (textCount > 1 || artifactCount > 1
    || (message.role === 'assistant' && textCount === 1 && artifactCount === 1)) {
    throw new Error(`${command}: conversation message cardinality is invalid`);
  }
  return Object.freeze({
    messageId: parseRequiredString(message.messageId, 'messageId', command),
    turnId: parseRequiredString(message.turnId, 'turnId', command),
    role: message.role,
    parts: Object.freeze(parts),
  }) as JsonObject;
}

function parseConversationTurn(value: unknown, command: string): JsonObject {
  const turn = assertRecord(value, `${command} returned invalid conversation turn`);
  assertProjectionKeys(turn, ['turnId', 'status', 'phase', 'terminalReason', 'reasonCode', 'message'], command, 'conversation turn');
  if (!['active', 'completed', 'failed', 'interrupted'].includes(String(turn.status))
    || (turn.phase !== null && turn.phase !== 'accepted' && turn.phase !== 'started')
    || (turn.terminalReason !== null && typeof turn.terminalReason !== 'string')
    || (turn.reasonCode !== null && typeof turn.reasonCode !== 'string')
    || (turn.message !== null && typeof turn.message !== 'string')) {
    throw new Error(`${command}: conversation turn is invalid`);
  }
  return Object.freeze({
    ...turn,
    turnId: parseRequiredString(turn.turnId, 'turnId', command),
  }) as JsonObject;
}

function parseConversationAction(value: unknown, command: string): JsonObject {
  const action = assertRecord(value, `${command} returned invalid conversation action`);
  assertProjectionKeys(
    action,
    ['actionId', 'turnId', 'capabilityContract', 'status', 'projectionMessageId', 'artifactId', 'reasonCode', 'message'],
    command,
    'conversation action',
  );
  if (action.capabilityContract !== 'image.generate'
    || !['planned', 'started', 'completed', 'failed'].includes(String(action.status))
    || (action.projectionMessageId !== null && typeof action.projectionMessageId !== 'string')
    || (action.artifactId !== null && typeof action.artifactId !== 'string')
    || (action.reasonCode !== null && typeof action.reasonCode !== 'string')
    || (action.message !== null && typeof action.message !== 'string')) {
    throw new Error(`${command}: conversation action is invalid`);
  }
  return Object.freeze({
    ...action,
    actionId: parseRequiredString(action.actionId, 'actionId', command),
    turnId: parseRequiredString(action.turnId, 'turnId', command),
  }) as JsonObject;
}

function parseConversationVoice(value: unknown, command: string): JsonObject {
  const voice = assertRecord(value, `${command} returned invalid conversation voice`);
  assertProjectionKeys(voice, ['voiceId', 'turnId', 'messageId', 'state', 'artifactId', 'reasonCode', 'message'], command, 'conversation voice');
  if ((voice.state !== 'ready' && voice.state !== 'failed')
    || (voice.artifactId !== null && typeof voice.artifactId !== 'string')
    || (voice.reasonCode !== null && typeof voice.reasonCode !== 'string')
    || (voice.message !== null && typeof voice.message !== 'string')) {
    throw new Error(`${command}: conversation voice is invalid`);
  }
  return Object.freeze({
    ...voice,
    voiceId: parseRequiredString(voice.voiceId, 'voiceId', command),
    turnId: parseRequiredString(voice.turnId, 'turnId', command),
    messageId: parseRequiredString(voice.messageId, 'messageId', command),
  }) as JsonObject;
}

function parseScenarioExecute(value: unknown, command: string): NimiLocalAppScenarioExecuteResult {
  const record = assertRecord(value, `${command}: execute result is invalid`);
  assertProjectionKeys(record, ['output', 'traceId'], command, 'scenario execute');
  requiredText(record.traceId, 'traceId', command, 512);
  const output = assertRecord(record.output, `${command}: execute output is invalid`);
  if (output.type === 'text-embed') {
    assertProjectionKeys(output, ['type', 'vectors'], command, 'embed output');
    if (!Array.isArray(output.vectors) || output.vectors.length === 0 || output.vectors.length > 16
      || output.vectors.some((vector) => !Array.isArray(vector) || vector.length === 0 || vector.length > 8192
        || vector.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry)))) {
      throw new Error(`${command}: embed output is invalid`);
    }
  } else if (output.type === 'image-generate') {
    assertProjectionKeys(output, ['type', 'artifacts'], command, 'image output');
    parseScenarioArtifacts(output.artifacts, command);
  } else throw new Error(`${command}: execute output type is invalid`);
  return Object.freeze({ ...record }) as unknown as NimiLocalAppScenarioExecuteResult;
}

function parseScenarioJobSubmit(value: unknown, command: string): NimiLocalAppScenarioJobSubmitResult {
  const record = assertRecord(value, `${command}: submit result is invalid`);
  assertProjectionKeys(record, ['job'], command, 'scenario Job submit');
  return Object.freeze({ job: parseScenarioJob(record.job, command) });
}

function parseScenarioJobGet(value: unknown, command: string): NimiLocalAppScenarioJobGetResult {
  const record = assertRecord(value, `${command}: Job result is invalid`);
  assertProjectionKeys(record, ['job', 'asset', 'voiceReference'], command, 'scenario Job result');
  const job = parseScenarioJob(record.job, command);
  const asset = record.asset === null ? null : parseVoiceAsset(record.asset, command);
  const voiceReference = record.voiceReference === null ? null : parseVoiceAssetReference(record.voiceReference, command);
  if ((asset === null) !== (voiceReference === null)
    || (asset && (asset.status !== 'active' || voiceReference?.voiceAssetId !== asset.voiceAssetId))
    || ((job.scenarioType === 'voice-create' && job.status === 'completed') !== (asset !== null))) {
    throw new Error(`${command}: scenario Job voice result is invalid`);
  }
  return Object.freeze({
    job,
    asset,
    voiceReference,
  }) as NimiLocalAppScenarioJobGetResult;
}

function parseScenarioJobEnvelope(value: unknown, command: string): { readonly job: NimiLocalAppScenarioJob } {
  const record = assertRecord(value, `${command}: Job result is invalid`);
  assertProjectionKeys(record, ['job'], command, 'scenario Job envelope');
  return Object.freeze({ job: parseScenarioJob(record.job, command) });
}

function parseScenarioJob(value: unknown, command: string): NimiLocalAppScenarioJob {
  const record = assertRecord(value, `${command}: Job is invalid`);
  assertProjectionKeys(record, [
    'jobId', 'scenarioType', 'status', 'progressPercent', 'progressCurrentStep',
    'progressTotalSteps', 'reasonCode', 'reasonDetail', 'artifacts', 'traceId',
    'createdAt', 'updatedAt', 'transcriptionText',
  ], command, 'scenario Job');
  if (!['image-generate', 'video-generate', 'speech-synthesize', 'speech-transcribe', 'voice-create', 'music-generate'].includes(String(record.scenarioType))
    || !['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'].includes(String(record.status))) {
    throw new Error(`${command}: Job enum is invalid`);
  }
  const progressCurrentStep = boundedProjectionInteger(record.progressCurrentStep, 0, Number.MAX_SAFE_INTEGER, command);
  const progressTotalSteps = boundedProjectionInteger(record.progressTotalSteps, 0, Number.MAX_SAFE_INTEGER, command);
  if (progressCurrentStep > progressTotalSteps) throw new Error(`${command}: Job progress is invalid`);
  return Object.freeze({
    jobId: requiredText(record.jobId, 'jobId', command, 128),
    scenarioType: record.scenarioType,
    status: record.status,
    progressPercent: boundedProjectionInteger(record.progressPercent, 0, 100, command),
    progressCurrentStep,
    progressTotalSteps,
    reasonCode: optionalProjectionText(record.reasonCode, 128, command),
    reasonDetail: optionalProjectionText(record.reasonDetail, 1024, command),
    artifacts: parseScenarioArtifacts(record.artifacts, command),
    traceId: optionalProjectionText(record.traceId, 512, command),
    createdAt: parseScenarioTimestamp(record.createdAt, command),
    updatedAt: parseScenarioTimestamp(record.updatedAt, command),
    transcriptionText: optionalProjectionText(record.transcriptionText, 256 * 1024, command),
  }) as unknown as NimiLocalAppScenarioJob;
}

function parseScenarioArtifacts(value: unknown, command: string): readonly NimiLocalAppScenarioArtifact[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error(`${command}: artifacts are invalid`);
  return Object.freeze(value.map((entry) => {
    const record = assertRecord(entry, `${command}: artifact is invalid`);
    assertProjectionKeys(record, [
      'artifactId', 'mimeType', 'bytes', 'sizeBytes', 'sha256', 'durationMs',
      'width', 'height', 'sampleRateHz', 'channels',
    ], command, 'scenario artifact');
    const bytes = parseProjectionBytes(record.bytes, command);
    const sizeBytes = boundedProjectionInteger(record.sizeBytes, 0, Number.MAX_SAFE_INTEGER, command);
    if (bytes.length > 0 && sizeBytes !== bytes.length) throw new Error(`${command}: artifact size is invalid`);
    const mimeType = requiredText(record.mimeType, 'mimeType', command, 128);
    if (!mimeType.includes('/')) throw new Error(`${command}: artifact mimeType is invalid`);
    return Object.freeze({
      artifactId: requiredText(record.artifactId, 'artifactId', command, 128), mimeType, bytes,
      sizeBytes, sha256: optionalProjectionText(record.sha256, 128, command),
      durationMs: boundedProjectionInteger(record.durationMs, 0, Number.MAX_SAFE_INTEGER, command),
      width: boundedProjectionInteger(record.width, 0, Number.MAX_SAFE_INTEGER, command),
      height: boundedProjectionInteger(record.height, 0, Number.MAX_SAFE_INTEGER, command),
      sampleRateHz: boundedProjectionInteger(record.sampleRateHz, 0, Number.MAX_SAFE_INTEGER, command),
      channels: boundedProjectionInteger(record.channels, 0, Number.MAX_SAFE_INTEGER, command),
    }) as NimiLocalAppScenarioArtifact;
  }));
}

function parseArtifactUpload(
  value: unknown,
  command: string,
  expectedSize: number,
  expectedMimeType: string,
): NimiLocalAppArtifactUploadResult {
  const record = assertRecord(value, `${command}: artifact upload is invalid`);
  assertProjectionKeys(record, ['artifactId', 'sizeBytes', 'mimeType'], command, 'artifact upload');
  const artifactId = requiredText(record.artifactId, 'artifactId', command, 128);
  const sizeBytes = boundedProjectionInteger(record.sizeBytes, 1, 32 * 1024 * 1024, command);
  if (sizeBytes !== expectedSize || record.mimeType !== expectedMimeType
    || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(record.mimeType))) {
    throw new Error(`${command}: artifact upload result is invalid`);
  }
  return Object.freeze({ artifactId, sizeBytes, mimeType: record.mimeType }) as NimiLocalAppArtifactUploadResult;
}

function parseArtifactRead(value: unknown, command: string): { readonly bytes: readonly number[]; readonly mimeType: string; readonly sizeBytes: number } {
  const record = assertRecord(value, `${command}: artifact read is invalid`);
  assertProjectionKeys(record, ['bytes', 'mimeType', 'sizeBytes'], command, 'artifact read');
  const bytes = parseProjectionBytes(record.bytes, command);
  const sizeBytes = boundedProjectionInteger(record.sizeBytes, 0, 32 * 1024 * 1024, command);
  const mimeType = requiredText(record.mimeType, 'mimeType', command, 128);
  if (bytes.length !== sizeBytes || !mimeType.includes('/')) throw new Error(`${command}: artifact read is invalid`);
  return Object.freeze({ bytes, mimeType, sizeBytes });
}

function parseVoiceAsset(value: unknown, command: string): NimiLocalAppVoiceAsset {
  const record = assertRecord(value, `${command}: voice asset is invalid`);
  assertProjectionKeys(record, ['voiceAssetId', 'creationSource', 'status', 'createdAt', 'updatedAt', 'expiresAt'], command, 'voice asset');
  if (!['reference-audio', 'text-description'].includes(String(record.creationSource))
    || !['active', 'expired', 'deleted', 'failed'].includes(String(record.status))) throw new Error(`${command}: voice asset enum is invalid`);
  return Object.freeze({
    voiceAssetId: requiredText(record.voiceAssetId, 'voiceAssetId', command, 128),
    creationSource: record.creationSource, status: record.status,
    createdAt: parseScenarioTimestamp(record.createdAt, command),
    updatedAt: parseScenarioTimestamp(record.updatedAt, command),
    expiresAt: parseScenarioTimestamp(record.expiresAt, command),
  }) as unknown as NimiLocalAppVoiceAsset;
}

function parseVoiceAssetReference(
  value: unknown,
  command: string,
): { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string } {
  const record = assertRecord(value, `${command}: voice asset reference is invalid`);
  assertProjectionKeys(record, ['kind', 'voiceAssetId'], command, 'voice asset reference');
  if (record.kind !== 'voice_asset_id') throw new Error(`${command}: voice asset reference kind is invalid`);
  return Object.freeze({
    kind: 'voice_asset_id',
    voiceAssetId: requiredText(record.voiceAssetId, 'voiceAssetId', command, 128),
  });
}

function parseVoiceAssetsList(value: unknown, command: string): { readonly assets: readonly NimiLocalAppVoiceAsset[]; readonly nextPageToken: string } {
  const record = assertRecord(value, `${command}: voice asset list is invalid`);
  assertProjectionKeys(record, ['assets', 'nextPageToken'], command, 'voice asset list');
  if (!Array.isArray(record.assets) || record.assets.length > 200
    || typeof record.nextPageToken !== 'string' || !/^[0-9]{0,10}$/u.test(record.nextPageToken)) {
    throw new Error(`${command}: voice asset list is invalid`);
  }
  return Object.freeze({
    assets: Object.freeze(record.assets.map((asset) => parseVoiceAsset(asset, command))),
    nextPageToken: record.nextPageToken,
  });
}

function parseScenarioJobEvent(value: unknown, command: string): NimiLocalAppScenarioJobEvent {
  const record = assertRecord(value, `${command}: Job event is invalid`);
  assertProjectionKeys(record, ['eventType', 'sequence', 'traceId', 'timestamp', 'job'], command, 'scenario Job event');
  if (!['submitted', 'queued', 'running', 'completed', 'failed', 'canceled', 'timeout'].includes(String(record.eventType))
    || typeof record.sequence !== 'string' || !/^[1-9][0-9]*$/u.test(record.sequence)) {
    throw new Error(`${command}: Job event envelope is invalid`);
  }
  return Object.freeze({
    eventType: record.eventType, sequence: record.sequence,
    traceId: optionalProjectionText(record.traceId, 512, command),
    timestamp: parseScenarioTimestamp(record.timestamp, command),
    job: parseScenarioJob(record.job, command),
  }) as unknown as NimiLocalAppScenarioJobEvent;
}

function parseTextTurnEvent(value: unknown, command: string): NimiLocalAppTextTurnEvent {
  const record = assertRecord(value, `${command}: text-turn event is invalid`);
  if (typeof record.sequence !== 'string' || !/^[1-9][0-9]*$/u.test(record.sequence)) {
    throw new Error(`${command}: text-turn sequence is invalid`);
  }
  const traceId = requiredText(record.traceId, 'traceId', command, 512);
  if (record.type === 'delta') {
    assertProjectionKeys(record, ['type', 'sequence', 'traceId', 'text'], command, 'text delta');
    return Object.freeze({ type: 'delta', sequence: record.sequence, traceId,
      text: requiredUtf8Content(record.text, 'text', command, 64 * 1024) });
  }
  if (record.type === 'completed') {
    assertProjectionKeys(record, ['type', 'sequence', 'traceId', 'finishReason'], command, 'text completion');
    if (!['stop', 'length', 'content-filter'].includes(String(record.finishReason))) throw new Error(`${command}: finishReason is invalid`);
    return Object.freeze({ ...record }) as unknown as NimiLocalAppTextTurnEvent;
  }
  if (record.type === 'failed') {
    assertProjectionKeys(record, ['type', 'sequence', 'traceId', 'reasonCode', 'actionHint'], command, 'text failure');
    requiredText(record.reasonCode, 'reasonCode', command, 128);
    optionalProjectionText(record.actionHint, 512, command);
    return Object.freeze({ ...record }) as unknown as NimiLocalAppTextTurnEvent;
  }
  throw new Error(`${command}: text-turn event type is invalid`);
}

function parseScenarioTimestamp(value: unknown, command: string): NimiLocalAppScenarioTimestamp | null {
  if (value === null) return null;
  const record = assertRecord(value, `${command}: timestamp is invalid`);
  assertProjectionKeys(record, ['seconds', 'nanos'], command, 'timestamp');
  if (typeof record.seconds !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(record.seconds)) throw new Error(`${command}: timestamp is invalid`);
  return Object.freeze({ seconds: record.seconds, nanos: boundedProjectionInteger(record.nanos, 0, 999_999_999, command) });
}

function parseProjectionBytes(value: unknown, command: string): readonly number[] {
  if (!Array.isArray(value) || value.length > 32 * 1024 * 1024
    || value.some((byte) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255)) throw new Error(`${command}: bytes are invalid`);
  return Object.freeze([...value] as number[]);
}

function boundedProjectionInteger(value: unknown, minimum: number, maximum: number, command: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${command}: integer projection is invalid`);
  return value;
}

function optionalProjectionText(value: unknown, maximum: number, command: string): string {
  if (typeof value !== 'string' || value.trim() !== value || new TextEncoder().encode(value).byteLength > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${command}: text projection is invalid`);
  return value;
}

async function openNimiLocalAppAIStream<T>(
  command: string,
  payload: JsonObject,
  parser: (value: unknown) => T,
): Promise<NimiLocalAppStream<T>> {
  const opened = await invokeChecked(command, { payload }, (value) => {
    const record = assertRecord(value, `${command}: stream open is invalid`);
    assertProjectionKeys(record, ['subscriptionId', 'eventName'], command, 'AI stream');
    return {
      subscriptionId: requiredText(record.subscriptionId, 'subscriptionId', command, MAX_IDENTIFIER_LENGTH),
      eventName: requiredText(record.eventName, 'eventName', command, MAX_IDENTIFIER_LENGTH),
    };
  });
  const subscription = new LocalAppAIEventSubscription(command, opened.subscriptionId, parser);
  try {
    subscription.attach(await listenShell(opened.eventName, ({ payload: event }) => subscription.accept(event)));
  } catch (error) {
    await subscription.cancel().catch(() => undefined);
    throw error;
  }
  return Object.freeze({
    events: subscription.events,
    cancel: () => subscription.cancel(),
  });
}

class LocalAppAIEventSubscription<T> implements NimiLocalAppStream<T> {
  readonly events: AsyncIterable<T> = this;
  private readonly queued: T[] = [];
  private readonly waiting: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void }> = [];
  private unlisten: (() => void) | undefined;
  private terminalError: unknown;
  private done = false;
  private remoteCompleted = false;
  private cancelPromise: Promise<void> | undefined;

  constructor(private readonly command: string, private readonly subscriptionId: string,
    private readonly parser: (value: unknown) => T) {}

  attach(unlisten: () => void): void { if (this.done) unlisten(); else this.unlisten = unlisten; }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next(), return: async () => { await this.cancel(); return { done: true, value: undefined }; } };
  }
  cancel(): Promise<void> {
    if (this.cancelPromise) return this.cancelPromise;
    if (this.remoteCompleted) return this.cancelPromise = Promise.resolve();
    this.finish();
    this.cancelPromise = invokeChecked(this.command, { payload: { action: 'cancel', subscriptionId: this.subscriptionId } }, (value) => {
      const record = assertRecord(value, `${this.command}: cancel result is invalid`);
      assertProjectionKeys(record, ['subscriptionId', 'closed'], this.command, 'AI stream cancel');
      if (record.subscriptionId !== this.subscriptionId || typeof record.closed !== 'boolean') throw new Error(`${this.command}: cancel result is invalid`);
    });
    return this.cancelPromise;
  }
  accept(value: unknown): void {
    if (this.done) return;
    try {
      const record = assertRecord(value, `${this.command}: stream event is invalid`);
      if (record.subscriptionId !== this.subscriptionId) throw new Error(`${this.command}: subscription binding is invalid`);
      if (record.eventType === 'completed') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType'], this.command, 'AI stream completion');
        this.remoteCompleted = true; this.finish(); return;
      }
      if (record.eventType === 'error') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType', 'error'], this.command, 'AI stream error');
        this.fail(parseConversationStreamError(record.error, this.command)); return;
      }
      if (record.eventType !== 'next') throw new Error(`${this.command}: stream event type is invalid`);
      assertProjectionKeys(record, ['subscriptionId', 'eventType', 'event'], this.command, 'AI stream event');
      const event = this.parser(record.event);
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve({ done: false, value: event });
      else if (this.queued.length < 32) this.queued.push(event);
      else throw new Error(`${this.command}: stream buffer is exhausted`);
    } catch (error) { this.fail(error); void this.cancel().catch(() => undefined); }
  }
  private next(): Promise<IteratorResult<T>> {
    if (this.queued.length > 0) return Promise.resolve({ done: false, value: this.queued.shift()! });
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
  private finish(): void { if (this.done) return; this.done = true; this.unlisten?.(); this.unlisten = undefined;
    for (const waiter of this.waiting.splice(0)) waiter.resolve({ done: true, value: undefined }); }
  private fail(error: unknown): void { if (this.done) return; this.terminalError = error; this.done = true;
    this.unlisten?.(); this.unlisten = undefined; for (const waiter of this.waiting.splice(0)) waiter.reject(error); }
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
		  details: { retryable: true, diagnosticStage: 'renderer_local_app_conversation_buffer_overflow' },
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

class LocalAppRealtimeEventSubscription implements NimiLocalAppRealtimeSubscription {
  readonly events: AsyncIterable<unknown> = this;
  private readonly queued: unknown[] = [];
  private readonly waiting: Array<{ resolve: (result: IteratorResult<unknown>) => void; reject: (error: unknown) => void }> = [];
  private unlisten: (() => void) | undefined;
  private terminalError: unknown;
  private done = false;
  private remoteCompleted = false;
  private cancelPromise: Promise<void> | undefined;

  constructor(private readonly command: string, private readonly subscriptionId: string) {}

  attach(unlisten: () => void): void { if (this.done) unlisten(); else this.unlisten = unlisten; }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return { next: () => this.next(), return: async () => { await this.cancel(); return { done: true, value: undefined }; } };
  }

  cancel(): Promise<void> {
    if (this.cancelPromise) return this.cancelPromise;
    if (this.remoteCompleted) return (this.cancelPromise = Promise.resolve());
    this.finish();
    this.cancelPromise = invokeChecked(
      this.command,
      { payload: { action: 'cancel', subscriptionId: this.subscriptionId } },
      (value) => {
        const record = assertRecord(value, `${this.command} returned invalid cancel payload`);
        assertProjectionKeys(record, ['subscriptionId', 'closed'], this.command, 'Realtime cancel');
        if (record.subscriptionId !== this.subscriptionId || typeof record.closed !== 'boolean') {
          throw new Error(`${this.command}: Realtime cancel projection is invalid`);
        }
      },
    );
    return this.cancelPromise;
  }

  accept(value: unknown): void {
    if (this.done) return;
    try {
      const record = assertRecord(value, `${this.command} emitted invalid payload`);
      if (record.subscriptionId !== this.subscriptionId) throw new Error(`${this.command}: subscription binding is invalid`);
      if (record.eventType === 'completed') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType'], this.command, 'Realtime completion');
        this.remoteCompleted = true;
        this.finish();
        return;
      }
      if (record.eventType === 'error') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType', 'error'], this.command, 'Realtime error');
        this.fail(parseConversationStreamError(record.error, this.command));
        return;
      }
      if (record.eventType !== 'next') throw new Error(`${this.command}: Realtime event type is invalid`);
      assertProjectionKeys(record, ['subscriptionId', 'eventType', 'event'], this.command, 'Realtime event');
      const event = parseSafeProjection(record.event, this.command);
      assertProjectionKeys(event, ['control', 'event'], this.command, 'Realtime event payload');
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve({ done: false, value: event });
      else if (this.queued.length < 32) this.queued.push(event);
      else throw new BridgeError('Local-app Realtime event buffer is exhausted', this.command, {
        code: 'resource-exhausted', reasonCode: 'renderer-local-app-realtime-buffer-exhausted',
        actionHint: 'consume_or_cancel_realtime_subscription', source: 'renderer',
        details: { retryable: true, diagnosticStage: 'renderer_local_app_realtime_buffer_overflow' },
      });
    } catch (error) {
      this.fail(error);
      void this.cancel().catch(() => undefined);
    }
  }

  private next(): Promise<IteratorResult<unknown>> {
    if (this.queued.length > 0) return Promise.resolve({ done: false, value: this.queued.shift() });
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
  private finish(): void { if (this.done) return; this.done = true; this.unlisten?.(); this.unlisten = undefined; for (const waiter of this.waiting.splice(0)) waiter.resolve({ done: true, value: undefined }); }
  private fail(error: unknown): void { if (this.done) return; this.terminalError = error; this.done = true; this.unlisten?.(); this.unlisten = undefined; for (const waiter of this.waiting.splice(0)) waiter.reject(error); }
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

function parseAssetRecord(value: unknown, command: string): NimiLocalAppAssetRecord {
  const record = assertRecord(value, `${command} returned invalid asset metadata`);
  assertProjectionKeys(record, ['relativePath', 'mediaType', 'sizeBytes', 'sha256', 'createdAt', 'updatedAt'], command, 'asset metadata');
  const relativePath = canonicalAssetPath(requiredText(record.relativePath, 'relativePath', command, MAX_ASSET_PATH_BYTES), command);
  const mediaType = record.mediaType === null ? undefined : canonicalMediaType(record.mediaType, command);
  const sizeBytes = nonNegativeInteger(record.sizeBytes, command, 'sizeBytes');
  if (sizeBytes > Number.MAX_SAFE_INTEGER || typeof record.sha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.sha256)) {
    throw new Error(`${command}: asset integrity metadata is invalid`);
  }
  const createdAt = requiredText(record.createdAt, 'createdAt', command, 64);
  const updatedAt = requiredText(record.updatedAt, 'updatedAt', command, 64);
  if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error(`${command}: asset timestamps are invalid`);
  }
  return Object.freeze({ relativePath, ...(mediaType === undefined ? {} : { mediaType }), sizeBytes,
    sha256: record.sha256, createdAt, updatedAt });
}

function parseStreamId(value: unknown, command: string): { readonly streamId: string } {
  const record = assertRecord(value, `${command} returned invalid stream`);
  assertProjectionKeys(record, ['streamId'], command, 'asset stream');
  return Object.freeze({ streamId: requiredText(record.streamId, 'streamId', command, 128) });
}

function parseBooleanResult(value: unknown, key: string, command: string): Readonly<Record<string, boolean>> {
  const record = assertRecord(value, `${command} returned invalid result`);
  assertProjectionKeys(record, [key], command, 'asset mutation');
  if (typeof record[key] !== 'boolean') throw new Error(`${command}: ${key} is invalid`);
  return Object.freeze({ [key]: record[key] });
}

function parseAssetReadOpen(value: unknown, command: string): {
  readonly streamId: string; readonly asset: NimiLocalAppAssetRecord;
  readonly range: { readonly offset: number; readonly length: number; readonly totalSize: number };
} {
  const record = assertRecord(value, `${command} returned invalid read metadata`);
  assertProjectionKeys(record, ['streamId', 'asset', 'range'], command, 'asset read');
  const asset = parseAssetRecord(record.asset, command);
  const range = assertRecord(record.range, `${command} returned invalid range`);
  assertProjectionKeys(range, ['offset', 'length', 'totalSize'], command, 'asset range');
  const offset = nonNegativeInteger(range.offset, command, 'offset');
  const length = nonNegativeInteger(range.length, command, 'length');
  const totalSize = nonNegativeInteger(range.totalSize, command, 'totalSize');
  if (totalSize !== asset.sizeBytes || offset > totalSize || length > totalSize - offset) throw new Error(`${command}: range is invalid`);
  return Object.freeze({ streamId: requiredText(record.streamId, 'streamId', command, 128), asset,
    range: Object.freeze({ offset, length, totalSize }) });
}

function parseAssetReadNext(value: unknown, command: string):
  | { readonly completed: true }
  | { readonly completed: false; readonly bodyChunk: Uint8Array } {
  const record = assertRecord(value, `${command} returned invalid read chunk`);
  if (record.completed === true) {
    assertProjectionKeys(record, ['completed'], command, 'asset read completion');
    return Object.freeze({ completed: true });
  }
  assertProjectionKeys(record, ['completed', 'bodyChunk'], command, 'asset read chunk');
  if (record.completed !== false || !(record.bodyChunk instanceof Uint8Array)
    || record.bodyChunk.byteLength === 0 || record.bodyChunk.byteLength > 1024 * 1024) {
    throw new Error(`${command}: asset read chunk is invalid`);
  }
  return Object.freeze({ completed: false, bodyChunk: new Uint8Array(record.bodyChunk) });
}

async function* assetBodyChunks(body: NimiLocalAppAssetBody, command: string): AsyncGenerator<Uint8Array> {
  if (body instanceof Uint8Array) {
    yield* splitAssetChunk(body, command);
    return;
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const reader = body.stream().getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) return;
        yield* splitAssetChunk(next.value, command);
      }
    } finally {
      reader.releaseLock();
    }
  }
  if (!body || typeof body !== 'object' || typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== 'function') {
    throw new Error(`${command}: body is invalid`);
  }
  for await (const chunk of body as AsyncIterable<Uint8Array>) yield* splitAssetChunk(chunk, command);
}

function* splitAssetChunk(chunk: Uint8Array, command: string): Generator<Uint8Array> {
  if (!(chunk instanceof Uint8Array)) throw new Error(`${command}: body chunk is invalid`);
  for (let offset = 0; offset < chunk.byteLength; offset += 1024 * 1024) {
    yield new Uint8Array(chunk.slice(offset, offset + 1024 * 1024));
  }
}

function boundedAssetRange(value: unknown, positive: boolean, command: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw new Error(`${command}: range is invalid`);
  }
  return value;
}

function canonicalMediaType(value: unknown, command: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255 || value.trim() !== value
    || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(value)) {
    throw new Error(`${command}: mediaType is invalid`);
  }
  return value.toLowerCase();
}

function canonicalAssetPrefix(value: string, command: string): string {
  const suffix = value.endsWith('/') ? '/' : '';
  return `${canonicalAssetPath(value.slice(0, value.length - suffix.length), command)}${suffix}`;
}

function canonicalAssetPath(value: string, command: string): string {
  const components = value.split('/');
  if (!value || value.trim() !== value || !isWellFormedUnicode(value) || value.normalize('NFC') !== value
    || new TextEncoder().encode(value).byteLength > MAX_ASSET_PATH_BYTES
    || value.startsWith('/') || value.endsWith('/') || /[\\\0<>:"|?*]/u.test(value)
    || components.length > MAX_ASSET_PATH_COMPONENTS) throw new Error(`${command}: relativePath is invalid`);
  for (const segment of components) {
    const base = segment.split('.', 1)[0]?.toUpperCase() ?? '';
    if (!segment || segment === '.' || segment === '..'
      || new TextEncoder().encode(segment).byteLength > MAX_ASSET_COMPONENT_BYTES
      || segment.endsWith('.') || segment.endsWith(' ') || /[\u0000-\u001f\u007f]/u.test(segment)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)
    ) throw new Error(`${command}: relativePath is invalid`);
  }
  return value;
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit > 0xdbff || index + 1 >= value.length) return false;
    const next = value.charCodeAt(index + 1);
    if (next < 0xdc00 || next > 0xdfff) return false;
    index += 1;
  }
  return true;
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

function parseAppAIConfigSnapshot(value: unknown, command: string): NimiAIConfigSnapshot {
  const snapshot = parseSafeProjection(value, command);
  rejectPortableAppAIConfigFields(snapshot, command);
  assertProjectionKeys(snapshot, ['config', 'revision', 'effectiveSelections'], command, 'App AIConfig snapshot');
  const revision = parseRevision(snapshot.revision, command);
  const config = snapshot.config === null ? null : parseAppAIConfig(snapshot.config, command);
  if (!Array.isArray(snapshot.effectiveSelections) || snapshot.effectiveSelections.length > 128) {
    throw new Error(`${command}: effective selections are invalid`);
  }
  snapshot.effectiveSelections.forEach((selection) => parseEffectiveSelection(selection, command));
  return Object.freeze({ config, revision, effectiveSelections: Object.freeze([...snapshot.effectiveSelections]) }) as NimiAIConfigSnapshot;
}

function parseAppAIConfigOverwrite(value: unknown, command: string): NimiAIConfigOverwriteResult {
  const result = parseSafeProjection(value, command);
  rejectPortableAppAIConfigFields(result, command);
  assertProjectionKeys(result, ['outcome', 'config', 'revision', 'reasonCode'], command, 'App AIConfig overwrite');
  const revision = parseRevision(result.revision, command);
  const config = result.config === null ? null : parseAppAIConfig(result.config, command);
  if (result.outcome === 'committed' && result.reasonCode === 'REASON_CODE_UNSPECIFIED' && config) {
    return Object.freeze({ outcome: 'committed', config, revision });
  }
  if (result.outcome === 'conflict' && result.reasonCode === 'AI_CONFIG_REVISION_CONFLICT') {
    return Object.freeze({ outcome: 'conflict', config, revision, reasonCode: result.reasonCode });
  }
  throw new Error(`${command}: overwrite outcome is invalid`);
}

function parseAppAIConfigOptions(value: unknown, command: string): NimiAIConfigOptionsResult {
  const result = parseSafeProjection(value, command);
  rejectPortableAppAIConfigFields(result, command);
  assertProjectionKeys(result, ['kind', 'options', 'truncated'], command, 'App AIConfig options');
  if (!['local-loadouts', 'cloud-connectors', 'cloud-targets'].includes(String(result.kind)) || !Array.isArray(result.options)
    || result.options.length > 100 || typeof result.truncated !== 'boolean') {
    throw new Error(`${command}: options result is invalid`);
  }
  if (result.kind === 'local-loadouts') result.options.forEach((option) => parseLocalResource(option, command));
  else if (result.kind === 'cloud-connectors') result.options.forEach((option) => parseCloudConnectorResource(option, command));
  else result.options.forEach((option) => parseCloudTargetResource(option, command));
  return Object.freeze({ kind: result.kind, options: Object.freeze([...result.options]), truncated: result.truncated }) as NimiAIConfigOptionsResult;
}

function parseSharedAgentAIConfigOptions(
  value: unknown,
  command: string,
): NimiSharedLocalAgentAIConfigOptionsResult {
  const result = parseSafeProjection(value, command);
  if (result.kind !== 'preset-voices') {
    return parseAppAIConfigOptions(value, command);
  }
  assertProjectionKeys(result, ['kind', 'options', 'truncated'], command, 'shared LocalAgent preset voice options');
  if (!Array.isArray(result.options) || result.options.length > 100 || typeof result.truncated !== 'boolean') {
    throw new Error(`${command}: preset voice options result is invalid`);
  }
  const options = result.options.map((entry, index) => {
    const option = assertRecord(entry, `${command}: preset voice option ${index} is invalid`);
    assertProjectionKeys(option, ['voiceId', 'name', 'supportedLangs'], command, `preset voice option ${index}`);
    const voiceId = requiredPresetVoiceText(option.voiceId, `options[${index}].voiceId`, command, 128);
    const name = requiredPresetVoiceText(option.name, `options[${index}].name`, command, 256);
    if (!Array.isArray(option.supportedLangs) || option.supportedLangs.length > 32) {
      throw new Error(`${command}: preset voice option ${index} languages are invalid`);
    }
    const supportedLangs = option.supportedLangs.map((lang, languageIndex) => (
      requiredPresetVoiceText(lang, `options[${index}].supportedLangs[${languageIndex}]`, command, 64)
    ));
    return Object.freeze({ voiceId, name, supportedLangs: Object.freeze(supportedLangs) });
  });
  return Object.freeze({
    kind: 'preset-voices',
    options: Object.freeze(options),
    truncated: result.truncated,
  });
}

function requiredPresetVoiceText(value: unknown, field: string, command: string, maxScalars: number): string {
  const text = requiredText(value, field, command, Number.MAX_SAFE_INTEGER);
  if (Array.from(text).length > maxScalars) throw new Error(`${command}: ${field} exceeds the scalar bound`);
  return text;
}

function parseEffectiveSelection(value: unknown, command: string): void {
  const selection = assertRecord(value, `${command}: effective selection is invalid`);
  assertProjectionKeys(selection, ['capabilityContract', 'state', 'resource', 'reasons'], command, 'effective selection');
  requiredText(selection.capabilityContract, 'capabilityContract', command, MAX_IDENTIFIER_LENGTH);
  if (!['ready', 'missing', 'blocked', 'unavailable'].includes(String(selection.state))
    || !Array.isArray(selection.reasons)) {
    throw new Error(`${command}: effective selection is invalid`);
  }
  if (selection.resource !== null) {
    const resource = assertRecord(selection.resource, `${command}: effective resource is invalid`);
    if (resource.oneofKind === 'local') {
      assertProjectionKeys(resource, ['oneofKind', 'local'], command, 'effective Local resource');
      parseLocalResource(resource.local, command);
    } else if (resource.oneofKind === 'cloud') {
      assertProjectionKeys(resource, ['oneofKind', 'cloud'], command, 'effective Cloud resource');
      const cloud = assertRecord(resource.cloud, `${command}: effective Cloud resource is invalid`);
      assertProjectionKeys(cloud, ['connector', 'target'], command, 'effective Cloud resource');
      parseCloudConnectorResource(cloud.connector, command);
      parseCloudTargetResource(cloud.target, command);
    } else throw new Error(`${command}: effective resource kind is invalid`);
  }
}

function parseCloudConnectorResource(value: unknown, command: string): void {
  const resource = assertRecord(value, `${command}: Cloud Connector resource is invalid`);
  assertProjectionKeys(resource, ['connectorRef', 'label', 'provider', 'state', 'reasons'], command, 'Cloud Connector resource');
  requiredText(resource.connectorRef, 'connectorRef', command, MAX_IDENTIFIER_LENGTH);
  requiredText(resource.label, 'label', command, MAX_IDENTIFIER_LENGTH);
  requiredText(resource.provider, 'provider', command, MAX_IDENTIFIER_LENGTH);
  if (!Array.isArray(resource.reasons) || !['ready', 'blocked'].includes(String(resource.state))) {
    throw new Error(`${command}: Cloud Connector resource is invalid`);
  }
}

function parseCloudTargetResource(value: unknown, command: string): void {
  const resource = assertRecord(value, `${command}: Cloud target resource is invalid`);
  assertProjectionKeys(resource, [
    'connectorRef', 'label', 'capabilityContract', 'implementation', 'providerModelTarget',
    'supportedFeatures', 'state', 'reasons',
  ], command, 'Cloud target resource');
  requiredText(resource.connectorRef, 'connectorRef', command, MAX_IDENTIFIER_LENGTH);
  requiredText(resource.label, 'label', command, MAX_IDENTIFIER_LENGTH);
  requiredText(resource.capabilityContract, 'capabilityContract', command, MAX_IDENTIFIER_LENGTH);
  const implementation = assertRecord(resource.implementation, `${command}: Cloud target implementation is invalid`);
  assertProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], command, 'Cloud target implementation');
  for (const key of ['implementationId', 'driverId', 'driverDialect'] as const) {
    requiredText(implementation[key], key, command, MAX_IDENTIFIER_LENGTH);
  }
  const providerModelTarget = assertRecord(
    resource.providerModelTarget,
    `${command}: Cloud provider-model target is invalid`,
  );
  resource.providerModelTarget = runtimeAIConfigStructToJson(
    providerModelTarget as unknown as Parameters<typeof runtimeAIConfigStructToJson>[0],
  );
  if (!Array.isArray(resource.supportedFeatures) || !Array.isArray(resource.reasons)
    || !['ready', 'blocked'].includes(String(resource.state))) {
    throw new Error(`${command}: Cloud target resource is invalid`);
  }
}

function parseLocalResource(value: unknown, command: string): void {
  const resource = assertRecord(value, `${command}: Local resource is invalid`);
  assertProjectionKeys(resource, [
    'loadoutRef', 'label', 'capabilityContract', 'implementation',
    'supportedFeatures', 'state', 'reasons',
  ], command, 'Local resource');
  requiredText(resource.loadoutRef, 'loadoutRef', command, MAX_IDENTIFIER_LENGTH);
  requiredText(resource.label, 'label', command, MAX_IDENTIFIER_LENGTH);
  requiredText(resource.capabilityContract, 'capabilityContract', command, MAX_IDENTIFIER_LENGTH);
  const implementation = assertRecord(resource.implementation, `${command}: Local implementation is invalid`);
  assertProjectionKeys(implementation, ['implementationId', 'driverId', 'driverDialect'], command, 'Local implementation');
  for (const key of ['implementationId', 'driverId', 'driverDialect'] as const) {
    requiredText(implementation[key], key, command, MAX_IDENTIFIER_LENGTH);
  }
  if (!Array.isArray(resource.supportedFeatures) || !Array.isArray(resource.reasons)
    || (resource.state !== 'ready' && resource.state !== 'blocked')) {
    throw new Error(`${command}: Local resource is invalid`);
  }
}

function parseRevision(value: unknown, command: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${command}: revision is invalid`);
  }
  return value;
}

function parseAppAIConfig(value: unknown, command: string): NimiPortableAppAIConfig {
  const config = parseSafeProjection(value, command);
  rejectPortableAppAIConfigFields(config, command);
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

function parseSharedAgentAIConfigSnapshot(value: unknown, command: string): NimiSharedLocalAgentAIConfigSnapshot {
  const snapshot = parseSafeProjection(value, command);
  assertProjectionKeys(snapshot, ['config', 'revision', 'effectiveSelections', 'participation'], command, 'shared AIConfig snapshot');
  const revision = parseRevision(snapshot.revision, command);
  const config = snapshot.config === null ? null : parseSharedAgentAIConfig(snapshot.config, command);
  if (!Array.isArray(snapshot.effectiveSelections) || snapshot.effectiveSelections.length > 128) {
    throw new Error(`${command}: effective selections are invalid`);
  }
  snapshot.effectiveSelections.forEach((selection) => parseEffectiveSelection(selection, command));
  const participation = parseLocalAgentParticipation(snapshot.participation, command);
  return Object.freeze({ config, revision, effectiveSelections: Object.freeze([...snapshot.effectiveSelections]), participation }) as NimiSharedLocalAgentAIConfigSnapshot;
}

function parseSharedAgentAIConfigOverwrite(value: unknown, command: string): NimiSharedLocalAgentAIConfigOverwriteResult {
  const result = parseSafeProjection(value, command);
  assertProjectionKeys(result, ['outcome', 'config', 'revision', 'effectiveSelections', 'participation', 'reasonCode'], command, 'shared AIConfig overwrite');
  const revision = parseRevision(result.revision, command);
  const config = result.config === null ? null : parseSharedAgentAIConfig(result.config, command);
  if (!Array.isArray(result.effectiveSelections) || result.effectiveSelections.length > 128) {
    throw new Error(`${command}: effective selections are invalid`);
  }
  result.effectiveSelections.forEach((selection) => parseEffectiveSelection(selection, command));
  const participation = parseLocalAgentParticipation(result.participation, command);
  if (result.outcome === 'committed' && result.reasonCode === 'REASON_CODE_UNSPECIFIED' && config) {
    return Object.freeze({ outcome: 'committed', config, revision, participation });
  }
  if (result.outcome === 'conflict' && result.reasonCode === 'AGENT_AI_CONFIG_REVISION_CONFLICT') {
    return Object.freeze({ outcome: 'conflict', config, revision, reasonCode: result.reasonCode, participation });
  }
  throw new Error(`${command}: overwrite outcome is invalid`);
}

function parseLocalAgentParticipation(value: unknown, command: string) {
  const expected = [
    ['conversation.primary', 'text.generate'],
    ['memory.embedding', 'text.embed'],
    ['conversation.input.voice', 'audio.transcribe'],
    ['conversation.output.voice', 'audio.synthesize'],
    ['conversation.realtime', 'realtime.interact'],
    ['conversation.action.image', 'image.generate'],
  ] as const;
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new Error(`${command}: LocalAgent participation is invalid`);
  }
  return Object.freeze(value.map((entry, index) => {
    const row = assertRecord(entry, `${command}: participation row is invalid`);
    assertProjectionKeys(row, ['role', 'capabilityContract'], command, `participation row ${index}`);
    const expectedRow = expected[index];
    if (!expectedRow || row.role !== expectedRow[0] || row.capabilityContract !== expectedRow[1]) {
      throw new Error(`${command}: participation row ${index} is invalid`);
    }
    return Object.freeze({ role: expectedRow[0], capabilityContract: expectedRow[1] });
  }));
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
    return {
      oneofKind: 'local',
      local: {},
    };
  }
  if (route.oneofKind !== 'cloud') {
    throw invalidInput(command, `capabilities[${index}].route is invalid`);
  }
  assertProjectionKeys(route, ['oneofKind', 'cloud'], command, `capabilities[${index}].route`);
  const cloud = assertRecord(route.cloud, `${command}: capabilities[${index}].route.cloud is invalid`);
  assertAllowedInputKeys(
    cloud,
    ['connectorRef', 'implementation', 'providerModelTarget'],
    ['connectorRef', 'implementation'],
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
    connectorRef: requiredText(cloud.connectorRef, 'connectorRef', command, MAX_IDENTIFIER_LENGTH),
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
  const canonical = cloneAIConfigJsonValue(value, command);
  rejectAIConfigAuthorityFields(canonical, command);
  return canonical;
}

function cloneAIConfigJsonValue(
  value: unknown,
  command: string,
  depth = 0,
  nodes = { value: 0 },
): JsonValue {
  nodes.value += 1;
  if (depth > 32 || nodes.value > 100_000) throw invalidInput(command, 'AIConfig value exceeds structural bounds');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneAIConfigJsonValue(entry, command, depth + 1, nodes));
  }
  if (!value || typeof value !== 'object') throw invalidInput(command, 'AIConfig value is not JSON-compatible');
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) throw invalidInput(command, 'AIConfig value has symbol fields');
  const output: JsonObject = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw invalidInput(command, 'AIConfig value has non-data fields');
    }
    output[key] = cloneAIConfigJsonValue(descriptor.value, command, depth + 1, nodes);
  }
  return output;
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

function rejectPortableAppAIConfigFields(value: unknown, command: string): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) rejectPortableAppAIConfigFields(entry, command);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PORTABLE_APP_AI_CONFIG_KEYS.has(normalizeFieldName(key))) {
      throw new Error(`${command}: portable App AIConfig field ${key} is forbidden`);
    }
    rejectPortableAppAIConfigFields(entry, command);
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

function boundedSafeInteger(
  value: unknown,
  field: string,
  command: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
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

function personaWritableVisibility(value: unknown, command: string): 'private' | 'unlisted' | 'public' {
  if (value !== 'private' && value !== 'unlisted' && value !== 'public') {
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

function parseConversationInputParts(value: unknown, command: string): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    throw invalidInput(command, 'conversation parts are invalid');
  }
  let textSeen = false;
  let artifactSeen = false;
  return Object.freeze(value.map((part, index): JsonValue => {
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      throw invalidInput(command, `conversation part ${index} is invalid`);
    }
    const record = part as Record<string, unknown>;
    if (record.kind === 'text') {
      assertExactInput(record, ['kind', 'text'], command);
      if (textSeen || artifactSeen || index !== 0) {
        throw invalidInput(command, `conversation text part ${index} is invalid`);
      }
      textSeen = true;
      return Object.freeze({
        kind: 'text',
        text: requiredUtf8Content(record.text, 'text', command, 64 * 1024),
      });
    }
    if (record.kind === 'artifact-ref') {
      assertExactInput(record, ['kind', 'artifactId'], command);
      if (artifactSeen) throw invalidInput(command, `conversation artifact part ${index} is invalid`);
      artifactSeen = true;
      return Object.freeze({
        kind: 'artifact-ref',
        artifactId: requiredText(record.artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH),
      });
    }
    throw invalidInput(command, `conversation part ${index} kind is invalid`);
  }));
}

function invalidInput(command: string, reason: string): BridgeError {
  return new BridgeError(`Local-app operation input is invalid: ${reason}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-local-app-payload-invalid',
    actionHint: 'send_only_declared_local_app_operation_fields',
    source: 'renderer',
  });
}
