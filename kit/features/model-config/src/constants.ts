import type {
  AudioSynthesizeParamsState,
  AudioTranscribeParamsState,
  CompanionSlotDef,
  ImageParamsState,
  TextGenerateParamsState,
  VideoParamsState,
  VoiceWorkflowParamsState,
} from './types.js';

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

// ---------------------------------------------------------------------------
// Text generate constants
// ---------------------------------------------------------------------------

export const TEXT_RESPONSE_STOP_SEQUENCES_MAX = 4;

export const DEFAULT_TEXT_GENERATE_PARAMS: TextGenerateParamsState = {
  temperature: '',
  topP: '',
  topK: '',
  maxTokens: '',
  timeoutMs: '',
  stopSequences: [],
  presencePenalty: '',
  frequencyPenalty: '',
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') out.push(entry);
  }
  return out;
}

export function parseTextGenerateParams(stored: Record<string, unknown>): TextGenerateParamsState {
  return {
    temperature: typeof stored.temperature === 'string' ? stored.temperature : DEFAULT_TEXT_GENERATE_PARAMS.temperature,
    topP: typeof stored.topP === 'string' ? stored.topP : DEFAULT_TEXT_GENERATE_PARAMS.topP,
    topK: typeof stored.topK === 'string' ? stored.topK : DEFAULT_TEXT_GENERATE_PARAMS.topK,
    maxTokens: typeof stored.maxTokens === 'string' ? stored.maxTokens : DEFAULT_TEXT_GENERATE_PARAMS.maxTokens,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_TEXT_GENERATE_PARAMS.timeoutMs,
    stopSequences: Array.isArray(stored.stopSequences)
      ? toStringArray(stored.stopSequences).slice(0, TEXT_RESPONSE_STOP_SEQUENCES_MAX)
      : DEFAULT_TEXT_GENERATE_PARAMS.stopSequences,
    presencePenalty: typeof stored.presencePenalty === 'string' ? stored.presencePenalty : DEFAULT_TEXT_GENERATE_PARAMS.presencePenalty,
    frequencyPenalty: typeof stored.frequencyPenalty === 'string' ? stored.frequencyPenalty : DEFAULT_TEXT_GENERATE_PARAMS.frequencyPenalty,
  };
}

// ---------------------------------------------------------------------------
// Audio synthesize constants
// ---------------------------------------------------------------------------

export const AUDIO_SYNTHESIZE_RESPONSE_FORMAT_OPTIONS = ['mp3', 'wav', 'ogg', 'opus', 'flac'];

export const DEFAULT_AUDIO_SYNTHESIZE_PARAMS: AudioSynthesizeParamsState = {
  voiceId: '',
  speakingRate: '',
  volume: '',
  pitchSemitones: '',
  languageHint: '',
  responseFormat: 'mp3',
  timeoutMs: '',
};

export function parseAudioSynthesizeParams(stored: Record<string, unknown>): AudioSynthesizeParamsState {
  return {
    voiceId: typeof stored.voiceId === 'string' ? stored.voiceId : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.voiceId,
    speakingRate: typeof stored.speakingRate === 'string' ? stored.speakingRate : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.speakingRate,
    volume: typeof stored.volume === 'string' ? stored.volume : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.volume,
    pitchSemitones: typeof stored.pitchSemitones === 'string' ? stored.pitchSemitones : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.pitchSemitones,
    languageHint: typeof stored.languageHint === 'string' ? stored.languageHint : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.languageHint,
    responseFormat: typeof stored.responseFormat === 'string' ? stored.responseFormat : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.responseFormat,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_AUDIO_SYNTHESIZE_PARAMS.timeoutMs,
  };
}

// ---------------------------------------------------------------------------
// Audio transcribe constants
// ---------------------------------------------------------------------------

export const AUDIO_TRANSCRIBE_RESPONSE_FORMAT_OPTIONS = ['text', 'srt', 'vtt', 'verbose_json'];

export const DEFAULT_AUDIO_TRANSCRIBE_PARAMS: AudioTranscribeParamsState = {
  language: '',
  responseFormat: 'text',
  timeoutMs: '',
  speakerCount: '',
  prompt: '',
  timestamps: false,
  diarization: false,
};

export function parseAudioTranscribeParams(stored: Record<string, unknown>): AudioTranscribeParamsState {
  return {
    language: typeof stored.language === 'string' ? stored.language : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.language,
    responseFormat: typeof stored.responseFormat === 'string' ? stored.responseFormat : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.responseFormat,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.timeoutMs,
    speakerCount: typeof stored.speakerCount === 'string' ? stored.speakerCount : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.speakerCount,
    prompt: typeof stored.prompt === 'string' ? stored.prompt : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.prompt,
    timestamps: typeof stored.timestamps === 'boolean' ? stored.timestamps : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.timestamps,
    diarization: typeof stored.diarization === 'boolean' ? stored.diarization : DEFAULT_AUDIO_TRANSCRIBE_PARAMS.diarization,
  };
}

// ---------------------------------------------------------------------------
// Voice workflow constants
// ---------------------------------------------------------------------------

export const DEFAULT_VOICE_WORKFLOW_PARAMS: VoiceWorkflowParamsState = {
  referenceAssetId: '',
  referenceText: '',
  voiceDesignPrompt: '',
  durationSec: '',
  seed: '',
  timeoutMs: '',
};

export function parseVoiceWorkflowParams(stored: Record<string, unknown>): VoiceWorkflowParamsState {
  return {
    referenceAssetId: typeof stored.referenceAssetId === 'string' ? stored.referenceAssetId : DEFAULT_VOICE_WORKFLOW_PARAMS.referenceAssetId,
    referenceText: typeof stored.referenceText === 'string' ? stored.referenceText : DEFAULT_VOICE_WORKFLOW_PARAMS.referenceText,
    voiceDesignPrompt: typeof stored.voiceDesignPrompt === 'string' ? stored.voiceDesignPrompt : DEFAULT_VOICE_WORKFLOW_PARAMS.voiceDesignPrompt,
    durationSec: typeof stored.durationSec === 'string' ? stored.durationSec : DEFAULT_VOICE_WORKFLOW_PARAMS.durationSec,
    seed: typeof stored.seed === 'string' ? stored.seed : DEFAULT_VOICE_WORKFLOW_PARAMS.seed,
    timeoutMs: typeof stored.timeoutMs === 'string' ? stored.timeoutMs : DEFAULT_VOICE_WORKFLOW_PARAMS.timeoutMs,
  };
}
