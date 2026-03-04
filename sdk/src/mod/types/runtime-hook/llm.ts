import type {
  HookLlmTextStreamEvent,
  LocalAiProviderHints,
  RuntimeLlmHealthInput,
  RuntimeLlmHealthResult,
  RuntimeRouteHealthResult,
  RuntimeRouteHint,
  RuntimeRouteOverride,
} from '../llm';
import type {
  HookSpeechProviderDescriptor,
  HookSpeechSynthesizeResult,
  HookSpeechStreamOpenResult,
  HookSpeechVoiceDescriptor,
} from '../speech';
import type { HookSourceType } from './shared';

export type RuntimeHookLlmFacade = {
  generateModText: (input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    mode?: 'STORY' | 'SCENE_TURN';
    worldId?: string;
    agentId?: string;
    abortSignal?: AbortSignal;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }) => Promise<{ text: string; promptTraceId: string; traceId: string }>;
  streamModText: (input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    mode?: 'STORY' | 'SCENE_TURN';
    worldId?: string;
    agentId?: string;
    abortSignal?: AbortSignal;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }) => AsyncIterable<HookLlmTextStreamEvent>;
  generateModImage: (input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    model?: string;
    size?: string;
    n?: number;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }) => Promise<{ images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>; traceId: string }>;
  generateModVideo: (input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    prompt: string;
    model?: string;
    durationSeconds?: number;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }) => Promise<{ videos: Array<{ uri?: string; mimeType?: string }>; traceId: string }>;
  generateModEmbedding: (input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    input: string | string[];
    model?: string;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }) => Promise<{ embeddings: number[][]; traceId: string }>;
  transcribeModSpeech: (input: {
    modId: string;
    sourceType?: HookSourceType;
    provider: string;
    audioUri?: string;
    audioBase64?: string;
    mimeType?: string;
    language?: string;
    localProviderEndpoint?: string;
    localProviderModel?: string;
    localOpenAiEndpoint?: string;
    connectorId?: string;
    providerHints?: LocalAiProviderHints;
  }) => Promise<{ text: string; traceId: string }>;
  listSpeechProviders: (input: {
    modId: string;
    sourceType?: HookSourceType;
  }) => Promise<HookSpeechProviderDescriptor[]>;
  listSpeechVoices: (input: {
    modId: string;
    sourceType?: HookSourceType;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
  }) => Promise<HookSpeechVoiceDescriptor[]>;
  synthesizeModSpeech: (input: {
    modId: string;
    sourceType?: HookSourceType;
    text: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
    voiceId: string;
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    speakingRate?: number;
    pitch?: number;
    sampleRateHz?: number;
    language?: string;
    stylePrompt?: string;
    targetId?: string;
    sessionId?: string;
  }) => Promise<HookSpeechSynthesizeResult>;
  openSpeechStream: (input: {
    modId: string;
    sourceType?: HookSourceType;
    text: string;
    providerId?: string;
    routeSource?: 'auto' | 'local-runtime' | 'token-api';
    connectorId?: string;
    model?: string;
    voiceId: string;
    format?: 'mp3' | 'wav' | 'opus' | 'pcm';
    sampleRateHz?: number;
    language?: string;
    stylePrompt?: string;
    targetId?: string;
    sessionId?: string;
  }) => Promise<HookSpeechStreamOpenResult>;
  controlSpeechStream: (input: {
    modId: string;
    sourceType?: HookSourceType;
    streamId: string;
    action: 'pause' | 'resume' | 'cancel';
  }) => Promise<{ ok: boolean }>;
  closeSpeechStream: (input: {
    modId: string;
    sourceType?: HookSourceType;
    streamId: string;
  }) => Promise<{ ok: boolean }>;
};

export type HookLlmClient = {
  text: {
    generate: (input: {
      provider: string;
      prompt: string;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      mode?: 'STORY' | 'SCENE_TURN';
      worldId?: string;
      agentId?: string;
      abortSignal?: AbortSignal;
      localProviderEndpoint?: string;
      localProviderModel?: string;
      localOpenAiEndpoint?: string;
      connectorId?: string;
      providerHints?: LocalAiProviderHints;
    }) => Promise<{ text: string; promptTraceId: string; traceId: string }>;
    stream: (input: {
      provider: string;
      prompt: string;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      mode?: 'STORY' | 'SCENE_TURN';
      worldId?: string;
      agentId?: string;
      abortSignal?: AbortSignal;
      localProviderEndpoint?: string;
      localProviderModel?: string;
      localOpenAiEndpoint?: string;
      connectorId?: string;
      providerHints?: LocalAiProviderHints;
    }) => AsyncIterable<HookLlmTextStreamEvent>;
  };
  image: {
    generate: (input: {
      provider: string;
      prompt: string;
      model?: string;
      size?: string;
      n?: number;
      localProviderEndpoint?: string;
      localProviderModel?: string;
      localOpenAiEndpoint?: string;
      connectorId?: string;
      providerHints?: LocalAiProviderHints;
    }) => Promise<{ images: Array<{ uri?: string; b64Json?: string; mimeType?: string }>; traceId: string }>;
  };
  video: {
    generate: (input: {
      provider: string;
      prompt: string;
      model?: string;
      durationSeconds?: number;
      localProviderEndpoint?: string;
      localProviderModel?: string;
      localOpenAiEndpoint?: string;
      connectorId?: string;
      providerHints?: LocalAiProviderHints;
    }) => Promise<{ videos: Array<{ uri?: string; mimeType?: string }>; traceId: string }>;
  };
  embedding: {
    generate: (input: {
      provider: string;
      input: string | string[];
      model?: string;
      localProviderEndpoint?: string;
      localProviderModel?: string;
      localOpenAiEndpoint?: string;
      connectorId?: string;
      providerHints?: LocalAiProviderHints;
    }) => Promise<{ embeddings: number[][]; traceId: string }>;
  };
  checkHealth: (input: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult>;
  speech: {
    listProviders: () => Promise<HookSpeechProviderDescriptor[]>;
    listVoices: (input?: {
      providerId?: string;
      routeSource?: 'auto' | 'local-runtime' | 'token-api';
      connectorId?: string;
      model?: string;
    }) => Promise<HookSpeechVoiceDescriptor[]>;
    synthesize: (input: {
      text: string;
      providerId?: string;
      routeSource?: 'auto' | 'local-runtime' | 'token-api';
      connectorId?: string;
      model?: string;
      voiceId: string;
      format?: 'mp3' | 'wav' | 'opus' | 'pcm';
      speakingRate?: number;
      pitch?: number;
      sampleRateHz?: number;
      language?: string;
      stylePrompt?: string;
      targetId?: string;
      sessionId?: string;
    }) => Promise<HookSpeechSynthesizeResult>;
    transcribe: (input: {
      provider: string;
      audioUri?: string;
      audioBase64?: string;
      mimeType?: string;
      language?: string;
      localProviderEndpoint?: string;
      localProviderModel?: string;
      localOpenAiEndpoint?: string;
      connectorId?: string;
      providerHints?: LocalAiProviderHints;
    }) => Promise<{ text: string; traceId: string }>;
    stream: {
      open: (input: {
        text: string;
        providerId?: string;
        routeSource?: 'auto' | 'local-runtime' | 'token-api';
        connectorId?: string;
        model?: string;
        voiceId: string;
        format?: 'mp3' | 'wav' | 'opus' | 'pcm';
        sampleRateHz?: number;
        language?: string;
        stylePrompt?: string;
        targetId?: string;
        sessionId?: string;
      }) => Promise<HookSpeechStreamOpenResult>;
      control: (input: {
        streamId: string;
        action: 'pause' | 'resume' | 'cancel';
      }) => Promise<{ ok: boolean }>;
      close: (input: { streamId: string }) => Promise<{ ok: boolean }>;
    };
  };
  checkRouteHealth: (input: {
    routeHint: RuntimeRouteHint;
    routeOverride?: RuntimeRouteOverride;
  }) => Promise<RuntimeRouteHealthResult>;
};
