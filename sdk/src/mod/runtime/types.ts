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
} from '../../runtime/types.js';
import type { JsonObject } from '../../internal/utils.js';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteOptionsSnapshot,
  RuntimeRouteSource,
} from '../runtime-route.js';
import type { RuntimeRouteHealthResult } from '../types/llm.js';

export type ModRuntimeResolvedBinding = {
  capability: RuntimeCanonicalCapability;
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

export type ModRuntimeClient = {
  route: {
    listOptions(input: ModRuntimeRouteListOptionsInput): Promise<RuntimeRouteOptionsSnapshot>;
    resolve(input: ModRuntimeRouteResolveInput): Promise<ModRuntimeResolvedBinding>;
    checkHealth(input: ModRuntimeRouteCheckHealthInput): Promise<RuntimeRouteHealthResult>;
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
      getArtifacts(jobId: string): Promise<{ artifacts: ScenarioArtifact[]; traceId?: string }>;
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
