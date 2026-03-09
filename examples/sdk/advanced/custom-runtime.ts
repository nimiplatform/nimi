/**
 * Explicit runtime configuration plus Vercel AI SDK integration.
 * Run: npx tsx examples/sdk/advanced/custom-runtime.ts
 */

import { generateText } from 'ai';

import { Runtime } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';

const runtime = new Runtime({
  appId: 'example.custom-runtime',
  transport: {
    type: 'node-grpc',
    endpoint: process.env.NIMI_RUNTIME_ENDPOINT || '127.0.0.1:46371',
  },
  subjectContext: {
    subjectUserId: 'local-user',
  },
});

const nimi = createNimiAiProvider({
  runtime,
  routePolicy: 'cloud',
  fallback: 'deny',
});

const { text } = await generateText({
  model: nimi.text('gemini/default'),
  prompt: 'Show the explicit Runtime + provider path in one sentence.',
});

console.log(text);
