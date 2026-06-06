/**
 * Stream a response token by token.
 * Prerequisites: `nimi start` running and the local default text model available.
 * Tip: run `nimi run "Write a haiku about AI runtimes."` once to prime the local default path.
 * Run: npx tsx examples/sdk/02-streaming.ts
 */

import { createExampleClient, createExampleTextModel, streamExampleText } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.streaming',
});
const model = createExampleTextModel(client);
const stream = await streamExampleText(model, 'Write a haiku about AI runtimes.');

for await (const event of stream) {
  if (event.type === 'text-delta') {
    process.stdout.write(event.text);
  }
}

process.stdout.write('\n');
