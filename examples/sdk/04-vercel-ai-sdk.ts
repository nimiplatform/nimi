/**
 * Use Nimi through the Vercel AI SDK.
 * Prerequisites: `nimi start` and a text.generate capability intent for this App.
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
  subjectUserId: 'local-user',
  timeoutMs: 120_000,
});

const { text } = await generateText({
  model: nimi.languageModel('text.generate'),
  prompt: 'Hello from Vercel AI SDK + Nimi',
});

process.stdout.write(`${text}\n`);
