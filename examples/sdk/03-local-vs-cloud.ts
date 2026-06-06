/**
 * Switch between local and cloud with the same app code.
 * Prerequisites: `nimi start`, the local default text model, and provider credentials for `gemini`.
 * Run: npx tsx examples/sdk/03-local-vs-cloud.ts
 */

import { createExampleClient, createExampleTextModel, generateExampleText } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.local-vs-cloud',
});
const prompt = 'Explain why one runtime for local and cloud AI is useful.';

for (const [label, input] of [
  ['local', { modelId: 'default', routePolicy: 'local' }],
  ['cloud:gemini', { modelId: 'gemini/default', providerId: 'gemini', routePolicy: 'cloud' }],
] as const) {
  try {
    const model = createExampleTextModel(client, input);
    const result = await generateExampleText(model, prompt);
    console.log(`[${label}] ${result.text}`);
  } catch (error) {
    console.error(`[${label}]`, error);
  }
}
