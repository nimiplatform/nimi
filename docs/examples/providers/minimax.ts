/**
 * MiniMax Tutorial (image + video) via nimi-sdk + runtime
 *
 * 1) Start runtime with MiniMax adapter:
 *    cd runtime
 *    NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_BASE_URL=https://your-minimax-endpoint \
 *    NIMI_RUNTIME_CLOUD_ADAPTER_MINIMAX_API_KEY=xxx \
 *    go run ./cmd/nimi serve
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.minimax
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_MINIMAX_IMAGE_MODEL=minimax/image-1
 *    export NIMI_MINIMAX_VIDEO_MODEL=minimax/video-1
 *    export NIMI_MINIMAX_IMAGE_OUT=./tmp/minimax-image.png
 *    export NIMI_MINIMAX_VIDEO_OUT=./tmp/minimax-video.mp4
 *
 * 3) Run:
 *    npx tsx docs/examples/providers/minimax.ts
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
  const appId = env('NIMI_APP_ID', 'example.providers.minimax');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const imageModel = env('NIMI_MINIMAX_IMAGE_MODEL', 'minimax/image-1');
  const videoModel = env('NIMI_MINIMAX_VIDEO_MODEL', 'minimax/video-1');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'token-api',
    timeoutMs: 300_000,
  });

  print(`[minimax] runtime grpc endpoint: ${endpoint}`);

  const imageResult = await provider.image(imageModel).doGenerate({
    prompt: env('NIMI_MINIMAX_IMAGE_PROMPT', 'A cinematic forest scene at dusk'),
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
    throw new Error('minimax image generation returned empty result');
  }
  const imageOut = await saveBase64(env('NIMI_MINIMAX_IMAGE_OUT', './tmp/minimax-image.png'), imageBase64);
  print(`[minimax][image] saved: ${imageOut}`);

  const videoResult = await provider.video(videoModel).generate({
    prompt: env('NIMI_MINIMAX_VIDEO_PROMPT', 'Ocean sunset with gentle camera motion'),
    providerOptions: {},
  });
  const videoBytes = videoResult.artifacts[0]?.bytes;
  if (!videoBytes) {
    throw new Error('minimax video generation returned empty artifact');
  }
  const videoOut = await saveBytes(env('NIMI_MINIMAX_VIDEO_OUT', './tmp/minimax-video.mp4'), videoBytes);
  print(`[minimax][video] saved: ${videoOut}`);
}

await mainWithErrorGuard(run);
