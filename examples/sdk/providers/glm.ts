/**
 * GLM Tutorial (video + image + tts + optional stt) via nimi-sdk + runtime
 *
 * 1) Start runtime with GLM adapter:
 *    NIMI_RUNTIME_CLOUD_GLM_BASE_URL=https://open.bigmodel.cn \
 *    NIMI_RUNTIME_CLOUD_GLM_API_KEY=xxx \
 *    nimi start
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.glm
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_GLM_VIDEO_MODEL=glm/cogvideox-3
 *    export NIMI_GLM_IMAGE_MODEL=glm/cogview-3
 *    export NIMI_GLM_TTS_MODEL=glm/tts-1
 *    export NIMI_GLM_STT_MODEL=glm/asr-1
 *    export NIMI_GLM_VIDEO_OUT=./tmp/glm-video.mp4
 *    export NIMI_GLM_IMAGE_OUT=./tmp/glm-image.png
 *    export NIMI_GLM_TTS_OUT=./tmp/glm-tts.mp3
 *    export NIMI_GLM_STT_AUDIO_PATH=./sample.wav   # optional
 *
 * 3) Run:
 *    npx tsx examples/sdk/providers/glm.ts
 */

import { readFile } from 'node:fs/promises';

import {
  createProviderContext,
  env,
  mainWithErrorGuard,
  print,
  saveBase64,
  saveBytes,
} from './_common.js';

async function run(): Promise<void> {
  const appId = env('NIMI_APP_ID', 'example.providers.glm');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');

  const { endpoint, provider } = await createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'cloud',
    timeoutMs: 300_000,
  });

  print(`[glm] runtime grpc endpoint: ${endpoint}`);

  const videoResult = await provider.video(env('NIMI_GLM_VIDEO_MODEL', 'glm/cogvideox-3')).generate({
    prompt: env('NIMI_GLM_VIDEO_PROMPT', 'A smooth flyover of a modern city'),
    mode: 't2v',
    content: [
      {
        type: 'text',
        text: env('NIMI_GLM_VIDEO_PROMPT', 'A smooth flyover of a modern city'),
      },
    ],
    options: {
      durationSec: Number(env('NIMI_GLM_VIDEO_DURATION_SEC', '6')),
    },
  });
  const videoBytes = videoResult.artifacts[0]?.bytes;
  if (!videoBytes) {
    throw new Error('glm video generation returned empty artifact');
  }
  const videoOut = await saveBytes(env('NIMI_GLM_VIDEO_OUT', './tmp/glm-video.mp4'), videoBytes);
  print(`[glm][video] saved: ${videoOut}`);

  const imageResult = await provider.image(env('NIMI_GLM_IMAGE_MODEL', 'glm/cogview-3')).doGenerate({
    prompt: env('NIMI_GLM_IMAGE_PROMPT', 'A mountain at dusk in watercolor style'),
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
  });
  const imageBase64 = imageResult.images[0] || '';
  if (!imageBase64) {
    throw new Error('glm image generation returned empty result');
  }
  const imageOut = await saveBase64(env('NIMI_GLM_IMAGE_OUT', './tmp/glm-image.png'), imageBase64);
  print(`[glm][image] saved: ${imageOut}`);

  const ttsResult = await provider.tts(env('NIMI_GLM_TTS_MODEL', 'glm/tts-1')).synthesize({
    text: env('NIMI_GLM_TTS_TEXT', 'Hello from GLM TTS example.'),
  });
  const ttsBytes = ttsResult.artifacts[0]?.bytes;
  if (!ttsBytes) {
    throw new Error('glm tts returned empty audio');
  }
  const ttsOut = await saveBytes(env('NIMI_GLM_TTS_OUT', './tmp/glm-tts.mp3'), ttsBytes);
  print(`[glm][tts] saved: ${ttsOut}`);

  const sttAudioPath = env('NIMI_GLM_STT_AUDIO_PATH');
  if (sttAudioPath) {
    const audioBytes = await readFile(sttAudioPath);
    const sttResult = await provider.stt(env('NIMI_GLM_STT_MODEL', 'glm/asr-1')).transcribe({
      audioBytes: new Uint8Array(audioBytes),
      mimeType: env('NIMI_GLM_STT_MIME', 'audio/wav'),
    });
    print(`[glm][stt] text: ${sttResult.text}`);
  } else {
    print('[glm][stt] skipped: set NIMI_GLM_STT_AUDIO_PATH to run transcription');
  }
}

await mainWithErrorGuard(run);
