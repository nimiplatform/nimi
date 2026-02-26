/**
 * Vercel AI SDK v6 Integration
 *
 * Run: npx tsx docs/examples/ai-provider.ts
 */

import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { embed, generateText, streamText } from 'ai';
import { FallbackPolicy, RoutePolicy } from '@nimiplatform/sdk/runtime';

const APP_ID = 'example.ai-provider';

const client = createNimiClient({
  appId: APP_ID,
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const nimi = createNimiAiProvider({
  runtime: client.runtime!,
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
  const stream = await client.runtime!.ai.generateImage(
    {
      appId: APP_ID,
      subjectUserId: 'local-user',
      modelId: 'local/sd1.5',
      prompt: 'A digital painting of an AI agent in a virtual world',
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
      console.log('Image generated:', chunk.artifactId, chunk.mimeType, totalBytes);
    }
  }
}

async function routePolicySwitch() {
  const cloudProvider = createNimiAiProvider({
    runtime: client.runtime!,
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
