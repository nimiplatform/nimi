/**
 * Vercel AI SDK 6 in a Nimi App.
 *
 * The adapter is the separate `@nimiplatform/sdk-adapter-vercel-ai` package;
 * install a release whose `@nimiplatform/sdk` peer range covers the App's SDK.
 * The model receives the App's host-bound AI client, so Runtime still owns
 * routing and execution and the App keeps its tool callbacks.
 */

import { generateText } from 'ai';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import type { NimiLocalAppClient } from '@nimiplatform/sdk';

export async function summarize(client: NimiLocalAppClient, note: string): Promise<string> {
  const { text } = await generateText({
    model: createNimiLocalAppVercelLanguageModel({ ai: client.ai }),
    prompt: `Summarize this note in three points:\n\n${note}`,
  });
  return text;
}
