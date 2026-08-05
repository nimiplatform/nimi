/**
 * Stream a response token by token.
 * Prerequisites: `nimi start` and a text.generate capability intent for this App.
 * Run: npx tsx examples/sdk/02-streaming.ts
 */

import { createExampleClient, createExampleTextModel, streamExampleText } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.streaming',
});
const textGeneration = createExampleTextModel(client);
const stream = await streamExampleText(textGeneration, 'Write a haiku about AI runtimes.');

for await (const event of stream) {
  if (event.type === 'text-delta') {
    process.stdout.write(event.text);
  }
}

process.stdout.write('\n');
