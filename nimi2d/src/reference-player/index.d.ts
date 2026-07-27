export type Nimi2DComposerSnapshot = import('../runtime/index.mjs').Nimi2DComposerSnapshot;
export type Nimi2DComposer = import('../runtime/index.mjs').Nimi2DComposer;
export type Nimi2DAmplitudeMouthLane = import('../runtime/index.mjs').Nimi2DAmplitudeMouthLane;
export type Nimi2DAudioAttachResult = import('../runtime/index.mjs').Nimi2DAudioAttachResult;
export type Nimi2DAudioSourceLike = import('../runtime/index.mjs').Nimi2DAudioSourceLike;
export type Nimi2DAudioContextLike = import('../runtime/index.mjs').Nimi2DAudioContextLike;

export type Nimi2DReferenceActionEvent =
  | { type: 'activity'; name: string; intensity?: number | null }
  | { type: 'emotion'; current: string; previous?: string | null }
  | { type: 'expression'; name: string; weight?: number; fade?: number }
  | { type: 'motion'; routeId: string; fade?: number; durationMs?: number; loop?: boolean; queue?: boolean; interrupt?: boolean }
  | { type: 'mouth_amplitude'; value: number }
  | { type: 'silence' }
  | { type: 'reset' };

export class Nimi2DReferenceActionStreamEventError extends Error {
  readonly code: string;
  readonly path: string;
}

export type Nimi2DReferenceActionStream = {
  readonly composer: Nimi2DComposer;
  readonly mouthLane: Nimi2DAmplitudeMouthLane;
  applyEvent(event: Nimi2DReferenceActionEvent): Nimi2DComposerSnapshot;
  applyEvents(events: Nimi2DReferenceActionEvent[]): Nimi2DComposerSnapshot;
  advanceFrame(deltaMs?: number): Nimi2DComposerSnapshot;
  snapshot(): Nimi2DComposerSnapshot;
  reset(): Nimi2DComposerSnapshot;
};

export type Nimi2DReferenceActionBenchFrame = {
  timestampMs: number;
  layerRefs: string[];
  activity: string;
  expression: string;
  motion: string;
  mouthOpen: number;
};

export type Nimi2DReferenceActionBenchInput = {
  backendKind: string;
  defaultOutfitLayerRefs: string[];
  captureFrame(): Nimi2DReferenceActionBenchFrame;
  flush(): Promise<void>;
  nowMs?: () => number;
  projection: Pick<Nimi2DComposer, 'applyActivity' | 'applyExpression' | 'applyMotion' | 'reset'>;
  mouth: {
    setAmplitude(value: number): void;
    attach(): Promise<void>;
    silent(): void;
  };
};

export type Nimi2DReferenceActionBenchResult = {
  verdict: 'pass_minimal_tier1' | 'fail';
  scope: 'pixi_renderer_foundation';
  metrics: Record<string, unknown>;
  observations: Nimi2DReferenceActionBenchFrame[];
  failures: string[];
};

export type Nimi2DReferenceActionStressInput = {
  backendKind: string;
  layerRefs: string[];
  defaultOutfitLayerRefs: string[];
  stream?: Nimi2DReferenceActionStream;
  frameDeltaMs?: number;
};

export type Nimi2DReferenceActionStressResult = {
  verdict: 'pass_stream_stress_tier1' | 'fail';
  scope: 'pixi_renderer_foundation';
  metrics: Record<string, unknown>;
  observations: Array<Nimi2DReferenceActionBenchFrame & Record<string, unknown>>;
  failures: string[];
};

export const NIMI2D_RUNTIME_SCOPE: 'pixi_renderer_foundation';
export function createNimi2DComposer(): Nimi2DComposer;
export function calculateNimi2DRmsVolume(samples: Uint8Array | number[]): number;
export function createNimi2DAmplitudeMouthLane(input?: {
  composer?: Pick<Nimi2DComposer, 'setMouthOpen'>;
  fftSize?: number;
}): Nimi2DAmplitudeMouthLane;
export function createNimi2DReferenceActionStream(input?: {
  composer?: Nimi2DComposer;
  mouthLane?: Nimi2DAmplitudeMouthLane;
}): Nimi2DReferenceActionStream;
export function runNimi2DReferenceActionBench(
  input: Nimi2DReferenceActionBenchInput,
): Promise<Nimi2DReferenceActionBenchResult>;
export function runNimi2DReferenceActionStress(
  input: Nimi2DReferenceActionStressInput,
): Promise<Nimi2DReferenceActionStressResult>;
