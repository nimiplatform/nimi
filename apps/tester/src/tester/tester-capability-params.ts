import type { TesterCapabilityId } from './tester-capabilities.js';
import type { TesterRunTargetSource } from './tester-run-target.js';

export type TesterCapabilityParamRoute = 'local' | 'cloud';
export type TesterCapabilityParamRouteState =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'fixed'; readonly value: string | number };

export type TesterCapabilityParamPresentation = {
  readonly field: string;
  readonly state: 'enabled' | 'disabled' | 'fixed';
  readonly fixedValue?: string | number;
  readonly unavailableBecause?: 'route' | 'local-app-surface';
};

type ParamRouteMatrixEntry = Readonly<Record<TesterCapabilityParamRoute, TesterCapabilityParamRouteState>>;
type CapabilityParamRouteMatrix = Readonly<Record<string, ParamRouteMatrixEntry>>;

const SUPPORTED = { kind: 'supported' } as const;
const UNSUPPORTED = { kind: 'unsupported' } as const;
const LOCAL_AND_CLOUD = { local: SUPPORTED, cloud: SUPPORTED } as const;
const CLOUD_ONLY = { local: UNSUPPORTED, cloud: SUPPORTED } as const;
const LOCAL_APP_UNAVAILABLE = { local: UNSUPPORTED, cloud: UNSUPPORTED } as const;

/**
 * Tester presentation matrix for the effective Local App route, not a
 * provider/model option registry. Fields admitted by the Local App carrier
 * remain visible even when an exact Driver or provider may reject a particular
 * value or combination; Runtime owns that typed admission result.
 */
export const TESTER_CAPABILITY_PARAM_ROUTE_MATRIX = {
  // The Local App text carrier preserves the complete presence-aware sampling set.
  'text.generate': {
    temperature: LOCAL_AND_CLOUD,
    topP: LOCAL_AND_CLOUD,
    maxTokens: LOCAL_AND_CLOUD,
    topK: LOCAL_AND_CLOUD,
    presencePenalty: LOCAL_AND_CLOUD,
    frequencyPenalty: LOCAL_AND_CLOUD,
    stop: LOCAL_AND_CLOUD,
    seed: LOCAL_AND_CLOUD,
  },
  // Streaming uses the same Local App text carrier.
  'chat.stream': {
    temperature: LOCAL_AND_CLOUD,
    topP: LOCAL_AND_CLOUD,
    maxTokens: LOCAL_AND_CLOUD,
    topK: LOCAL_AND_CLOUD,
    presencePenalty: LOCAL_AND_CLOUD,
    frequencyPenalty: LOCAL_AND_CLOUD,
    stop: LOCAL_AND_CLOUD,
    seed: LOCAL_AND_CLOUD,
  },
  // P1 §3: Local has no admitted embed execution driver; Cloud accepts the input batch.
  'text.embed': {
    inputs: CLOUD_ONLY,
  },
  // The Local App image carrier preserves reference and mask inputs. Their
  // executable support remains dependent on the selected configuration.
  'image.generate': {
    negativePrompt: LOCAL_AND_CLOUD,
    count: LOCAL_AND_CLOUD,
    size: LOCAL_AND_CLOUD,
    seed: LOCAL_AND_CLOUD,
    aspectRatio: CLOUD_ONLY,
    quality: CLOUD_ONLY,
    style: CLOUD_ONLY,
    referenceImage: LOCAL_AND_CLOUD,
    mask: LOCAL_AND_CLOUD,
  },
  // P1 §5 + FIX2: Local now honors ratio/duration/last-frame. H3 fixes fps at 24;
  // camera/watermark/draft/tier/expiry remain typed rejects; Cloud keeps the full tester surface.
  'video.generate': {
    mode: LOCAL_AND_CLOUD,
    referenceArtifactId: LOCAL_AND_CLOUD,
    negativePrompt: LOCAL_AND_CLOUD,
    resolution: LOCAL_AND_CLOUD,
    frames: LOCAL_AND_CLOUD,
    seed: LOCAL_AND_CLOUD,
    generateAudio: LOCAL_AND_CLOUD,
    ratio: LOCAL_AND_CLOUD,
    durationSec: LOCAL_AND_CLOUD,
    fps: { local: { kind: 'fixed', value: 24 }, cloud: SUPPORTED },
    cameraFixed: CLOUD_ONLY,
    watermark: CLOUD_ONLY,
    draft: CLOUD_ONLY,
    returnLastFrame: LOCAL_AND_CLOUD,
    // Private scheduling fields are unavailable to Local Apps on either route.
    serviceTier: LOCAL_APP_UNAVAILABLE,
    executionExpiresAfterSec: LOCAL_APP_UNAVAILABLE,
  },
  // P1 §6: Local has no admitted speech synthesis driver; Cloud owns these fields.
  'audio.synthesize': {
    voiceKind: CLOUD_ONLY,
    voicePreset: CLOUD_ONLY,
    voiceAssetId: CLOUD_ONLY,
    language: CLOUD_ONLY,
    audioFormat: CLOUD_ONLY,
    sampleRateHz: CLOUD_ONLY,
    speed: CLOUD_ONLY,
    pitch: CLOUD_ONLY,
    volume: CLOUD_ONLY,
    emotion: CLOUD_ONLY,
    timingMode: CLOUD_ONLY,
  },
  // P1 §7: Local has no admitted transcription driver; Cloud accepts bytes/URI options.
  'audio.transcribe': {
    audioFile: CLOUD_ONLY,
    mimeType: CLOUD_ONLY,
    language: CLOUD_ONLY,
    timestamps: CLOUD_ONLY,
    diarization: CLOUD_ONLY,
    speakerCount: CLOUD_ONLY,
    prompt: CLOUD_ONLY,
    responseFormat: CLOUD_ONLY,
  },
  'speech.bundle': {},
  'world.generate': {},
} as const satisfies Record<TesterCapabilityId, CapabilityParamRouteMatrix>;

export function getTesterCapabilityParamPresentation(
  capabilityId: TesterCapabilityId,
  source: TesterRunTargetSource,
): readonly TesterCapabilityParamPresentation[] {
  const matrix = TESTER_CAPABILITY_PARAM_ROUTE_MATRIX[capabilityId] as CapabilityParamRouteMatrix;
  return Object.entries(matrix).map(([field, routes]) => {
    if (source !== 'local' && source !== 'cloud') return { field, state: 'enabled' };
    const routeState = routes[source];
    if (routeState.kind === 'fixed') {
      return { field, state: 'fixed', fixedValue: routeState.value };
    }
    if (routeState.kind === 'supported') return { field, state: 'enabled' };
    const otherRoute = source === 'local' ? routes.cloud : routes.local;
    return {
      field,
      state: 'disabled',
      unavailableBecause: otherRoute.kind === 'unsupported' ? 'local-app-surface' : 'route',
    };
  });
}

export function projectTesterCapabilityParamsForRoute<
  TParameters extends object,
>(
  capabilityId: TesterCapabilityId,
  source: TesterRunTargetSource,
  parameters: TParameters,
): TParameters {
  const presentation = new Map(
    getTesterCapabilityParamPresentation(capabilityId, source).map((item) => [item.field, item]),
  );
  const projected: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(parameters as Readonly<Record<string, unknown>>)) {
    if (presentation.get(field)?.state !== 'disabled') projected[field] = value;
  }
  for (const item of presentation.values()) {
    if (item.state === 'fixed') projected[item.field] = item.fixedValue;
  }
  return projected as TParameters;
}
