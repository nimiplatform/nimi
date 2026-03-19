/**
 * Generate an image and a TTS clip through the runtime.
 * Prerequisites: `nimi start` and the referenced local multimodal models installed.
 * Run: npx tsx examples/sdk/05-multimodal.ts
 */

import { writeFile } from 'node:fs/promises';

import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'example.sdk.multimodal',
});

async function saveImage() {
  const chunks: Uint8Array[] = [];
  const stream = await runtime.media.image.stream({
    model: 'local/sd1.5',
    prompt: 'A bold launch poster for Nimi',
    subjectUserId: 'local-user',
    route: 'local',
    fallback: 'deny',
    timeoutMs: 120000,
  });

  for await (const chunk of stream) {
    chunks.push(chunk.chunk);
    if (chunk.eof) {
      await writeFile('nimi-image.png', Buffer.concat(chunks.map((part) => Buffer.from(part))));
      console.log(`saved nimi-image.png (${chunk.mimeType})`);
    }
  }
}

async function saveSpeech() {
  const chunks: Uint8Array[] = [];
  const stream = await runtime.media.tts.stream({
    model: 'local/tts-default',
    text: 'Hello from the Nimi runtime.',
    subjectUserId: 'local-user',
    route: 'local',
    fallback: 'deny',
    timeoutMs: 45000,
  });

  for await (const chunk of stream) {
    chunks.push(chunk.chunk);
    if (chunk.eof) {
      await writeFile('nimi-audio.wav', Buffer.concat(chunks.map((part) => Buffer.from(part))));
      console.log(`saved nimi-audio.wav (${chunk.mimeType})`);
    }
  }
}

await saveImage();
await saveSpeech();
