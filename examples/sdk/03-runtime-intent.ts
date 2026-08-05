/**
 * Run text generation with the Local or Cloud capability intent already saved
 * for this App. The request is identical for both intents; Runtime chooses the
 * implementation when execution starts.
 *
 * Prerequisites: `nimi start` and a text.generate capability intent for
 * `example.sdk.runtime-intent`.
 * Run: npx tsx examples/sdk/03-runtime-intent.ts
 */

import { createExampleClient, createExampleTextModel, generateExampleText } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.runtime-intent',
});
const textGeneration = createExampleTextModel(client);
const result = await generateExampleText(
  textGeneration,
  'Explain why Runtime-owned implementation selection is useful.',
);

process.stdout.write(`${result.text}\n`);
