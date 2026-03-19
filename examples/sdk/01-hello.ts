/**
 * Hello Nimi - generate text with minimal setup.
 * Prerequisites: `nimi start` running and the local default text model available.
 * Tip: run `nimi run "What is Nimi?"` once to prime the local default path.
 * Run: npx tsx examples/sdk/01-hello.ts
 */

import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'example.sdk.hello',
});

const result = await runtime.generate({
  prompt: 'What is Nimi in one sentence?',
});

console.log(result.text);
