/**
 * Bytedance OpenSpeech Tutorial (tts + stt) via nimi-sdk + runtime
 *
 * 1) Start runtime with Bytedance OpenSpeech adapter:
 *    cd runtime
 *    NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL=https://your-openspeech-endpoint \
 *    NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY=xxx \
 *    go run ./cmd/nimi serve
 *
 * 2) Required / optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.bytedance
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_BYTEDANCE_TTS_MODEL=volcengine/tts-1
 *    export NIMI_BYTEDANCE_STT_MODEL=volcengine/stt-1
 *    export NIMI_BYTEDANCE_TTS_OUT=./tmp/bytedance-tts.mp3
 *    export NIMI_BYTEDANCE_STT_AUDIO_PATH=./sample.wav   # optional
 *    export NIMI_BYTEDANCE_STT_TRANSPORT=rest            # optional: rest|ws
 *
 * 3) Run:
 *    npx tsx examples/sdk/providers/bytedance-openspeech.ts
 */

import { readFile } from 'node:fs/promises';

import {
  createProviderContext,
  env,
  mainWithErrorGuard,
  print,
  saveBytes,
} from './_common.js';

async function run(): Promise<void> {
  const appId = env('NIMI_APP_ID', 'example.providers.bytedance');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const ttsModel = env('NIMI_BYTEDANCE_TTS_MODEL', 'volcengine/tts-1');
  const sttModel = env('NIMI_BYTEDANCE_STT_MODEL', 'volcengine/stt-1');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'token-api',
  });

  print(`[bytedance-openspeech] runtime grpc endpoint: ${endpoint}`);

  const ttsResult = await provider.tts(ttsModel).synthesize({
    text: env('NIMI_BYTEDANCE_TTS_TEXT', 'Hello from Bytedance OpenSpeech example.'),
  });
  const first = ttsResult.artifacts[0]?.bytes;
  if (!first) {
    throw new Error('bytedance tts returned empty audio');
  }
  const output = await saveBytes(env('NIMI_BYTEDANCE_TTS_OUT', './tmp/bytedance-tts.mp3'), first);
  print(`[bytedance-openspeech][tts] saved: ${output}`);

  const sttAudioPath = env('NIMI_BYTEDANCE_STT_AUDIO_PATH');
  if (!sttAudioPath) {
    print('[bytedance-openspeech][stt] skipped: set NIMI_BYTEDANCE_STT_AUDIO_PATH to run transcription');
    return;
  }

  const audioBytes = await readFile(sttAudioPath);
  const transport = env('NIMI_BYTEDANCE_STT_TRANSPORT', 'rest').toLowerCase();
  const sttResult = await provider.stt(sttModel).transcribe({
    audioBytes: new Uint8Array(audioBytes),
    mimeType: env('NIMI_BYTEDANCE_STT_MIME', 'audio/wav'),
    providerOptions: {
      transport,
    },
  });
  print(`[bytedance-openspeech][stt] text: ${sttResult.text}`);
}

await mainWithErrorGuard(run);
