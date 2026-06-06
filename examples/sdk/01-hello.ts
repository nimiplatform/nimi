/**
 * Hello Nimi - generate text with minimal setup.
 * Prerequisites: `nimi start` running and the local default text model available.
 * Tip: run `nimi run "What is Nimi?"` once to prime the local default path.
 * Run: npx tsx examples/sdk/01-hello.ts
 */

import { createExampleClient, createExampleTextModel, generateExampleText } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.hello',
});
const model = createExampleTextModel(client);

const result = await generateExampleText(model, 'What is Nimi in one sentence?');

console.log(result.text);
