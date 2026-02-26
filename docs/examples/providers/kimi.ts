/**
 * Kimi Tutorial (chat-multimodal image generation) via nimi-sdk + runtime
 *
 * 1) Start runtime with Kimi adapter:
 *    cd runtime
 *    NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_BASE_URL=https://api.moonshot.cn \
 *    NIMI_RUNTIME_CLOUD_ADAPTER_KIMI_API_KEY=xxx \
 *    go run ./cmd/nimi serve
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.kimi
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_KIMI_IMAGE_MODEL=moonshot/moonshot-v1-vision
 *    export NIMI_KIMI_IMAGE_OUT=./tmp/kimi-image.png
 *    export NIMI_KIMI_REFERENCE_IMAGES=https://.../ref1.png,https://.../ref2.png
 *
 * 3) Run:
 *    npx tsx docs/examples/providers/kimi.ts
 */

import {
  createProviderContext,
  env,
  mainWithErrorGuard,
  print,
  saveBase64,
} from './_common.js';

function parseReferenceImages(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

async function run(): Promise<void> {
  const appId = env('NIMI_APP_ID', 'example.providers.kimi');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const model = env('NIMI_KIMI_IMAGE_MODEL', 'moonshot/moonshot-v1-vision');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'token-api',
  });

  print(`[kimi] runtime grpc endpoint: ${endpoint}`);

  const imageResult = await provider.image(model).doGenerate({
    prompt: env('NIMI_KIMI_IMAGE_PROMPT', 'Render a floating city with soft morning light.'),
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {
      nimi: {
        style_preset: env('NIMI_KIMI_STYLE_PRESET', 'anime'),
        reference_images: parseReferenceImages(env('NIMI_KIMI_REFERENCE_IMAGES')),
      },
    },
  });

  const base64 = imageResult.images[0] || '';
  if (!base64) {
    throw new Error('kimi image generation returned empty result');
  }

  const output = await saveBase64(env('NIMI_KIMI_IMAGE_OUT', './tmp/kimi-image.png'), base64);
  print(`[kimi][image] saved: ${output}`);
}

await mainWithErrorGuard(run);
