/**
 * AI Inference Examples
 *
 * Run: npx tsx examples/sdk/ai-inference.ts
 */

import { Runtime } from '@nimiplatform/sdk';

const APP_ID = 'example.ai';

const runtime = new Runtime({
  appId: APP_ID,
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

async function textGenerate() {
  const result = await runtime.ai.text.generate({
    model: 'local/qwen2.5',
    subjectUserId: 'local-user',
    input: 'Explain Nimi in one sentence.',
    temperature: 0.4,
    maxTokens: 128,
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 20000,
  });

  console.log('[text] trace:', result.trace.traceId || '(none)');
  console.log('[text] output:', result.text);
}

async function embedding() {
  const result = await runtime.ai.embedding.generate({
    model: 'local/text-embedding-3-small',
    subjectUserId: 'local-user',
    input: ['The quick brown fox jumps over the lazy dog'],
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 20000,
  });

  console.log('[embedding] vector count:', result.vectors.length);
}

async function imageGenerate() {
  const stream = await runtime.media.image.stream({
    model: 'local/sd1.5',
    subjectUserId: 'local-user',
    prompt: 'A futuristic city skyline at sunset',
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 120000,
  });

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('[image] artifact:', chunk.artifactId, 'mime:', chunk.mimeType, 'bytes:', totalBytes);
    }
  }
}

async function videoGenerate() {
  const stream = await runtime.media.video.stream({
    model: 'local/video-default',
    subjectUserId: 'local-user',
    prompt: 'A cat playing piano',
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 300000,
  });

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('[video] artifact:', chunk.artifactId, 'mime:', chunk.mimeType, 'bytes:', totalBytes);
    }
  }
}

async function synthesizeSpeech() {
  const stream = await runtime.media.tts.stream({
    model: 'local/tts-default',
    subjectUserId: 'local-user',
    text: 'Hello from Nimi runtime.',
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 45000,
  });

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('[tts] artifact:', chunk.artifactId, 'mime:', chunk.mimeType, 'bytes:', totalBytes);
    }
  }
}

async function transcribeAudio() {
  const result = await runtime.media.stt.transcribe({
    model: 'local/whisper-1',
    subjectUserId: 'local-user',
    audio: { kind: 'bytes', bytes: new Uint8Array() },
    mimeType: 'audio/wav',
    route: 'local-runtime',
    fallback: 'deny',
    timeoutMs: 90000,
  });

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
