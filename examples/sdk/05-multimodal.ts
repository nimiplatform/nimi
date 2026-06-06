/**
 * Generate an image and a TTS clip through Runtime Scenario jobs.
 * Prerequisites: `nimi start` and the referenced local multimodal models installed.
 * Run: npx tsx examples/sdk/05-multimodal.ts
 */

import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { VoiceReferenceKind } from '@nimiplatform/sdk/runtime/generated';
import {
  createNimiImageGenerationScenario,
  createNimiSpeechSynthesisScenario,
  type NimiGenerationArtifact,
  type NimiGenerationJob,
  type NimiRuntimeGenerationSurface,
} from '@nimiplatform/sdk/features/generation';

import { createExampleClient } from './_vnext.js';

const client = createExampleClient({
  appId: 'example.sdk.multimodal',
});

function generationClient(modelId: string, timeoutMs: number): NimiRuntimeGenerationSurface {
  return client.features.generation.createRuntimeClient({
    head: {
      subjectUserId: 'local-user',
      modelId,
      routePolicy: 'local',
      timeoutMs,
    },
  });
}

async function waitForTerminalJob(
  generation: NimiRuntimeGenerationSurface,
  job: NimiGenerationJob,
): Promise<NimiGenerationJob> {
  let current = job;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (['completed', 'failed', 'cancelled', 'timeout'].includes(current.status)) {
      return current;
    }
    await sleep(1_000);
    current = await generation.get(current.id);
  }
  throw new Error(`generation job did not finish before timeout: ${job.id}`);
}

async function readArtifactBytes(
  generation: NimiRuntimeGenerationSurface,
  artifact: NimiGenerationArtifact,
): Promise<Uint8Array> {
  if (artifact.bytes && artifact.bytes.length > 0) {
    return artifact.bytes;
  }
  const response = await generation.readArtifactBytes(artifact.id);
  return response.bytes;
}

async function saveFirstArtifact(
  generation: NimiRuntimeGenerationSurface,
  job: NimiGenerationJob,
  outputPath: string,
): Promise<void> {
  const artifacts = job.artifacts.length > 0
    ? job.artifacts
    : await generation.artifacts(job.id);
  const artifact = artifacts[0];
  if (!artifact) {
    throw new Error(`generation job produced no artifacts: ${job.id}`);
  }
  const bytes = await readArtifactBytes(generation, artifact);
  await writeFile(outputPath, Buffer.from(bytes));
  console.log(`saved ${outputPath} (${artifact.mimeType || 'application/octet-stream'})`);
}

async function saveImage() {
  const generation = generationClient('local/sd1.5', 120_000);
  const submitted = await generation.submit({
    scenario: createNimiImageGenerationScenario({
      kind: 'image',
      prompt: 'A bold launch poster for Nimi',
    }),
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const completed = await waitForTerminalJob(generation, submitted);
  if (completed.status !== 'completed') {
    throw new Error(`image generation failed: ${completed.error || completed.status}`);
  }
  await saveFirstArtifact(generation, completed, 'nimi-image.png');
}

async function saveSpeech() {
  const generation = generationClient('local/tts-default', 45_000);
  const submitted = await generation.submit({
    scenario: createNimiSpeechSynthesisScenario({
      kind: 'speech-synthesize',
      text: 'Hello from the Nimi runtime.',
      voiceRef: {
        kind: VoiceReferenceKind.PRESET,
        reference: {
          oneofKind: 'presetVoiceId',
          presetVoiceId: 'default',
        },
      },
      audioFormat: 'wav',
      timingMode: 'none',
    }),
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
  });
  const completed = await waitForTerminalJob(generation, submitted);
  if (completed.status !== 'completed') {
    throw new Error(`speech generation failed: ${completed.error || completed.status}`);
  }
  await saveFirstArtifact(generation, completed, 'nimi-audio.wav');
}

await saveImage();
await saveSpeech();
