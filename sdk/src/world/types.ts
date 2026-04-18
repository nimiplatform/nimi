import type { ScenarioJob } from '../runtime/generated/runtime/v1/ai.js';
import type {
  NimiRoutePolicy,
  WorldGenerateConditioningInput,
  WorldGenerateInput,
} from '../runtime/types-media.js';

export type WorldTruthAnchor = {
  worldId: string;
  title?: string;
  summary?: string;
  worldviewSummary?: string;
};

export type WorldTruthWorldStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export type WorldTruthWorldType = 'OASIS' | 'CREATOR';

export type WorldTruthContentRating = 'UNRATED' | 'G' | 'PG13' | 'R18' | 'EXPLICIT';

export type WorldTruthNativeCreationState = 'OPEN' | 'NATIVE_CREATION_FROZEN';

export type WorldTruthWorldviewLifecycle = 'ACTIVE' | 'MAINTENANCE' | 'FROZEN' | 'ARCHIVED';

export type WorldTruthRecommendedAgent = {
  agentId: string;
  name: string;
  handle?: string;
  avatarUrl?: string;
  importance?: 'PRIMARY' | 'SECONDARY' | 'BACKGROUND';
  role?: string;
  faction?: string;
  location?: string;
  statusSummary?: string;
};

export type WorldTruthWorldview = {
  lifecycle?: WorldTruthWorldviewLifecycle;
  version?: number;
  updatedAt?: string;
  languageCount?: number;
  regionCount?: number;
  landmarkCount?: number;
  truthRuleCount?: number;
  hasVisualGuide?: boolean;
};

export type WorldTruthListRecommendedAgent = {
  agentId: string;
  name: string;
  handle?: string;
  avatarUrl?: string;
};

export type WorldTruthListComputed = {
  time?: {
    currentWorldTime?: string;
    currentLabel?: string;
    eraLabel?: string;
    flowRatio?: number;
    isPaused?: boolean;
  };
  languages?: {
    primary?: string;
    common?: string[];
  };
  entry?: {
    recommendedAgents?: WorldTruthListRecommendedAgent[];
  };
  score?: {
    scoreEwma?: number;
  };
  featuredAgentCount?: number;
};

export type WorldTruthSummary = WorldTruthAnchor & {
  description?: string;
  tagline?: string;
  genre?: string;
  themes?: string[];
  status?: WorldTruthWorldStatus;
  type?: WorldTruthWorldType;
  createdAt?: string;
  updatedAt?: string;
  worldview?: WorldTruthWorldview;
};

export type WorldTruthListItem = WorldTruthSummary & {
  overview?: string;
  motto?: string;
  era?: string;
  iconUrl?: string;
  bannerUrl?: string;
  creatorId?: string;
  level?: number;
  levelUpdatedAt?: string;
  agentCount?: number;
  freezeReason?: string;
  lorebookEntryLimit?: number;
  nativeAgentLimit?: number;
  contentRating?: WorldTruthContentRating;
  nativeCreationState?: WorldTruthNativeCreationState;
  scoreA?: number;
  scoreC?: number;
  scoreE?: number;
  scoreEwma?: number;
  scoreQ?: number;
  transitInLimit?: number;
  computed?: WorldTruthListComputed;
};

export type WorldTruthDetail = WorldTruthSummary & {
  overview?: string;
  motto?: string;
  era?: string;
  iconUrl?: string;
  bannerUrl?: string;
  creatorId?: string;
  level?: number;
  agentCount?: number;
  featuredAgentCount?: number;
  contentRating?: WorldTruthContentRating;
  nativeCreationState?: WorldTruthNativeCreationState;
  recommendedAgents?: WorldTruthRecommendedAgent[];
};

export type WorldInputProjection = {
  worldId?: string;
  displayName?: string;
  textPrompt?: string;
  worldSummary?: string;
  spatialSummary?: string;
  entitySummary?: string;
  moodStyleHints?: string[];
  traversalHints?: string[];
  interactionHints?: string[];
  sourceModalities: Array<'text' | 'image' | 'multi-image' | 'video'>;
  conditioning?: WorldGenerateConditioningInput;
  tags?: string[];
  seed?: number;
};

export type WorldProjectionInput = {
  worldId?: string;
  displayName?: string;
  textPrompt?: string;
  worldSummary?: string;
  spatialSummary?: string;
  entitySummary?: string;
  moodStyleHints?: string[];
  traversalHints?: string[];
  interactionHints?: string[];
  conditioning?: WorldGenerateConditioningInput;
  tags?: string[];
  seed?: number;
};

export type WorldGenerateRuntimeOptions = {
  model: string;
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  signal?: AbortSignal;
};

export type WorldGenerateSubmitInput = WorldProjectionInput & WorldGenerateRuntimeOptions;

export type WorldGenerateRuntimeRequest = WorldGenerateInput;

export type WorldInspectVector = {
  x: number;
  y: number;
  z: number;
};

export type WorldInspectViewPreset = {
  version: number;
  mode: 'inspect';
  source: 'manual' | 'auto-collider' | 'auto-splat';
  camera: {
    position: WorldInspectVector;
    target: WorldInspectVector;
  };
};

export type WorldFixturePackage = {
  manifestPath?: string;
  worldId?: string;
  displayName?: string;
  worldMarbleUrl?: string;
  caption?: string;
  thumbnailUrl?: string;
  panoUrl?: string;
  colliderMeshUrl?: string;
  spzUrls?: Record<string, string>;
  semanticsMetadata?: {
    groundPlaneOffset?: number;
    metricScaleFactor?: number;
  };
  model?: string;
  artifacts?: Array<Record<string, unknown>>;
  spzLocalPath?: string;
  thumbnailLocalPath?: string;
  panoLocalPath?: string;
  colliderMeshLocalPath?: string;
  viewerPreset?: WorldInspectViewPreset;
};

export type WorldResolvedFixtureInput = {
  manifestPath?: string;
  worldId?: string;
  displayName?: string;
  model?: string;
  caption?: string;
  worldMarbleUrl?: string;
  spzRemoteUrl?: string;
  thumbnailRemoteUrl?: string;
  panoRemoteUrl?: string;
  colliderMeshRemoteUrl?: string;
  spzLocalPath?: string;
  thumbnailLocalPath?: string;
  panoLocalPath?: string;
  colliderMeshLocalPath?: string;
  semanticsMetadata?: {
    groundPlaneOffset?: number;
    metricScaleFactor?: number;
  };
  viewerPreset?: WorldInspectViewPreset;
};

export type WorldInspectRenderPlan = {
  mode: 'inspect';
  worldId?: string;
  manifestPath?: string;
  spzUrl?: string;
  spzLocalPath?: string;
  previewImageUrl?: string;
  previewImageLocalPath?: string;
  viewerPreset?: WorldInspectViewPreset;
  capabilityRequirements: {
    requiresSparkDriver: true;
    requiresSpzAsset: boolean;
    hasLocalFixture: boolean;
  };
  fallback: {
    previewImageAllowed: boolean;
    allowLaunchWithoutManifest: boolean;
  };
  initialCameraPolicy: {
    source: 'fixture_preset' | 'auto';
  };
};

export type WorldInspectSession = {
  sessionId: string;
  mode: 'inspect';
  worldId?: string;
  manifestPath?: string;
  fixture: WorldFixturePackage | null;
  renderPlan: WorldInspectRenderPlan | null;
  attachments: {
    activityId?: string;
    chatId?: string;
    agentId?: string;
  };
  lifecycle: 'ready' | 'degraded';
  createdAt: string;
  updatedAt: string;
};

export type WorldGenerateSubmitResult = {
  projection: WorldInputProjection;
  request: WorldGenerateRuntimeRequest;
  job: ScenarioJob;
};
