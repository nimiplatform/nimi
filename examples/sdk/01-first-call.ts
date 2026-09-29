/**
 * One text answer through the App's host-bound client.
 *
 * Pass the client from the App's generated `getNimiLocalAppClient()`. The App
 * declares `runtime.consume` and saves a `text.generate` intent; Runtime reads
 * that intent and selects the Local or Cloud implementation when the call runs.
 */

import type { NimiLocalAppClient } from '@nimiplatform/sdk';

export async function answer(client: NimiLocalAppClient, question: string): Promise<string> {
  const result = await client.ai.text.generateCandidate({
    messages: [{ role: 'user', text: question }],
  });
  return result.text;
}
