/**
 * LiteLLM Tutorial (chat + embedding + optional image) via nimi-sdk + runtime
 *
 * 1) Start runtime with LiteLLM backend:
 *    cd runtime
 *    NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL=https://your-litellm-endpoint \
 *    NIMI_RUNTIME_CLOUD_LITELLM_API_KEY=sk-xxx \
 *    go run ./cmd/nimi serve
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.litellm
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_LITELLM_TEXT_MODEL=litellm/gpt-4o-mini
 *    export NIMI_LITELLM_EMBED_MODEL=litellm/text-embedding-3-small
 *    export NIMI_LITELLM_IMAGE_MODEL=litellm/gpt-image-1   # optional
 *    export NIMI_LITELLM_IMAGE_OUT=./tmp/litellm-image.png
 *
 * 3) Run:
 *    npx tsx docs/examples/providers/litellm.ts
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
  const appId = env('NIMI_APP_ID', 'example.providers.litellm');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const textModel = env('NIMI_LITELLM_TEXT_MODEL', 'litellm/gpt-4o-mini');
  const embedModel = env('NIMI_LITELLM_EMBED_MODEL', 'litellm/text-embedding-3-small');
  const imageModel = env('NIMI_LITELLM_IMAGE_MODEL');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'token-api',
  });

  print(`[litellm] runtime grpc endpoint: ${endpoint}`);

  const textResult = await provider.text(textModel).doGenerate({
    prompt: [{
      role: 'user',
      content: [{ type: 'text', text: 'Summarize why runtime routing matters in 2 lines.' }],
    }],
    providerOptions: {},
  });
  print(`[litellm][chat] ${firstTextFromGenerateContent(textResult.content)}`);

  const embedResult = await provider.embedding(embedModel).doEmbed({
    values: ['Nimi runtime cloud route demo'],
    providerOptions: {},
  });
  const dims = embedResult.embeddings[0]?.length || 0;
  print(`[litellm][embedding] dims: ${dims}`);

  if (imageModel) {
    const imageResult = await provider.image(imageModel).doGenerate({
      prompt: env('NIMI_LITELLM_IMAGE_PROMPT', 'An abstract futuristic control room, high detail'),
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
      throw new Error('litellm image generation returned empty result');
    }
    const output = await saveBase64(env('NIMI_LITELLM_IMAGE_OUT', './tmp/litellm-image.png'), base64);
    print(`[litellm][image] saved: ${output}`);
  } else {
    print('[litellm][image] skipped: set NIMI_LITELLM_IMAGE_MODEL to run image demo');
  }
}

await mainWithErrorGuard(run);
