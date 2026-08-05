/**
 * Hello Nimi - generate text with minimal setup.
 * Prerequisites: `nimi start` and a text.generate capability intent for this App.
 * Run: npx tsx examples/sdk/01-hello.ts
 */

import { createExampleClient, createExampleTextModel, generateExampleText } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.hello',
});
const textGeneration = createExampleTextModel(client);

const result = await generateExampleText(textGeneration, 'What is Nimi in one sentence?');

process.stdout.write(`${result.text}\n`);
