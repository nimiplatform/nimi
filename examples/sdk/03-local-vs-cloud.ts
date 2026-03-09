/**
 * Switch between local and cloud with the same app code.
 * Prerequisites: `nimi start`, the local default text model, and provider credentials for `gemini`.
 * Run: npx tsx examples/sdk/03-local-vs-cloud.ts
 */

import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();
const prompt = 'Explain why one runtime for local and cloud AI is useful.';

for (const [label, input] of [
  ['local', { prompt }],
  ['cloud:gemini', { provider: 'gemini', prompt }],
] as const) {
  try {
    const result = await runtime.generate(input);
    console.log(`[${label}] ${result.text}`);
  } catch (error) {
    console.error(`[${label}]`, error);
  }
}
