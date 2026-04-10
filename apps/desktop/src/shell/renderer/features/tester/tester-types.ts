import type { ModRuntimeLocalAssetKind, RuntimeCanonicalCapability, RuntimeRouteBinding, RuntimeRouteOptionsSnapshot } from '@nimiplatform/sdk/mod';

export type CapabilityId = 'text.generate' | 'text.embed' | 'image.generate' | 'image.create-job' | 'video.generate' | 'audio.synthesize' | 'audio.transcribe' | 'voice.clone' | 'voice.design';

export type CapabilityMeta = {
  id: CapabilityId;
  hasRoute: boolean;
  routeCapability?: RuntimeCanonicalCapability;
};

export const CAPABILITIES: CapabilityMeta[] = [
  { id: 'text.generate', hasRoute: true, routeCapability: 'text.generate' },
  { id: 'text.embed', hasRoute: true, routeCapability: 'text.embed' },
  { id: 'image.generate', hasRoute: true, routeCapability: 'image.generate' },
  { id: 'image.create-job', hasRoute: true, routeCapability: 'image.generate' },
  { id: 'video.generate', hasRoute: true, routeCapability: 'video.generate' },
  { id: 'audio.synthesize', hasRoute: true, routeCapability: 'audio.synthesize' },
  { id: 'audio.transcribe', hasRoute: true, routeCapability: 'audio.transcribe' },
  { id: 'voice.clone', hasRoute: false },
  { id: 'voice.design', hasRoute: false },
];

export type VoiceOption = {
  voiceId: string;
  name: string;
  lang: string;
};

export type RouteState = {
  snapshot: RuntimeRouteOptionsSnapshot | null;
  binding: RuntimeRouteBinding | null;
  routeLoading: boolean;
  routeError: string;
};

export type ResolvedRouteInfo = {
  source?: string;
  provider?: string;
  model?: string;
  modelId?: string;
  connectorId?: string;
  endpoint?: string;
  adapter?: string;
  engine?: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  goRuntimeStatus?: string;
  localProviderEndpoint?: string;
};

export type DiagnosticsInfo = {
  requestParams: Record<string, unknown> | null;
  resolvedRoute: ResolvedRouteInfo | null;
  responseMetadata: {
    finishReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    traceId?: string;
    modelResolved?: string;
    jobId?: string;
    artifactCount?: number;
    elapsed?: number;
  } | null;
};

export type TestState = {
  result: 'idle' | 'passed' | 'failed';
  output: unknown;
  rawResponse: string;
  busy: boolean;
  busyLabel?: string;
  error: string;
  diagnostics: DiagnosticsInfo;
};

export type CapabilityState = RouteState & TestState;
export type CapabilityStates = Record<CapabilityId, CapabilityState>;

export type ImageResponseFormatMode = 'auto' | 'base64' | 'url';
export type ImageWorkflowComponentDraft = {
  id: string;
  slot: string;
  localArtifactId: string;
};
export type ImageWorkflowProfileOverridesInput = {
  step?: string;
  cfgScale?: string;
  sampler?: string;
  scheduler?: string;
  optionsText?: string;
  rawJsonText?: string;
};
export type ImageWorkflowDraftState = {
  prompt: string;
  negativePrompt: string;
  size: string;
  n: string;
  seed: string;
  responseFormatMode: ImageResponseFormatMode;
  timeoutMs: string;
  step: string;
  cfgScale: string;
  sampler: string;
  scheduler: string;
  optionsText: string;
  rawProfileOverridesText: string;
  vaeModel: string;
  llmModel: string;
  clipLModel: string;
  clipGModel: string;
  controlnetModel: string;
  loraModel: string;
  auxiliaryModel: string;
  componentDrafts: ImageWorkflowComponentDraft[];
};

export const COMMON_IMAGE_WORKFLOW_SLOTS = [
  'vae_path',
  'llm_path',
  'clip_l_path',
  'clip_g_path',
  'controlnet_path',
  'lora_path',
  'aux_path',
] as const;

export type ImageWorkflowPresetSelectionKey = 'vaeModel' | 'llmModel' | 'clipLModel' | 'clipGModel' | 'controlnetModel' | 'loraModel' | 'auxiliaryModel';
export type ImageWorkflowCompanionTier = 'core' | 'extended';
export type ImageWorkflowPresetSelection = {
  key: ImageWorkflowPresetSelectionKey;
  slot: typeof COMMON_IMAGE_WORKFLOW_SLOTS[number];
  kind: ModRuntimeLocalAssetKind;
  tier: ImageWorkflowCompanionTier;
};

export const IMAGE_WORKFLOW_PRESET_SELECTIONS: ImageWorkflowPresetSelection[] = [
  { key: 'vaeModel', slot: 'vae_path', kind: 'vae', tier: 'core' },
  { key: 'llmModel', slot: 'llm_path', kind: 'chat', tier: 'core' },
  { key: 'clipLModel', slot: 'clip_l_path', kind: 'clip', tier: 'extended' },
  { key: 'clipGModel', slot: 'clip_g_path', kind: 'clip', tier: 'extended' },
  { key: 'controlnetModel', slot: 'controlnet_path', kind: 'controlnet', tier: 'extended' },
  { key: 'loraModel', slot: 'lora_path', kind: 'lora', tier: 'extended' },
  { key: 'auxiliaryModel', slot: 'aux_path', kind: 'auxiliary', tier: 'extended' },
];

export type CompanionArtifactSelectionsInput = Record<ImageWorkflowPresetSelectionKey, string> & {
  components: Array<Pick<ImageWorkflowComponentDraft, 'slot' | 'localArtifactId'>>;
};

export const MEDIA_IMAGE_COMPONENTS_REQUIRED_ERROR = 'LocalAI image workflow requires explicit companion artifacts. Select one or more layered companion presets, or add workflow components first. If you are not sure what to pick, install or verify the companion artifacts in desktop first.';

export const CAPABILITY_LABELS: Record<CapabilityId, { label: string; description: string }> = {
  'text.generate': { label: 'Chat', description: 'Text generation' },
  'text.embed': { label: 'Embed', description: 'Text embeddings' },
  'image.generate': { label: 'Image', description: 'Synchronous image generation' },
  'image.create-job': { label: 'Image Job', description: 'Asynchronous image generation' },
  'video.generate': { label: 'Video', description: 'Video generation' },
  'audio.synthesize': { label: 'TTS', description: 'Text to speech' },
  'audio.transcribe': { label: 'STT', description: 'Speech to text' },
  'voice.clone': { label: 'Voice Clone', description: 'Clone voice' },
  'voice.design': { label: 'Voice Design', description: 'Design voice' },
};
