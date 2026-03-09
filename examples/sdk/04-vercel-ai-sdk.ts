/**
 * Use Nimi through the Vercel AI SDK.
 * Prerequisites: `nimi start` and provider availability for `gemini/default`.
 * Run: npx tsx examples/sdk/04-vercel-ai-sdk.ts
 */

import { generateText } from 'ai';

import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();
const nimi = createNimiAiProvider({ runtime });

const { text } = await generateText({
  model: nimi.text('gemini/default'),
  prompt: 'Hello from Vercel AI SDK + Nimi',
});

console.log(text);
