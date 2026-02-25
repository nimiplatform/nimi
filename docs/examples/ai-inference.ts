/**
 * AI Inference Examples
 *
 * Run: npx tsx docs/examples/ai-inference.ts
 */

import { createNimiClient } from '@nimiplatform/sdk';
import {
  FallbackPolicy,
  Modal,
  RoutePolicy,
} from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.ai';

const client = createNimiClient({
  appId: APP_ID,
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const runtime = client.runtime!;

async function textGenerate() {
  const result = await runtime.ai.generate(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/qwen2.5',
      modal: Modal.TEXT,
      input: [{ role: 'user', name: 'user', content: 'Explain Nimi in one sentence.' }],
      systemPrompt: '',
      tools: [],
      temperature: 0.4,
      topP: 1,
      maxTokens: 128,
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 20000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('[text] trace:', result.traceId);
  console.log('[text] output:', JSON.stringify(result.output, null, 2));
}

async function embedding() {
  const result = await runtime.ai.embed(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/text-embedding-3-small',
      inputs: ['The quick brown fox jumps over the lazy dog'],
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 20000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('[embedding] vector count:', result.vectors.length);
}

async function imageGenerate() {
  const stream = await runtime.ai.generateImage(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/sd1.5',
      prompt: 'A futuristic city skyline at sunset',
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 120000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('[image] artifact:', chunk.artifactId, 'mime:', chunk.mimeType, 'bytes:', totalBytes);
    }
  }
}

async function videoGenerate() {
  const stream = await runtime.ai.generateVideo(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/video-default',
      prompt: 'A cat playing piano',
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 300000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('[video] artifact:', chunk.artifactId, 'mime:', chunk.mimeType, 'bytes:', totalBytes);
    }
  }
}

async function synthesizeSpeech() {
  const stream = await runtime.ai.synthesizeSpeech(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/tts-default',
      text: 'Hello from Nimi runtime.',
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 45000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('[tts] artifact:', chunk.artifactId, 'mime:', chunk.mimeType, 'bytes:', totalBytes);
    }
  }
}

async function transcribeAudio() {
  const result = await runtime.ai.transcribeAudio(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/whisper-1',
      audioBytes: new Uint8Array(),
      mimeType: 'audio/wav',
      routePolicy: RoutePolicy.LOCAL_RUNTIME,
      fallback: FallbackPolicy.DENY,
      timeoutMs: 90000,
    },
    { idempotencyKey: crypto.randomUUID() },
  );

  console.log('[stt] text:', result.text);
}

async function main() {
  await textGenerate();
  await embedding();

  // Uncomment when corresponding models are available:
  // await imageGenerate();
  // await videoGenerate();
  // await synthesizeSpeech();
  // await transcribeAudio();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
