import type { CompanionSlotDef, ImageParamsState, VideoParamsState } from './types.js';

// ---------------------------------------------------------------------------
// Companion slot definitions
// ---------------------------------------------------------------------------

export const COMPANION_SLOTS: CompanionSlotDef[] = [
  { slot: 'vae_path', label: 'VAE', kind: 'vae' },
  { slot: 'llm_path', label: 'LLM', kind: 'chat' },
  { slot: 'clip_l_path', label: 'CLIP-L', kind: 'clip' },
  { slot: 'clip_g_path', label: 'CLIP-G', kind: 'clip' },
  { slot: 'controlnet_path', label: 'ControlNet', kind: 'controlnet' },
  { slot: 'lora_path', label: 'LoRA', kind: 'lora' },
  { slot: 'aux_path', label: 'Auxiliary', kind: 'auxiliary' },
];

// kind enum values from proto LocalAssetKind
export const ASSET_KIND_MAP: Record<string, number[]> = {
  vae: [10],
  chat: [1],
  clip: [11],
  controlnet: [13],
  lora: [12],
  auxiliary: [14],
};

// ---------------------------------------------------------------------------
// Image constants
// ---------------------------------------------------------------------------

export const IMAGE_SIZE_PRESETS = ['512x512', '768x768', '1024x1024', '1024x576', '576x1024'];
export const IMAGE_RESPONSE_FORMAT_OPTIONS = ['auto', 'base64', 'url'];

export const DEFAULT_IMAGE_PARAMS: ImageParamsState = {
  size: '512x512',
  responseFormat: 'auto',
  seed: '',
  timeoutMs: '600000',
  steps: '25',
  cfgScale: '',
  sampler: '',
  scheduler: '',
  optionsText: '',
};

// ---------------------------------------------------------------------------
// Video constants
// ---------------------------------------------------------------------------

export const VIDEO_RATIO_OPTIONS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
export const VIDEO_MODE_OPTIONS = [
  { value: 't2v', label: 'Text to Video' },
  { value: 'i2v-first-frame', label: 'Image to Video (first frame)' },
  { value: 'i2v-reference', label: 'Image to Video (reference)' },
];

export const DEFAULT_VIDEO_PARAMS: VideoParamsState = {
  mode: 't2v',
  ratio: '16:9',
  durationSec: '5',
  resolution: '',
  fps: '',
  seed: '',
  timeoutMs: '600000',
  negativePrompt: '',
  cameraFixed: false,
  generateAudio: false,
};

// ---------------------------------------------------------------------------
// Asset filtering
// ---------------------------------------------------------------------------

export function filterAssetsByKind(assets: Array<{ kind: number; status: number }>, kind: string): Array<{ kind: number; status: number }> {
  const kindValues = ASSET_KIND_MAP[kind];
  if (!kindValues) return assets;
  return assets.filter((a) => kindValues.includes(a.kind) && a.status !== 4);
}

// ---------------------------------------------------------------------------
// Param parsing helpers
// ---------------------------------------------------------------------------

export function parseImageParams(stored: Record<string, unknown>): ImageParamsState {
  return {
    size: typeof stored.size === 'string' ? stored.size : DEFAULT_IMAGE_PARAMS.size,
    responseFormat: typeof stored.responseFormat === 'string' ? stored.responseFormat : DEFAULT_IMAGE_PARAMS.responseFormat,
    seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_IMAGE_PARAMS.seed,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_IMAGE_PARAMS.timeoutMs,
    steps: typeof stored.steps === 'string' ? stored.steps : DEFAULT_IMAGE_PARAMS.steps,
    cfgScale: typeof stored.cfgScale === 'string' ? stored.cfgScale : DEFAULT_IMAGE_PARAMS.cfgScale,
    sampler: typeof stored.sampler === 'string' ? stored.sampler : DEFAULT_IMAGE_PARAMS.sampler,
    scheduler: typeof stored.scheduler === 'string' ? stored.scheduler : DEFAULT_IMAGE_PARAMS.scheduler,
    optionsText: typeof stored.optionsText === 'string' ? stored.optionsText : DEFAULT_IMAGE_PARAMS.optionsText,
  };
}

export function parseVideoParams(stored: Record<string, unknown>): VideoParamsState {
  return {
    mode: typeof stored.mode === 'string' ? stored.mode : DEFAULT_VIDEO_PARAMS.mode,
    ratio: typeof stored.ratio === 'string' ? stored.ratio : DEFAULT_VIDEO_PARAMS.ratio,
    durationSec: typeof stored.durationSec === 'string' ? stored.durationSec : DEFAULT_VIDEO_PARAMS.durationSec,
    resolution: typeof stored.resolution === 'string' ? stored.resolution : DEFAULT_VIDEO_PARAMS.resolution,
    fps: typeof stored.fps === 'string' ? stored.fps : DEFAULT_VIDEO_PARAMS.fps,
    seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_VIDEO_PARAMS.seed,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_VIDEO_PARAMS.timeoutMs,
    negativePrompt: typeof stored.negativePrompt === 'string' ? stored.negativePrompt : DEFAULT_VIDEO_PARAMS.negativePrompt,
    cameraFixed: typeof stored.cameraFixed === 'boolean' ? stored.cameraFixed : DEFAULT_VIDEO_PARAMS.cameraFixed,
    generateAudio: typeof stored.generateAudio === 'boolean' ? stored.generateAudio : DEFAULT_VIDEO_PARAMS.generateAudio,
  };
}
