/**
 * Use Nimi through the Vercel AI SDK.
 * Prerequisites: `nimi start` and provider availability for `gemini/default`.
 * Run: npx tsx examples/sdk/04-vercel-ai-sdk.ts
 */

import { generateText } from 'ai';

import { createNimiVercelProvider } from '@nimiplatform/sdk-adapter-vercel-ai';

import { createExampleClient } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.vercel-ai',
});

const nimi = createNimiVercelProvider({
  client,
  routePolicy: 'cloud',
  subjectUserId: 'local-user',
  timeoutMs: 120_000,
});

const { text } = await generateText({
  model: nimi.languageModel(process.env.NIMI_VERCEL_AI_MODEL || 'gemini/default'),
  prompt: 'Hello from Vercel AI SDK + Nimi',
});

console.log(text);
