/**
 * Vercel AI SDK v6 Integration
 *
 * Run: npx tsx examples/ai-provider.ts
 */

import { Runtime } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { embed, generateText, streamText } from 'ai';

const APP_ID = 'example.ai-provider';

const runtime = new Runtime({
  appId: APP_ID,
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const nimi = createNimiAiProvider({
  runtime,
  appId: APP_ID,
  subjectUserId: 'local-user',
  routePolicy: 'local-runtime',
  fallback: 'deny',
});

async function textGeneration() {
  const { text, usage, finishReason } = await generateText({
    model: nimi.text('local/qwen2.5'),
    prompt: 'Explain Nimi in 3 short sentences.',
    maxOutputTokens: 256,
  });

  console.log('Text:', text);
  console.log('Usage:', usage);
  console.log('Finish:', finishReason);
}

async function textStreaming() {
  const result = streamText({
    model: nimi.text('local/qwen2.5'),
    prompt: 'Write a short poem about AI agents.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  console.log();
}

async function embeddingExample() {
  const { embedding } = await embed({
    model: nimi.embedding('local/text-embedding-3-small'),
    value: 'The Nimi platform enables AI-native open worlds.',
  });

  console.log('Embedding dimensions:', embedding.length);
  console.log('First 5 values:', embedding.slice(0, 5));
}

async function imageGenerationViaRuntime() {
  const stream = await runtime.media.image.stream(
    {
      model: 'local/sd1.5',
      subjectUserId: 'local-user',
      prompt: 'A digital painting of an AI agent in a virtual world',
      route: 'local-runtime',
      fallback: 'deny',
      timeoutMs: 120000,
    },
  );

  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.chunk.length;
    if (chunk.eof) {
      console.log('Image generated:', chunk.artifactId, chunk.mimeType, totalBytes);
    }
  }
}

async function routePolicySwitch() {
  const cloudProvider = createNimiAiProvider({
    runtime,
    appId: APP_ID,
    subjectUserId: 'local-user',
    routePolicy: 'token-api',
    fallback: 'deny',
  });

  const { text } = await generateText({
    model: cloudProvider.text('cloud/gpt-4o-mini'),
    prompt: 'Hello from the cloud route.',
  });

  console.log('[cloud]', text);
}

async function main() {
  await textGeneration();
  await textStreaming();
  await embeddingExample();

  // Uncomment if corresponding models/routes are available:
  // await imageGenerationViaRuntime();
  // await routePolicySwitch();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
