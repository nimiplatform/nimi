/**
 * Explicit runtime configuration plus Vercel AI SDK integration.
 * Run: npx tsx examples/sdk/advanced/custom-runtime.ts
 */

import { generateText } from 'ai';

import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiVercelProvider } from '@nimiplatform/sdk-adapter-vercel-ai';

const client = createNimiClient({
  appId: 'example.custom-runtime',
  runtime: {
    transport: {
      type: 'node-grpc',
      endpoint: process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371',
    },
  },
});

const nimi = createNimiVercelProvider({
  client,
  routePolicy: 'cloud',
  subjectUserId: 'local-user',
  timeoutMs: 120_000,
});

const { text } = await generateText({
  model: nimi.languageModel(process.env.NIMI_VERCEL_AI_MODEL || 'gemini/default'),
  prompt: 'Show the explicit Runtime + provider path in one sentence.',
});

console.log(text);
