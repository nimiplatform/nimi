/**
 * Local llama + media engine Tutorial (chat + image) via nimi-sdk + runtime
 *
 * 1) Start runtime with local llama engine backend:
 *    NIMI_RUNTIME_LOCAL_AI_BASE_URL=http://127.0.0.1:1234 \
 *    NIMI_RUNTIME_LOCAL_AI_API_KEY=<optional> \
 *    nimi start
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.local-llama
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_LOCAL_TEXT_MODEL=llama/qwen2.5
 *    export NIMI_LOCAL_IMAGE_MODEL=media/sd3
 *    export NIMI_LOCAL_IMAGE_OUT=./tmp/local-llama-image.png
 *
 * 3) Run:
 *    npx tsx examples/sdk/providers/local-llama.ts
 */

import {
  createProviderContext,
  env,
  firstTextFromGenerateContent,
  mainWithErrorGuard,
  print,
  saveBase64,
} from './_common.js';

async function run(): Promise<void> {
  const appId = env('NIMI_APP_ID', 'example.providers.local-llama');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const textModel = env('NIMI_LOCAL_TEXT_MODEL', 'llama/qwen2.5');
  const imageModel = env('NIMI_LOCAL_IMAGE_MODEL', 'media/sd3');
  const imageOut = env('NIMI_LOCAL_IMAGE_OUT', './tmp/local-llama-image.png');

  const textPrompt = env('NIMI_LOCAL_TEXT_PROMPT', '用两句话介绍 Nimi runtime 的作用。');
  const imagePrompt = env('NIMI_LOCAL_IMAGE_PROMPT', 'A cinematic city skyline at sunset, digital art');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'local',
  });

  print(`[local-llama] runtime grpc endpoint: ${endpoint}`);
  print(`[local-llama] text model: ${textModel}`);

  const textResult = await provider.text(textModel).doGenerate({
    prompt: [{
      role: 'user',
      content: [{ type: 'text', text: textPrompt }],
    }],
    providerOptions: {},
  });

  const text = firstTextFromGenerateContent(textResult.content);
  print(`[local-llama][chat] ${text}`);

  const imageResult = await provider.image(imageModel).doGenerate({
    prompt: imagePrompt,
    n: 1,
    size: undefined,
    aspectRatio: undefined,
    seed: undefined,
    files: undefined,
    mask: undefined,
    providerOptions: {},
  });

  const base64 = imageResult.images[0] || '';
  if (!base64) {
    throw new Error('local media engine image generation returned empty result');
  }

  const path = await saveBase64(imageOut, base64);
  print(`[local-llama][image] saved: ${path}`);
}

await mainWithErrorGuard(run);
