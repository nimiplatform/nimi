import {
  CLOUD_ONLY_STUDIO_PARAMETER,
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  LOCAL_ONLY_STUDIO_PARAMETER,
  SUPPORTED_STUDIO_PARAMETER,
  UNSUPPORTED_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';

export type StudioImageGenerationParameters = {
  negativePrompt?: string;
  count?: number;
  size?: string;
  seed?: number;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  referenceImage?: string;
  referenceImageArtifactId?: string;
  mask?: string;
};

export type StudioVideoGenerationParameters = {
  mode?: 't2v' | 'i2v-reference';
  referenceArtifactId?: string;
  negativePrompt?: string;
  resolution?: string;
  frames?: number;
  seed?: number;
  generateAudio?: boolean;
  ratio?: string;
  durationSec?: number;
  fps?: number;
  cameraFixed?: boolean;
  watermark?: boolean;
  draft?: boolean;
  returnLastFrame?: boolean;
  serviceTier?: string;
  executionExpiresAfterSec?: number;
};

const LOCAL_APP_UNAVAILABLE = Object.freeze({
  local: UNSUPPORTED_STUDIO_PARAMETER,
  cloud: UNSUPPORTED_STUDIO_PARAMETER,
});

export const MAX_STUDIO_ARTIFACT_UPLOAD_BYTES = 32 * 1024 * 1024;

export const studioImageGenerateParameters = defineStudioParameters<StudioImageGenerationParameters>({
  initial: () => ({}),
  routeMatrix: {
    negativePrompt: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    count: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    size: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    aspectRatio: CLOUD_ONLY_STUDIO_PARAMETER,
    quality: CLOUD_ONLY_STUDIO_PARAMETER,
    style: CLOUD_ONLY_STUDIO_PARAMETER,
    referenceImage: CLOUD_ONLY_STUDIO_PARAMETER,
    referenceImageArtifactId: LOCAL_ONLY_STUDIO_PARAMETER,
    mask: CLOUD_ONLY_STUDIO_PARAMETER,
  },
});

export const studioVideoGenerateParameters = defineStudioParameters<StudioVideoGenerationParameters>({
  initial: () => ({ mode: 't2v', generateAudio: true }),
  routeMatrix: {
    mode: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    referenceArtifactId: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    negativePrompt: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    resolution: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    frames: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    generateAudio: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    ratio: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    durationSec: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    fps: { local: { kind: 'fixed', value: 24 }, cloud: SUPPORTED_STUDIO_PARAMETER },
    cameraFixed: CLOUD_ONLY_STUDIO_PARAMETER,
    watermark: CLOUD_ONLY_STUDIO_PARAMETER,
    draft: CLOUD_ONLY_STUDIO_PARAMETER,
    returnLastFrame: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
    serviceTier: LOCAL_APP_UNAVAILABLE,
    executionExpiresAfterSec: LOCAL_APP_UNAVAILABLE,
  },
});
