/**
 * Explicit runtime configuration plus Vercel AI SDK integration.
 * Run: npx tsx examples/sdk/advanced/custom-runtime.ts
 */

import { generateText } from 'ai';

import { createPlatformClient } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';

const { runtime } = await createPlatformClient({
  appId: 'example.custom-runtime',
  runtimeTransport: {
    type: 'node-grpc',
    endpoint: process.env.NIMI_RUNTIME_ENDPOINT || '127.0.0.1:46371',
  },
  subjectUserIdProvider: () => 'local-user',
});

const nimi = createNimiAiProvider({
  runtime,
  routePolicy: 'cloud',
});

const { text } = await generateText({
  model: nimi.text('gemini/default'),
  prompt: 'Show the explicit Runtime + provider path in one sentence.',
});

console.log(text);
