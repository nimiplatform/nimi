import { z } from 'zod';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';
import {
  createAudioDirectUpload,
  finalizeResource,
} from './content-data-client.js';
import { batchUpsertWorldResourceBindings } from './world-data-client.js';

const agentCopyCompletionSchema = z.object({
  description: z.string().trim().min(1),
  scenario: z.string().trim().min(1),
  greeting: z.string().trim().min(1),
});

type AudioArtifactLike = {
  artifactId?: string;
  uri?: string;
  bytes?: Uint8Array;
  mimeType?: string;
};

export type AgentCopyCompletion = z.infer<typeof agentCopyCompletionSchema>;

export type StoredAudioArtifact = {
  resourceId: string;
  url: string;
  mimeType: string;
};

function requireAiBinding(capability: 'text' | 'tts') {
  const params = getResolvedAiParams(capability);
  if (!params.model) {
    throw new Error(`FORGE_ENRICHMENT_${capability.toUpperCase()}_MODEL_REQUIRED`);
  }
  return params;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    throw new Error('FORGE_AGENT_ENRICHMENT_JSON_REQUIRED');
  }
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    throw new Error('FORGE_AGENT_ENRICHMENT_JSON_INVALID');
  }
}

function toBlobFromBytes(bytes: Uint8Array, mimeType: string): Blob {
  const safeBytes = Uint8Array.from(bytes);
  return new Blob([safeBytes], { type: mimeType });
}

async function toAudioBlob(artifact: AudioArtifactLike): Promise<Blob> {
  const mimeType = artifact.mimeType || 'audio/mpeg';
  if (artifact.bytes && artifact.bytes.length > 0) {
    return toBlobFromBytes(artifact.bytes, mimeType);
  }
  if (artifact.uri) {
    const response = await fetch(artifact.uri);
    if (!response.ok) {
      throw new Error(`FORGE_ENRICHMENT_AUDIO_FETCH_FAILED:${response.status}`);
    }
    return response.blob();
  }
  throw new Error('FORGE_ENRICHMENT_AUDIO_ARTIFACT_MISSING');
}

async function uploadAudioBlob(blob: Blob, mimeType: string): Promise<StoredAudioArtifact> {
  const session = await createAudioDirectUpload({ mimeType });
  const record = session && typeof session === 'object' && !Array.isArray(session)
    ? session as Record<string, unknown>
    : {};
  const uploadUrl = String(record.uploadUrl || '');
  const resourceId = String(record.resourceId || record.id || '');

  if (!uploadUrl || !resourceId) {
    throw new Error('FORGE_ENRICHMENT_AUDIO_UPLOAD_SESSION_INVALID');
  }

  const formData = new FormData();
  formData.append('file', blob, `${resourceId}.mp3`);
  let uploadResponse = await fetch(uploadUrl, { method: 'POST', body: formData });
  if (!uploadResponse.ok) {
    uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': mimeType },
    });
  }
  if (!uploadResponse.ok) {
    throw new Error(`FORGE_ENRICHMENT_AUDIO_UPLOAD_FAILED:${uploadResponse.status}`);
  }

  const finalized = await finalizeResource(resourceId, {});
  const finalRecord = finalized && typeof finalized === 'object' && !Array.isArray(finalized)
    ? finalized as Record<string, unknown>
    : {};
  const url = String(finalRecord.url || '');
  if (!url) {
    throw new Error('FORGE_ENRICHMENT_AUDIO_FINALIZE_URL_REQUIRED');
  }

  return {
    resourceId,
    url,
    mimeType,
  };
}

export async function generateAgentCopyCompletion(input: {
  worldName: string;
  worldDescription: string;
  displayName: string;
  concept: string;
  description: string;
  scenario: string;
  greeting: string;
}): Promise<AgentCopyCompletion> {
  const { runtime } = getPlatformClient();
  const textParams = requireAiBinding('text');
  const result = await runtime.ai.text.generate({
    model: textParams.model,
    connectorId: textParams.connectorId,
    route: textParams.route,
    temperature: 0.7,
    maxTokens: 700,
    system: [
      'You complete product-ready roleplay agent copy for Forge.',
      'Return JSON only. No markdown, no prose, no code fences.',
      'Output keys exactly: description, scenario, greeting.',
      'Each field must be a non-empty string.',
      'description: 2-4 sentences, grounded, vivid, no bullet points.',
      'scenario: 2-4 sentences describing the world-facing setup and interaction frame.',
      'greeting: 1 short in-character opening line that can be spoken as a voice demo.',
      'Do not mention that this was AI-generated.',
    ].join(' '),
    input: [
      `World: ${input.worldName || 'Untitled World'}`,
      input.worldDescription ? `World Description: ${input.worldDescription}` : '',
      `Agent: ${input.displayName}`,
      input.concept ? `Concept: ${input.concept}` : '',
      input.description ? `Existing Description: ${input.description}` : 'Existing Description: <missing>',
      input.scenario ? `Existing Scenario: ${input.scenario}` : 'Existing Scenario: <missing>',
      input.greeting ? `Existing Greeting: ${input.greeting}` : 'Existing Greeting: <missing>',
      'Fill only what is missing or too weak, but always return all three fields as clean final copy.',
    ].filter(Boolean).join('\n'),
  });

  const parsed = agentCopyCompletionSchema.safeParse(extractJsonObject(String(result.text || '')));
  if (!parsed.success) {
    throw new Error('FORGE_AGENT_ENRICHMENT_CONTRACT_INVALID');
  }
  return parsed.data;
}

export async function synthesizeVoiceDemo(input: {
  text: string;
  voice?: string;
  language?: string;
}): Promise<StoredAudioArtifact> {
  const { runtime } = getPlatformClient();
  const ttsParams = requireAiBinding('tts');
  const result = await runtime.media.tts.synthesize({
    model: ttsParams.model,
    connectorId: ttsParams.connectorId,
    route: ttsParams.route,
    text: input.text.trim(),
    voice: input.voice?.trim() || undefined,
    language: input.language?.trim() || undefined,
    audioFormat: 'mp3',
  });

  const artifact = result.artifacts.find((item) => item.uri || (item.bytes && item.bytes.length > 0));
  if (!artifact) {
    throw new Error('FORGE_ENRICHMENT_VOICE_ARTIFACT_REQUIRED');
  }

  const mimeType = artifact.mimeType || 'audio/mpeg';
  const blob = await toAudioBlob(artifact);
  return uploadAudioBlob(blob, mimeType);
}

export async function synthesizeAndBindAgentVoiceSample(input: {
  worldId: string;
  agentId: string;
  text: string;
  voice?: string;
  language?: string;
}): Promise<StoredAudioArtifact> {
  const uploaded = await synthesizeVoiceDemo({
    text: input.text,
    voice: input.voice,
    language: input.language,
  });

  await batchUpsertWorldResourceBindings(input.worldId, {
    bindingUpserts: [{
      objectType: 'RESOURCE',
      objectId: uploaded.resourceId,
      hostType: 'AGENT',
      hostId: input.agentId,
      bindingKind: 'PRESENTATION',
      bindingPoint: 'AGENT_VOICE_SAMPLE',
      priority: 0,
    }],
  });

  return uploaded;
}
