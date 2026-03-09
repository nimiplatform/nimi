/**
 * Nexa Tutorial (chat + tts + optional stt) via nimi-sdk + runtime
 *
 * 1) Start runtime with Nexa backend:
 *    NIMI_RUNTIME_LOCAL_NEXA_BASE_URL=http://127.0.0.1:11434 \
 *    NIMI_RUNTIME_LOCAL_NEXA_API_KEY=<optional> \
 *    nimi start
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.nexa
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_NEXA_TEXT_MODEL=nexa/qwen
 *    export NIMI_NEXA_TTS_MODEL=nexa/tts
 *    export NIMI_NEXA_STT_MODEL=nexa/stt
 *    export NIMI_NEXA_TTS_OUT=./tmp/nexa-tts.mp3
 *    export NIMI_NEXA_STT_AUDIO_PATH=./sample.wav   # optional
 *
 * 3) Run:
 *    npx tsx examples/sdk/providers/nexa.ts
 */

import { readFile } from 'node:fs/promises';

import {
  createProviderContext,
  env,
  firstTextFromGenerateContent,
  mainWithErrorGuard,
  print,
  saveBytes,
} from './_common.js';

async function run(): Promise<void> {
  const appId = env('NIMI_APP_ID', 'example.providers.nexa');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const textModel = env('NIMI_NEXA_TEXT_MODEL', 'nexa/qwen');
  const ttsModel = env('NIMI_NEXA_TTS_MODEL', 'nexa/tts');
  const sttModel = env('NIMI_NEXA_STT_MODEL', 'nexa/stt');
  const ttsOut = env('NIMI_NEXA_TTS_OUT', './tmp/nexa-tts.mp3');
  const sttAudioPath = env('NIMI_NEXA_STT_AUDIO_PATH');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'local',
  });

  print(`[nexa] runtime grpc endpoint: ${endpoint}`);

  const textResult = await provider.text(textModel).doGenerate({
    prompt: [{
      role: 'user',
      content: [{ type: 'text', text: '请用一句话说明今天要完成什么。' }],
    }],
    providerOptions: {},
  });
  print(`[nexa][chat] ${firstTextFromGenerateContent(textResult.content)}`);

  const ttsResult = await provider.tts(ttsModel).synthesize({
    text: env('NIMI_NEXA_TTS_TEXT', 'Hello from Nimi Nexa example.'),
  });
  if (!ttsResult.artifacts[0]?.bytes) {
    throw new Error('nexa tts returned empty audio');
  }
  const ttsPath = await saveBytes(ttsOut, ttsResult.artifacts[0].bytes);
  print(`[nexa][tts] saved: ${ttsPath}`);

  if (sttAudioPath) {
    const audioBytes = await readFile(sttAudioPath);
    const sttResult = await provider.stt(sttModel).transcribe({
      audioBytes: new Uint8Array(audioBytes),
      mimeType: env('NIMI_NEXA_STT_MIME', 'audio/wav'),
    });
    print(`[nexa][stt] text: ${sttResult.text}`);
  } else {
    print('[nexa][stt] skipped: set NIMI_NEXA_STT_AUDIO_PATH to run transcription demo');
  }

  try {
    await provider.video(env('NIMI_NEXA_VIDEO_MODEL', 'nexa/video')).generate({
      prompt: 'test unsupported path',
      mode: 't2v',
      content: [
        {
          type: 'text',
          text: 'test unsupported path',
        },
      ],
      options: {
        durationSec: 4,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    print(`[nexa][video] expected fail-close: ${message}`);
  }
}

await mainWithErrorGuard(run);
