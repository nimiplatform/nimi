/**
 * NimiLLM Tutorial (chat + embedding + optional image) via nimi-sdk + runtime
 *
 * 1) Start runtime with NimiLLM backend:
 *    NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL=https://your-nimillm-endpoint \
 *    NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY=sk-xxx \
 *    nimi start
 *
 * 2) Optional env in this shell:
 *    export NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 *    export NIMI_APP_ID=example.providers.nimillm
 *    export NIMI_SUBJECT_USER_ID=local-user
 *    export NIMI_NIMILLM_TEXT_MODEL=nimillm/gpt-4o-mini
 *    export NIMI_NIMILLM_EMBED_MODEL=nimillm/text-embedding-3-small
 *    export NIMI_NIMILLM_IMAGE_MODEL=nimillm/gpt-image-1   # optional
 *    export NIMI_NIMILLM_IMAGE_OUT=./tmp/nimillm-image.png
 *
 * 3) Run:
 *    npx tsx examples/sdk/providers/nimillm.ts
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
  const appId = env('NIMI_APP_ID', 'example.providers.nimillm');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const textModel = env('NIMI_NIMILLM_TEXT_MODEL', 'nimillm/gpt-4o-mini');
  const embedModel = env('NIMI_NIMILLM_EMBED_MODEL', 'nimillm/text-embedding-3-small');
  const imageModel = env('NIMI_NIMILLM_IMAGE_MODEL');

  const { endpoint, provider } = createProviderContext({
    appId,
    subjectUserId,
    routePolicy: 'cloud',
  });

  print(`[nimillm] runtime grpc endpoint: ${endpoint}`);

  const textResult = await provider.text(textModel).doGenerate({
    prompt: [{
      role: 'user',
      content: [{ type: 'text', text: 'Summarize why runtime routing matters in 2 lines.' }],
    }],
    providerOptions: {},
  });
  print(`[nimillm][chat] ${firstTextFromGenerateContent(textResult.content)}`);

  const embedResult = await provider.embedding(embedModel).doEmbed({
    values: ['Nimi runtime cloud route demo'],
    providerOptions: {},
  });
  const dims = embedResult.embeddings[0]?.length || 0;
  print(`[nimillm][embedding] dims: ${dims}`);

  if (imageModel) {
    const imageResult = await provider.image(imageModel).doGenerate({
      prompt: env('NIMI_NIMILLM_IMAGE_PROMPT', 'An abstract futuristic control room, high detail'),
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
      throw new Error('nimillm image generation returned empty result');
    }
    const output = await saveBase64(env('NIMI_NIMILLM_IMAGE_OUT', './tmp/nimillm-image.png'), base64);
    print(`[nimillm][image] saved: ${output}`);
  } else {
    print('[nimillm][image] skipped: set NIMI_NIMILLM_IMAGE_MODEL to run image demo');
  }
}

await mainWithErrorGuard(run);
