export type Nimi2DTier =
  | 'tier-0_static_layered'
  | 'tier-1_agent_basic'
  | 'tier-2_viseme_gesture'
  | 'tier-3_full_body_semantic';

export type Nimi2DPackageAsset = {
  asset_id: string;
  asset_kind: string;
  ref: string;
  sha256: string;
  format: 'png';
  width_px: number;
  height_px: number;
  byte_size: number;
  color_space: 'srgb';
  alpha_mode: 'straight';
  premultiplied_alpha: false;
};

export type Nimi2DPackageManifest = {
  manifest_kind: 'nimi.nimi2d.package';
  schema_version: 1;
  package_id: string;
  package_kind: 'character_package';
  canvas: {
    width_px: number;
    height_px: number;
  };
  source?: {
    layer_input_ref?: string | null;
    layer_generation_ref?: string | null;
    identity_preservation_ref?: string | null;
    content_admission_ref?: string | null;
    validator_evidence_ref?: string | null;
  };
  integrity: {
    package_digest_sha256: string | null;
    asset_count: number | null;
  } | null;
  governance: {
    base_body_renderable: false;
    default_outfit_required: true;
    adult_capability: 'unavailable_v1';
    content_admission_ref?: string | null;
    underage_body_content: 'rejected_or_not_present';
  };
  capability: {
    requested_tier: Nimi2DTier;
    proven_tier: Nimi2DTier;
  };
  base_body: {
    renderable: false;
    detail_neutral: true;
    layer_refs: string[];
  };
  wardrobe: {
    default_outfit_ref: string;
    assets: Array<{
      wardrobe_asset_id: string;
      wardrobe_kind: string;
      layer_refs: string[];
    }>;
  };
  render_layers: Nimi2DPackageRenderLayer[];
  assets: Nimi2DPackageAsset[];
};

export type Nimi2DPoint = {
  x: number;
  y: number;
};

export type Nimi2DRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Nimi2DPackageRenderLayerMask = {
  mask_kind: 'alpha_mask_asset';
  asset_id: string;
  channel: 'alpha';
  texture_bounds_px: Nimi2DRect;
};

export type Nimi2DPackageRenderLayer = {
  layer_ref: string;
  asset_id: string;
  layer_kind: string;
  draw_order_index: number;
  placement_px: Nimi2DPoint;
  texture_bounds_px: Nimi2DRect;
  visible_bounds_px: Nimi2DRect;
  mask?: Nimi2DPackageRenderLayerMask | null;
};

export type Nimi2DLayerTransformBinding = {
  layer_refs: string[];
  translate_x_range_px?: [number, number];
  translate_y_range_px?: [number, number];
  scale_x_range?: [number, number];
  scale_y_range?: [number, number];
  opacity_range?: [number, number];
};

export type Nimi2DBackendCapabilityProfile = {
  profile_id: string;
  backend_kind: 'nimi2d';
  renderer: {
    canvas: {
      width_px: number;
      height_px: number;
    };
    bindings?: {
      speech_mouth?: Nimi2DLayerTransformBinding;
      expression?: Nimi2DLayerTransformBinding;
      idle_life?: Nimi2DLayerTransformBinding;
      motion_routes?: Record<string, Nimi2DLayerTransformBinding>;
    };
  };
};

export type Nimi2DRenderPlan = {
  manifest: Nimi2DPackageManifest;
  capabilityProfile: Nimi2DBackendCapabilityProfile | null;
  renderLayers: Array<{
    layerRef: string;
    asset: Nimi2DPackageAsset;
    src: string;
    drawOrderIndex: number;
    placementPx: Nimi2DPoint;
    textureBoundsPx: Nimi2DRect;
    visibleBoundsPx: Nimi2DRect;
    mask: {
      maskKind: 'alpha_mask_asset';
      asset: Nimi2DPackageAsset;
      src: string;
      channel: 'alpha';
      textureBoundsPx: Nimi2DRect;
    } | null;
  }>;
  sourceCanvas: {
    width: number;
    height: number;
  };
  canvas: {
    width: number;
    height: number;
  };
};

export type Nimi2DComposerSnapshot = {
  activity: string;
  activityIntensity: number | null;
  activityWeight: number;
  emotion: string;
  expression: string;
  expressionWeight: number;
  motion: string;
  motionWeight: number;
  motionQueueLength: number;
  motionCompletedCount: number;
  motionInterruptedCount: number;
  mouthOpen: number;
  schedulerTimeMs: number;
  sequence: number;
};

export type Nimi2DComposer = {
  applyActivity(input: { name: string; intensity: number | null }): void;
  applyEmotion(input: { current: string; previous?: string | null }): void;
  applyMotion(input: {
    routeId: string;
    fade?: number;
    durationMs?: number;
    loop?: boolean;
    queue?: boolean;
    interrupt?: boolean;
  }): void;
  applyExpression(input: { name: string; weight?: number; fade?: number }): void;
  advanceFrame(deltaMs?: number): Nimi2DComposerSnapshot;
  subscribe(listener: (snapshot: Nimi2DComposerSnapshot) => void): () => void;
  snapshot(): Nimi2DComposerSnapshot;
  setMouthOpen(value: number): void;
  reset(): void;
};

export type Nimi2DAmplitudeMouthSnapshot = {
  weights: {
    A: 0;
    E: 0;
    I: 0;
    O: 0;
    U: 0;
    S: 0;
  };
  volume: number;
  mouthOpen: number;
  lane: 'amplitude';
};

export type Nimi2DAudioAttachResult =
  | { status: 'ok' }
  | { status: 'silent'; reason: 'audio_source_connect_failed' | 'explicit_silence'; error?: string }
  | { status: 'detached' };

export type Nimi2DAudioSourceLike = {
  connect(target: unknown): void;
  disconnect?(target?: unknown): void;
};

export type Nimi2DAudioContextLike = {
  createAnalyser(): {
    fftSize: number;
    getByteTimeDomainData(samples: Uint8Array): void;
  };
};

export type Nimi2DAmplitudeMouthLane = {
  attachAudioSource(source: Nimi2DAudioSourceLike, audioContext: Nimi2DAudioContextLike): Promise<Nimi2DAudioAttachResult>;
  detachAudioSource(): Nimi2DAmplitudeMouthSnapshot;
  silent(): Nimi2DAmplitudeMouthSnapshot;
  setAmplitude(value: number): Nimi2DAmplitudeMouthSnapshot;
  snapshot(): Nimi2DAmplitudeMouthSnapshot | null;
  poll(): Nimi2DAmplitudeMouthSnapshot;
  attachResult(): Nimi2DAudioAttachResult;
};

export type Nimi2DLiveActionEvent =
  | { type: 'activity'; name: string; intensity?: number | null }
  | { type: 'emotion'; current: string; previous?: string | null }
  | { type: 'expression'; name: string; weight?: number; fade?: number }
  | { type: 'motion'; routeId: string; fade?: number; durationMs?: number; loop?: boolean; queue?: boolean; interrupt?: boolean }
  | { type: 'mouth_amplitude'; value: number }
  | { type: 'silence' }
  | { type: 'reset' };

export type Nimi2DReferenceActionEvent = Nimi2DLiveActionEvent;

export class Nimi2DReferenceActionStreamEventError extends Error {
  readonly code: string;
  readonly path: string;
}

export class Nimi2DLiveActionStreamEventError extends Error {
  readonly code: string;
  readonly path: string;
}

export type Nimi2DLiveActionStream = {
  readonly composer: Nimi2DComposer;
  readonly mouthLane: Nimi2DAmplitudeMouthLane;
  applyEvent(event: Nimi2DLiveActionEvent): Nimi2DComposerSnapshot;
  applyEvents(events: Nimi2DLiveActionEvent[]): Nimi2DComposerSnapshot;
  advanceFrame(deltaMs?: number): Nimi2DComposerSnapshot;
  snapshot(): Nimi2DComposerSnapshot;
  reset(): Nimi2DComposerSnapshot;
};

export type Nimi2DReferenceActionStream = Nimi2DLiveActionStream;

export function calculateNimi2DRmsVolume(samples: Uint8Array | number[]): number;
export function createNimi2DAmplitudeMouthLane(input?: {
  composer?: Pick<Nimi2DComposer, 'setMouthOpen'>;
  fftSize?: number;
}): Nimi2DAmplitudeMouthLane;
export function createNimi2DReferenceActionStream(input?: {
  composer?: Nimi2DComposer;
  mouthLane?: Nimi2DAmplitudeMouthLane;
}): Nimi2DReferenceActionStream;
export function createNimi2DLiveActionStream(input?: {
  composer?: Nimi2DComposer;
  mouthLane?: Nimi2DAmplitudeMouthLane;
}): Nimi2DLiveActionStream;

export type Nimi2DLiveActionBenchFrame = {
  timestampMs: number;
  layerRefs: string[];
  activity: string;
  expression: string;
  motion: string;
  mouthOpen: number;
};

export type Nimi2DReferenceActionBenchFrame = Nimi2DLiveActionBenchFrame;

export type Nimi2DLiveActionBenchInput = {
  backendKind: string;
  defaultOutfitLayerRefs: string[];
  captureFrame(): Nimi2DLiveActionBenchFrame;
  flush(): Promise<void>;
  nowMs?: () => number;
  projection: Pick<Nimi2DComposer, 'applyActivity' | 'applyExpression' | 'applyMotion' | 'reset'>;
  mouth: {
    setAmplitude(value: number): void;
    attach(): Promise<void>;
    silent(): void;
  };
};

export type Nimi2DReferenceActionBenchInput = Nimi2DLiveActionBenchInput;

export type Nimi2DLiveActionBenchResult = {
  verdict: 'pass_minimal_tier1' | 'fail';
  scope: 'pixi_renderer_foundation';
  closesGenerationBench: false;
  closesMountedVisualProof: false;
  metrics: {
    maxProjectionLatencyMs: number;
    stateLegibilityScore: number;
    blendStabilityScore: number;
    jawAlignmentScore: number;
    interruptRecoveryMs: number;
    gazeBehavior: 'unsupported_v1';
  };
  observations: Nimi2DLiveActionBenchFrame[];
  failures: string[];
};

export type Nimi2DReferenceActionBenchResult = Nimi2DLiveActionBenchResult;

export type Nimi2DLiveActionStressInput = {
  backendKind: string;
  layerRefs: string[];
  defaultOutfitLayerRefs: string[];
  stream?: Nimi2DLiveActionStream;
  frameDeltaMs?: number;
};

export type Nimi2DReferenceActionStressInput = Nimi2DLiveActionStressInput;

export type Nimi2DLiveActionStressFrame = Nimi2DLiveActionBenchFrame & {
  motionQueueLength: number;
  motionCompletedCount: number;
  motionInterruptedCount: number;
  expressionWeight: number;
  motionWeight: number;
  sequence: number;
};

export type Nimi2DReferenceActionStressFrame = Nimi2DLiveActionStressFrame;

export type Nimi2DLiveActionStressResult = {
  verdict: 'pass_stream_stress_tier1' | 'fail';
  scope: 'pixi_renderer_foundation';
  closesGenerationBench: false;
  closesMountedVisualProof: false;
  metrics: {
    eventCount: number;
    rejectedInvalidEventCount: number;
    frameCount: number;
    stableFrameRate: number;
    maxQueueLength: number;
    maxCompletedCount: number;
    maxInterruptedCount: number;
    maxMouthOpen: number;
    minPostSilenceMouthOpen: number;
    schedulerMonotonic: boolean;
    sequenceMonotonic: boolean;
    finalNeutral: boolean;
  };
  observations: Nimi2DLiveActionStressFrame[];
  failures: string[];
};

export type Nimi2DReferenceActionStressResult = Nimi2DLiveActionStressResult;

export const NIMI2D_RUNTIME_SCOPE: 'pixi_renderer_foundation';

export function parseNimi2DPackageManifest(raw: string): Nimi2DPackageManifest;
export function parseNimi2DBackendCapabilityProfile(raw: string): Nimi2DBackendCapabilityProfile;
export function createNimi2DRenderPlan(input: {
  packageManifestRaw: string;
  capabilityProfileRaw?: string | null;
  packageManifestRef?: string | null;
}): Nimi2DRenderPlan;
export function createNimi2DComposer(): Nimi2DComposer;
export function runNimi2DReferenceActionBench(input: Nimi2DReferenceActionBenchInput): Promise<Nimi2DReferenceActionBenchResult>;
export function runNimi2DReferenceActionStress(input: Nimi2DReferenceActionStressInput): Promise<Nimi2DReferenceActionStressResult>;
export function runNimi2DLiveActionBench(input: Nimi2DLiveActionBenchInput): Promise<Nimi2DLiveActionBenchResult>;
export function runNimi2DLiveActionStress(input: Nimi2DLiveActionStressInput): Promise<Nimi2DLiveActionStressResult>;
export function optionalCapabilityProfileRef(value: string | null | undefined): string | null;
