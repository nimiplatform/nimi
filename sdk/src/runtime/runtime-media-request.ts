import type { JsonObject } from '../internal/utils.js';
import {
  ExecutionMode,
  ScenarioType,
  SpeechTimingMode,
  VideoContentRole,
  VideoContentType,
  VideoMode,
  type ScenarioExtension,
  type SubmitScenarioJobRequest,
  type WorldGenerateImagePrompt,
  type WorldGenerateMultiImagePrompt,
  type WorldGenerateVideoPrompt,
} from './generated/runtime/v1/ai';
import type { RuntimeInternalContext } from './internal-context.js';
import type {
  ImageGenerateInput,
  NimiRoutePolicy,
  ScenarioJobSubmitInput,
  SpeechSynthesizeInput,
  SpeechTranscribeInput,
  VideoGenerateInput,
  WorldGenerateAssetSource,
  WorldGenerateInput,
} from './types.js';
import {
  ensureText,
  normalizeText,
  toLabels,
  toProtoStruct,
  toRoutePolicy,
} from './helpers.js';
import { runtimeAiRequestRequiresSubject } from './runtime-guards.js';

export async function runtimeBuildSubmitScenarioJobRequestForMedia(
  ctx: RuntimeInternalContext,
  input: ScenarioJobSubmitInput,
): Promise<SubmitScenarioJobRequest> {
  switch (input.modal) {
    case 'image': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'imageGenerate',
            imageGenerate: {
              prompt: normalizeText(value.prompt),
              negativePrompt: normalizeText(value.negativePrompt),
              n: Number(value.n || 0),
              size: normalizeText(value.size),
              aspectRatio: normalizeText(value.aspectRatio),
              quality: normalizeText(value.quality),
              style: normalizeText(value.style),
              seed: String(value.seed || 0),
              referenceImages: Array.isArray(value.referenceImages) ? value.referenceImages : [],
              mask: normalizeText(value.mask),
              responseFormat: normalizeText(value.responseFormat),
            },
          },
        },
      };
    }
    case 'video': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      const options = value.options || {};
      const videoContent = Array.isArray(value.content)
        ? value.content.map((entry) => {
          if (entry.type === 'text') {
            return {
              type: VideoContentType.TEXT,
              role: toVideoContentRole(entry.role || 'prompt'),
              text: normalizeText(entry.text),
              imageUrl: undefined,
              videoUrl: undefined,
              audioUrl: undefined,
            };
          }
          if (entry.type === 'video_url') {
            return {
              type: VideoContentType.VIDEO_URL,
              role: toVideoContentRole(entry.role),
              text: '',
              imageUrl: undefined,
              videoUrl: { url: normalizeText(entry.videoUrl) },
              audioUrl: undefined,
            };
          }
          if (entry.type === 'audio_url') {
            return {
              type: VideoContentType.AUDIO_URL,
              role: toVideoContentRole(entry.role),
              text: '',
              imageUrl: undefined,
              videoUrl: undefined,
              audioUrl: { url: normalizeText(entry.audioUrl) },
            };
          }
          return {
            type: VideoContentType.IMAGE_URL,
            role: toVideoContentRole(entry.role),
            text: '',
            imageUrl: { url: normalizeText(entry.imageUrl) },
            videoUrl: undefined,
            audioUrl: undefined,
          };
        })
        : [];

      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'videoGenerate',
            videoGenerate: {
              prompt: normalizeText(value.prompt),
              negativePrompt: normalizeText(value.negativePrompt),
              mode: toVideoMode(value.mode),
              content: videoContent,
              options: {
                resolution: normalizeText(options.resolution),
                ratio: normalizeText(options.ratio),
                durationSec: Number(options.durationSec || 0),
                frames: Number(options.frames || 0),
                fps: Number(options.fps || 0),
                seed: String(options.seed || 0),
                cameraFixed: Boolean(options.cameraFixed),
                watermark: Boolean(options.watermark),
                generateAudio: Boolean(options.generateAudio),
                draft: Boolean(options.draft),
                serviceTier: normalizeText(options.serviceTier),
                executionExpiresAfterSec: Number(options.executionExpiresAfterSec || 0),
                returnLastFrame: Boolean(options.returnLastFrame),
              },
            },
          },
        },
      };
    }
    case 'world': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'worldGenerate',
            worldGenerate: {
              displayName: normalizeText(value.displayName),
              textPrompt: normalizeText(value.textPrompt),
              tags: Array.isArray(value.tags)
                ? value.tags.map((tag) => normalizeText(tag)).filter(Boolean)
                : [],
              seed: String(value.seed || 0),
              conditioning: toWorldConditioning(value.conditioning),
            },
          },
        },
      };
    }
    case 'tts': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'speechSynthesize',
            speechSynthesize: {
              text: normalizeText(value.text),
              language: normalizeText(value.language),
              audioFormat: normalizeText(value.audioFormat),
              sampleRateHz: Number(value.sampleRateHz || 0),
              speed: Number(value.speed || 0),
              pitch: Number(value.pitch || 0),
              volume: Number(value.volume || 0),
              emotion: normalizeText(value.emotion),
              voiceRef: toVoiceRef(value.voice),
              timingMode: toSpeechTimingMode(value.timingMode),
              voiceRenderHints: value.voiceRenderHints
                ? {
                  stability: Number(value.voiceRenderHints.stability || 0),
                  similarityBoost: Number(value.voiceRenderHints.similarityBoost || 0),
                  style: Number(value.voiceRenderHints.style || 0),
                  useSpeakerBoost: Boolean(value.voiceRenderHints.useSpeakerBoost),
                  speed: Number(value.voiceRenderHints.speed || 0),
                }
                : undefined,
            },
          },
        },
      };
    }
    case 'music': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'musicGenerate',
            musicGenerate: {
              prompt: normalizeText(value.prompt),
              negativePrompt: normalizeText(value.negativePrompt),
              lyrics: normalizeText(value.lyrics),
              style: normalizeText(value.style),
              title: normalizeText(value.title),
              durationSeconds: Number(value.durationSeconds || 0),
              instrumental: Boolean(value.instrumental),
            },
          },
        },
      };
    }
    case 'stt': {
      const value = input.input;
      const base = await buildBaseSubmitScenarioJobRequest(ctx, input.modal, value);
      return {
        ...base,
        spec: {
          spec: {
            oneofKind: 'speechTranscribe',
            speechTranscribe: {
              mimeType: ensureText(value.mimeType, 'mimeType'),
              language: normalizeText(value.language),
              timestamps: Boolean(value.timestamps),
              diarization: Boolean(value.diarization),
              speakerCount: Number(value.speakerCount || 0),
              prompt: normalizeText(value.prompt),
              audioSource: toSpeechTranscribeAudioSource(value.audio),
              responseFormat: normalizeText(value.responseFormat),
            },
          },
        },
      };
    }
  }
}

type ScenarioCommonInput = {
  model: string;
  subjectUserId?: string;
  route?: NimiRoutePolicy;
  timeoutMs?: number;
  connectorId?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
  requestId?: string;
  labels?: Record<string, string>;
  extensions?: JsonObject;
};

async function buildBaseSubmitScenarioJobRequest(
  ctx: RuntimeInternalContext,
  modal: ScenarioJobSubmitInput['modal'],
  input: ScenarioCommonInput,
): Promise<SubmitScenarioJobRequest> {
  const timeoutMs = Number(input.timeoutMs || ctx.options.timeoutMs || 0);
  const route = toRoutePolicy(input.route);
  const connectorId = normalizeText(input.connectorId);
  const subjectUserId = runtimeAiRequestRequiresSubject({
    request: {
      head: {
        routePolicy: route,
        connectorId,
      },
    },
    metadata: input.metadata,
  })
    ? await ctx.resolveSubjectUserId(input.subjectUserId)
    : await ctx.resolveOptionalSubjectUserId(input.subjectUserId);
  const head = await ctx.normalizeScenarioHead({
    head: {
      appId: ctx.appId,
      subjectUserId: subjectUserId || '',
      modelId: ensureText(input.model, 'model'),
      routePolicy: route,
      timeoutMs,
      connectorId,
    },
    metadata: input.metadata,
  });

  return {
    head,
    scenarioType: scenarioTypeFromModal(modal),
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId: normalizeText(input.requestId),
    idempotencyKey: normalizeText(input.idempotencyKey),
    labels: toLabels(input.labels),
    spec: { spec: { oneofKind: undefined } },
    extensions: toScenarioExtensions(modal, input.extensions),
  };
}

function toSpeechTranscribeAudioSource(
  audio: SpeechTranscribeInput['audio'],
): {
  source:
    | { oneofKind: 'audioBytes'; audioBytes: Uint8Array }
    | { oneofKind: 'audioUri'; audioUri: string }
    | { oneofKind: 'audioChunks'; audioChunks: { chunks: Uint8Array[] } };
} {
  switch (audio.kind) {
    case 'bytes':
      return {
        source: {
          oneofKind: 'audioBytes',
          audioBytes: audio.bytes,
        },
      };
    case 'url':
      return {
        source: {
          oneofKind: 'audioUri',
          audioUri: normalizeText(audio.url),
        },
      };
    case 'chunks':
      return {
        source: {
          oneofKind: 'audioChunks',
          audioChunks: {
            chunks: audio.chunks,
          },
        },
      };
  }
}

function toVoiceRef(voice: string | undefined): {
  kind: number;
  reference: { oneofKind: 'providerVoiceRef'; providerVoiceRef: string };
} | undefined {
  const providerVoiceRef = normalizeText(voice);
  if (!providerVoiceRef) {
    return undefined;
  }
  return {
    kind: 3,
    reference: {
      oneofKind: 'providerVoiceRef',
      providerVoiceRef,
    },
  };
}

function scenarioTypeFromModal(modal: ScenarioJobSubmitInput['modal']): ScenarioType {
  switch (modal) {
    case 'image':
      return ScenarioType.IMAGE_GENERATE;
    case 'video':
      return ScenarioType.VIDEO_GENERATE;
    case 'world':
      return ScenarioType.WORLD_GENERATE;
    case 'tts':
      return ScenarioType.SPEECH_SYNTHESIZE;
    case 'stt':
      return ScenarioType.SPEECH_TRANSCRIBE;
    case 'music':
      return ScenarioType.MUSIC_GENERATE;
    default:
      return ScenarioType.UNSPECIFIED;
  }
}

const MODAL_EXTENSION_NAMESPACE: Record<ScenarioJobSubmitInput['modal'], string> = {
  image: 'nimi.scenario.image.request',
  video: 'nimi.scenario.video.request',
  world: 'nimi.scenario.world_generate.request',
  tts: 'nimi.scenario.speech_synthesize.request',
  stt: 'nimi.scenario.speech_transcribe.request',
  music: 'nimi.scenario.music_generate.request',
};

function toWorldConditioning(value: WorldGenerateInput['conditioning']): {
  oneofKind: 'imagePrompt';
  imagePrompt: WorldGenerateImagePrompt;
} | {
  oneofKind: 'multiImagePrompt';
  multiImagePrompt: WorldGenerateMultiImagePrompt;
} | {
  oneofKind: 'videoPrompt';
  videoPrompt: WorldGenerateVideoPrompt;
} | {
  oneofKind: undefined;
} {
  if (!value) {
    return { oneofKind: undefined };
  }
  switch (value.type) {
    case 'image':
      return {
        oneofKind: 'imagePrompt',
        imagePrompt: {
          content: toWorldAssetSource(value.content),
        },
      };
    case 'multi-image':
      return {
        oneofKind: 'multiImagePrompt',
        multiImagePrompt: {
          images: Array.isArray(value.images)
            ? value.images.map((image) => ({
              azimuth: Number(image.azimuth || 0),
              content: toWorldAssetSource(image.content),
            }))
            : [],
        },
      };
    case 'video':
      return {
        oneofKind: 'videoPrompt',
        videoPrompt: {
          content: toWorldAssetSource(value.content),
        },
      };
    default:
      return { oneofKind: undefined };
  }
}

function toWorldAssetSource(value: WorldGenerateAssetSource | undefined): {
  source: {
    oneofKind: 'uri';
    uri: string;
  } | {
    oneofKind: 'mediaAssetId';
    mediaAssetId: string;
  } | {
    oneofKind: undefined;
  };
} | undefined {
  if (!value) {
    return undefined;
  }
  if (value.kind === 'media_asset_id') {
    return {
      source: {
        oneofKind: 'mediaAssetId',
        mediaAssetId: normalizeText(value.mediaAssetId),
      },
    };
  }
  return {
    source: {
      oneofKind: 'uri',
      uri: normalizeText(value.uri),
    },
  };
}

function toScenarioExtensions(
  modal: ScenarioJobSubmitInput['modal'],
  extensions: JsonObject | undefined,
): ScenarioExtension[] {
  if (!extensions || Object.keys(extensions).length === 0) {
    return [];
  }
  const payload = toProtoStruct(extensions);
  if (!payload) {
    return [];
  }
  return [{
    namespace: MODAL_EXTENSION_NAMESPACE[modal],
    payload,
  }];
}

function toVideoMode(value: VideoGenerateInput['mode']): VideoMode {
  switch (value) {
    case 't2v':
      return VideoMode.T2V;
    case 'i2v-first-frame':
      return VideoMode.I2V_FIRST_FRAME;
    case 'i2v-first-last':
      return VideoMode.I2V_FIRST_LAST;
    case 'i2v-reference':
      return VideoMode.I2V_REFERENCE;
    default:
      return VideoMode.UNSPECIFIED;
  }
}

function toVideoContentRole(value: 'prompt' | 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'): VideoContentRole {
  switch (value) {
    case 'prompt':
      return VideoContentRole.PROMPT;
    case 'first_frame':
      return VideoContentRole.FIRST_FRAME;
    case 'last_frame':
      return VideoContentRole.LAST_FRAME;
    case 'reference_image':
      return VideoContentRole.REFERENCE_IMAGE;
    case 'reference_video':
      return VideoContentRole.REFERENCE_VIDEO;
    case 'reference_audio':
      return VideoContentRole.REFERENCE_AUDIO;
    default:
      return VideoContentRole.UNSPECIFIED;
  }
}

export function toSpeechTimingMode(value: SpeechSynthesizeInput['timingMode']): SpeechTimingMode {
  switch (value) {
    case 'word':
      return SpeechTimingMode.WORD;
    case 'char':
      return SpeechTimingMode.CHAR;
    case 'none':
      return SpeechTimingMode.NONE;
    default:
      return SpeechTimingMode.UNSPECIFIED;
  }
}
