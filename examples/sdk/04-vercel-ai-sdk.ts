/**
 * Use Nimi through the Vercel AI SDK.
 * Prerequisites: `nimi start` and provider availability for `gemini/default`.
 * Run: npx tsx examples/sdk/04-vercel-ai-sdk.ts
 */

import { generateText } from 'ai';

import { createPlatformClient } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';

const { runtime } = await createPlatformClient({
  appId: 'example.sdk.vercel-ai',
});
const nimi = createNimiAiProvider({ runtime });

const { text } = await generateText({
  model: nimi.text('gemini/default'),
  prompt: 'Hello from Vercel AI SDK + Nimi',
});

console.log(text);
