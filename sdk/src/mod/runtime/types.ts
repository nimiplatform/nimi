import type {
  DeleteVoiceAssetRequest,
  DeleteVoiceAssetResponse,
  GetVoiceAssetRequest,
  GetVoiceAssetResponse,
  ListPresetVoicesRequest,
  ListPresetVoicesResponse,
  ListVoiceAssetsRequest,
  ListVoiceAssetsResponse,
} from '../../runtime/generated/runtime/v1/voice.js';
import type {
  ArtifactChunk,
  ScenarioArtifact,
  ScenarioJob,
  ScenarioJobEvent,
  ScenarioOutput,
} from '../../runtime/generated/runtime/v1/ai.js';
import type {
  EmbeddingGenerateInput,
  EmbeddingGenerateOutput,
  ImageGenerateInput,
  ImageGenerateOutput,
  SpeechListVoicesInput,
  SpeechListVoicesOutput,
  SpeechSynthesizeInput,
  SpeechSynthesizeOutput,
  SpeechTranscribeInput,
  SpeechTranscribeOutput,
  TextGenerateInput,
  TextGenerateOutput,
  TextStreamInput,
  TextStreamOutput,
  VideoGenerateInput,
  VideoGenerateOutput,
  WorldGenerateInput,
} from '../../runtime/types.js';
import type { JsonObject } from '../../internal/utils.js';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteDescribeResult,
  RuntimeRouteOptionsSnapshot,
  RuntimeRouteResolvedBindingRef,
  RuntimeRouteSource,
} from '../runtime-route.js';
import type { RuntimeRouteHealthResult } from '../types/llm.js';
import type {
  AIConfig,
  AIConfigProbeResult,
  AISchedulingEvaluationTarget,
  AISchedulingJudgement,
  AIScopeRef,
  AISnapshot,
  MemoryEmbeddingBindResult,
  MemoryEmbeddingConfig,
  MemoryEmbeddingCutoverResult,
  MemoryEmbeddingRuntimeInput,
  MemoryEmbeddingRuntimeState,
} from './ai-config.js';

export type ModRuntimeResolvedBinding = {
  capability: RuntimeCanonicalCapability;
  resolvedBindingRef?: RuntimeRouteResolvedBindingRef;
  source: RuntimeRouteSource;
  provider: string;
  model: string;
  modelId?: string;
  connectorId: string;
  endpoint?: string;
  localModelId?: string;
  engine?: string;
  adapter?: string;
  localProviderEndpoint?: string;
  localOpenAiEndpoint?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: 'installed' | 'active' | 'unhealthy' | 'removed' | string;
};

export type ModRuntimeRouteListOptionsInput = {
  capability: RuntimeCanonicalCapability;
};

export type ModRuntimeRouteResolveInput = {
  capability: RuntimeCanonicalCapability;
  binding?: RuntimeRouteBinding;
};

export type ModRuntimeRouteCheckHealthInput = ModRuntimeRouteResolveInput;

export type ModRuntimeRouteDescribeInput = {
  capability: RuntimeCanonicalCapability;
  resolvedBindingRef: RuntimeRouteResolvedBindingRef;
};

export type ModRuntimeBoundTextGenerateInput =
  Omit<TextGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundTextStreamInput =
  Omit<TextStreamInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundEmbeddingGenerateInput =
  Omit<EmbeddingGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundImageGenerateInput =
  Omit<ImageGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundVideoGenerateInput =
  Omit<VideoGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundWorldGenerateInput =
  Omit<WorldGenerateInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundSpeechSynthesizeInput =
  Omit<SpeechSynthesizeInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundSpeechTranscribeInput =
  Omit<SpeechTranscribeInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeBoundSpeechListVoicesInput =
  Omit<SpeechListVoicesInput, 'model' | 'route' | 'fallback' | 'connectorId'>
  & {
    model?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeScenarioJobSubmitInput =
  | { modal: 'image'; input: ModRuntimeBoundImageGenerateInput }
  | { modal: 'video'; input: ModRuntimeBoundVideoGenerateInput }
  | { modal: 'world'; input: ModRuntimeBoundWorldGenerateInput }
  | { modal: 'tts'; input: ModRuntimeBoundSpeechSynthesizeInput }
  | { modal: 'stt'; input: ModRuntimeBoundSpeechTranscribeInput };

export type ModRuntimeListPresetVoicesInput =
  Omit<ListPresetVoicesRequest, 'modelId' | 'connectorId'>
  & {
    modelId?: string;
    connectorId?: string;
    binding?: RuntimeRouteBinding;
  };

export type ModRuntimeLocalAssetKind =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding'
  | 'vae'
  | 'clip'
  | 'lora'
  | 'controlnet'
  | 'auxiliary';

export type ModRuntimeLocalAssetStatus =
  | 'installed'
  | 'active'
  | 'unhealthy'
  | 'removed';

export type ModRuntimeListLocalAssetsInput = {
  kind?: ModRuntimeLocalAssetKind;
  status?: ModRuntimeLocalAssetStatus;
  engine?: string;
};

export type ModRuntimeProfileEntryOverride = {
  entryId: string;
  localAssetId: string;
};

export type ModRuntimeLocalProfileEntryKind = 'asset' | 'service' | 'node';

export type ModRuntimeLocalProfileRequirement = {
  minGpuMemoryGb?: number;
  minDiskBytes?: number;
  platforms?: string[];
  notes?: string[];
};

export type ModRuntimeLocalProfileDescriptorEntry = {
  entryId: string;
  kind: ModRuntimeLocalProfileEntryKind;
  title?: string;
  description?: string;
  capability?: RuntimeCanonicalCapability | string;
  required?: boolean;
  preferred?: boolean;
  assetId?: string;
  assetKind?: ModRuntimeLocalAssetKind;
  engineSlot?: string;
  repo?: string;
  serviceId?: string;
  nodeId?: string;
  engine?: string;
  templateId?: string;
  revision?: string;
  tags?: string[];
};

export type ModRuntimeLocalProfile = {
  id: string;
  title: string;
  description?: string;
  recommended: boolean;
  consumeCapabilities: Array<RuntimeCanonicalCapability | string>;
  entries: ModRuntimeLocalProfileDescriptorEntry[];
  requirements?: ModRuntimeLocalProfileRequirement;
};

export type ModRuntimeLocalProfileInstallStatus = {
  modId: string;
  profileId: string;
  status: 'ready' | 'missing' | 'degraded';
  warnings: string[];
  missingEntries: string[];
  updatedAt: string;
};

export type ModRuntimeLocalProfileInstallResult = {
  modId: string;
  profileId: string;
  accepted: boolean;
  declined: boolean;
  warnings: string[];
  reasonCode?: string;
};

export type ModRuntimeLocalAssetRecord = {
  localAssetId: string;
  assetId: string;
  kind: ModRuntimeLocalAssetKind;
  engine: string;
  entry: string;
  files: string[];
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  status: ModRuntimeLocalAssetStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
  metadata?: JsonObject;
};

export type ModRuntimeSchedulingResourceHint = {
  estimatedVramBytes?: number | null;
  estimatedRamBytes?: number | null;
  estimatedDiskBytes?: number | null;
  engine?: string | null;
};

/** K-SCHED-002: Scheduling evaluation target for ModRuntimeClient. */
export type ModRuntimeSchedulingEvaluationTarget = {
  capability: string;
  /** K-SCHED-004: module owning the local profile for dependency denial check. */
  modId?: string | null;
  /** K-SCHED-004: local profile ID for dependency denial check. */
  profileId?: string | null;
  resourceHint?: ModRuntimeSchedulingResourceHint | null;
};

/** K-SCHED-002: Scheduling judgement payload mapped from runtime SchedulingJudgement. */
export type ModRuntimeSchedulerJudgement = {
  state: string;
  detail: string;
  occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
  resourceWarnings: string[];
};

/** K-SCHED-002: Per-target scheduling judgement mapping. */
export type ModRuntimeSchedulerTargetJudgement = {
  target: ModRuntimeSchedulingEvaluationTarget;
  judgement: ModRuntimeSchedulerJudgement;
};

/** K-SCHED-002: Scheduling batch peek input for ModRuntimeClient. */
export type ModRuntimeSchedulerPeekInput = {
  appId: string;
  targets: ModRuntimeSchedulingEvaluationTarget[];
};

/** K-SCHED-002: Scheduling batch peek result mapped from runtime PeekSchedulingResponse. */
export type ModRuntimeSchedulerPeekResult = {
  occupancy: { globalUsed: number; globalCap: number; appUsed: number; appCap: number } | null;
  aggregateJudgement: ModRuntimeSchedulerJudgement | null;
  targetJudgements: ModRuntimeSchedulerTargetJudgement[];
};

export type ModRuntimeClient = {
  route: {
    listOptions(input: ModRuntimeRouteListOptionsInput): Promise<RuntimeRouteOptionsSnapshot>;
    resolve(input: ModRuntimeRouteResolveInput): Promise<ModRuntimeResolvedBinding>;
    checkHealth(input: ModRuntimeRouteCheckHealthInput): Promise<RuntimeRouteHealthResult>;
    describe(input: ModRuntimeRouteDescribeInput): Promise<RuntimeRouteDescribeResult>;
  };
  /** K-SCHED-002: Scheduling preflight surface. */
  scheduler: {
    peek(input: ModRuntimeSchedulerPeekInput): Promise<ModRuntimeSchedulerPeekResult>;
  };
  local: {
    listAssets(input?: ModRuntimeListLocalAssetsInput): Promise<ModRuntimeLocalAssetRecord[]>;
    listProfiles(): Promise<ModRuntimeLocalProfile[]>;
    requestProfileInstall(input: {
      profileId: string;
      capability?: RuntimeCanonicalCapability | string;
      confirmMessage?: string;
      entryOverrides?: ModRuntimeProfileEntryOverride[];
    }): Promise<ModRuntimeLocalProfileInstallResult>;
    getProfileInstallStatus(input: {
      profileId: string;
      capability?: RuntimeCanonicalCapability | string;
      entryOverrides?: ModRuntimeProfileEntryOverride[];
    }): Promise<ModRuntimeLocalProfileInstallStatus>;
  };
  aiConfig: {
    get(scopeRef: AIScopeRef): AIConfig;
    update(scopeRef: AIScopeRef, config: AIConfig): void;
    listScopes(): AIScopeRef[];
    probe(scopeRef: AIScopeRef): Promise<AIConfigProbeResult>;
    probeFeasibility(scopeRef: AIScopeRef): Promise<AIConfigProbeResult>;
    probeSchedulingTarget(
      scopeRef: AIScopeRef,
      target: AISchedulingEvaluationTarget,
    ): Promise<AISchedulingJudgement | null>;
    subscribe(scopeRef: AIScopeRef, callback: (config: AIConfig) => void): () => void;
  };
  aiSnapshot: {
    record(scopeRef: AIScopeRef, snapshot: AISnapshot): void;
    get(executionId: string): AISnapshot | null;
    getLatest(scopeRef: AIScopeRef): AISnapshot | null;
  };
  memoryEmbeddingConfig: {
    get(scopeRef: AIScopeRef): MemoryEmbeddingConfig;
    update(scopeRef: AIScopeRef, config: MemoryEmbeddingConfig): void;
    subscribe(scopeRef: AIScopeRef, callback: (config: MemoryEmbeddingConfig) => void): () => void;
  };
  memoryEmbeddingRuntime: {
    inspect(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingRuntimeState>;
    requestBind(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingBindResult>;
    requestCutover(input: MemoryEmbeddingRuntimeInput): Promise<MemoryEmbeddingCutoverResult>;
  };
  ai: {
    text: {
      generate(input: ModRuntimeBoundTextGenerateInput): Promise<TextGenerateOutput>;
      stream(input: ModRuntimeBoundTextStreamInput): Promise<TextStreamOutput>;
    };
    embedding: {
      generate(input: ModRuntimeBoundEmbeddingGenerateInput): Promise<EmbeddingGenerateOutput>;
    };
  };
  media: {
    image: {
      generate(input: ModRuntimeBoundImageGenerateInput): Promise<ImageGenerateOutput>;
      stream(input: ModRuntimeBoundImageGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
    };
    video: {
      generate(input: ModRuntimeBoundVideoGenerateInput): Promise<VideoGenerateOutput>;
      stream(input: ModRuntimeBoundVideoGenerateInput): Promise<AsyncIterable<ArtifactChunk>>;
    };
    world: {
      generate(input: ModRuntimeBoundWorldGenerateInput): Promise<ScenarioJob>;
    };
    tts: {
      synthesize(input: ModRuntimeBoundSpeechSynthesizeInput): Promise<SpeechSynthesizeOutput>;
      stream(input: ModRuntimeBoundSpeechSynthesizeInput): Promise<AsyncIterable<ArtifactChunk>>;
      listVoices(input: ModRuntimeBoundSpeechListVoicesInput): Promise<SpeechListVoicesOutput>;
    };
    stt: {
      transcribe(input: ModRuntimeBoundSpeechTranscribeInput): Promise<SpeechTranscribeOutput>;
    };
    jobs: {
      submit(input: ModRuntimeScenarioJobSubmitInput): Promise<ScenarioJob>;
      get(jobId: string): Promise<ScenarioJob>;
      cancel(input: { jobId: string; reason?: string }): Promise<ScenarioJob>;
      subscribe(jobId: string): Promise<AsyncIterable<ScenarioJobEvent>>;
      getArtifacts(jobId: string): Promise<{ artifacts: ScenarioArtifact[]; traceId?: string; output?: ScenarioOutput }>;
    };
  };
  voice: {
    getAsset(request: GetVoiceAssetRequest): Promise<GetVoiceAssetResponse>;
    listAssets(request: ListVoiceAssetsRequest): Promise<ListVoiceAssetsResponse>;
    deleteAsset(request: DeleteVoiceAssetRequest): Promise<DeleteVoiceAssetResponse>;
    listPresetVoices(input: ModRuntimeListPresetVoicesInput): Promise<ListPresetVoicesResponse>;
  };
};

export type ModRuntimeLocalProfileEntry = {
  entryId: string;
  kind: 'asset' | 'service' | 'node';
  capability?: RuntimeCanonicalCapability;
  required: boolean;
  selected: boolean;
  preferred: boolean;
  assetId?: string;
  assetKind?: ModRuntimeLocalAssetKind;
  engineSlot?: string;
  templateId?: string;
  repo?: string;
  engine?: string;
  serviceId?: string;
  nodeId?: string;
  reasonCode?: string;
  warnings: string[];
};

export type ModRuntimeRepairAction = {
  actionId: string;
  label: string;
  reasonCode: string;
  entryId?: string;
  capability?: RuntimeCanonicalCapability;
};

export type ModRuntimeLocalProfileSnapshot = {
  modId: string;
  planId?: string;
  status: 'ready' | 'missing' | 'degraded';
  routeSource: 'local' | 'cloud' | 'mixed' | 'unknown';
  reasonCode?: string;
  warnings: string[];
  entries: ModRuntimeLocalProfileEntry[];
  repairActions: ModRuntimeRepairAction[];
  updatedAt: string;
};

export type ModRuntimeInspector = {
  getLocalProfileSnapshot: (
    capability?: RuntimeCanonicalCapability,
    routeSourceHint?: 'cloud' | 'local',
  ) => Promise<ModRuntimeLocalProfileSnapshot>;
  getRepairActions: (capability?: RuntimeCanonicalCapability) => Promise<ModRuntimeRepairAction[]>;
};
