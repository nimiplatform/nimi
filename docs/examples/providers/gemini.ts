/**
 * Gemini Tutorial (image + video) via nimi-sdk + runtime
 *
 * 1) Start runtime with Gemini adapter:
 *    cd runtime
 *    NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL=https://your-gemini-endpoint \
 *    NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=xxx \
 *    go run ./cmd/nimi serve
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.gemini
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_GEMINI_IMAGE_MODEL=gemini/imagen-3
 *    export NIMI_GEMINI_VIDEO_MODEL=gemini/veo-3
 *    export NIMI_GEMINI_IMAGE_OUT=./tmp/gemini-image.png
 *    export NIMI_GEMINI_VIDEO_OUT=./tmp/gemini-video.mp4
 *
 * 3) Run:
 *    npx tsx docs/examples/providers/gemini.ts
 */

import {
  createProviderContext,
  env,
  mainWithErrorGuard,
  print,
  saveBase64,
  saveBytes,
} from './_common.js';

async function run(): Promise<void> {
  const appId = env('NIMI_APP_ID', 'example.providers.gemini');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const imageModel = env('NIMI_GEMINI_IMAGE_MODEL', 'gemini/imagen-3');
  const videoModel = env('NIMI_GEMINI_VIDEO_MODEL', 'gemini/veo-3');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'token-api',
    timeoutMs: 300_000,
  });

  print(`[gemini] runtime grpc endpoint: ${endpoint}`);

  const imageResult = await provider.image(imageModel).doGenerate({
    prompt: env('NIMI_GEMINI_IMAGE_PROMPT', 'A clean futuristic workspace, photorealistic'),
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
    throw new Error('gemini image generation returned empty result');
  }
  const imageOut = await saveBase64(env('NIMI_GEMINI_IMAGE_OUT', './tmp/gemini-image.png'), imageBase64);
  print(`[gemini][image] saved: ${imageOut}`);

  const videoResult = await provider.video(videoModel).generate({
    prompt: env('NIMI_GEMINI_VIDEO_PROMPT', 'A drone fly-through of a neon city at dawn'),
    durationSec: Number(env('NIMI_GEMINI_VIDEO_DURATION_SEC', '6')),
    fps: Number(env('NIMI_GEMINI_VIDEO_FPS', '24')),
    providerOptions: {},
  });
  const videoBytes = videoResult.artifacts[0]?.bytes;
  if (!videoBytes) {
    throw new Error('gemini video generation returned empty artifact');
  }
  const videoOut = await saveBytes(env('NIMI_GEMINI_VIDEO_OUT', './tmp/gemini-video.mp4'), videoBytes);
  print(`[gemini][video] saved: ${videoOut}`);
}

await mainWithErrorGuard(run);
