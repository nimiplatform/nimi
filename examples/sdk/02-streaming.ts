/**
 * Stream a response token by token.
 * Prerequisites: `nimi start` running and the local default text model available.
 * Tip: run `nimi run "Write a haiku about AI runtimes."` once to prime the local default path.
 * Run: npx tsx examples/sdk/02-streaming.ts
 */

import { Runtime } from '@nimiplatform/sdk/runtime';

const runtime = new Runtime();
const stream = await runtime.stream({
  prompt: 'Write a haiku about AI runtimes.',
});

for await (const chunk of stream) {
  if (chunk.type === 'text') {
    process.stdout.write(chunk.text);
  }
}

process.stdout.write('\n');
