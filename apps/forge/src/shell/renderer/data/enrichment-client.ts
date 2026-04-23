import { z } from 'zod';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  ExecutionMode,
  RoutePolicy,
  ScenarioJobStatus,
  ScenarioType,
} from '@nimiplatform/sdk/runtime';
import {
  VoiceAssetStatus,
  VoiceReferenceKind,
  VoiceWorkflowType,
  type VoiceAsset,
} from '@nimiplatform/sdk/runtime/generated/runtime/v1/voice.js';
import { getResolvedAiParams } from '@renderer/hooks/use-ai-config.js';
import { CAPABILITY_MAP, useAiConfigStore } from '@renderer/state/ai-config-store.js';
import {
  createAudioDirectUpload,
  finalizeResource,
} from './content-data-client.js';

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

export type DesignedVoiceAsset = {
  voiceAssetId: string;
  providerVoiceRef: string | null;
  modelId: string;
  targetModelId: string;
  workflowType: 'tts_t2v' | 'tts_v2v' | 'unspecified';
  status: 'ACTIVE' | 'EXPIRED' | 'DELETED' | 'FAILED' | 'UNSPECIFIED';
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
};

type ResolvedRouteBinding = {
  model: string;
  connectorId: string;
  route: 'local' | 'cloud';
};

function requireAiBinding(capability: 'text' | 'tts') {
  const params = getResolvedAiParams(capability);
  if (!params.model) {
    throw new Error(`FORGE_ENRICHMENT_${capability.toUpperCase()}_MODEL_REQUIRED`);
  }
  return params;
}

function requireVoiceDesignBinding(): ResolvedRouteBinding {
  const binding = useAiConfigStore.getState().aiConfig.capabilities.selectedBindings['voice_workflow.tts_t2v'];
  if (!binding || typeof binding !== 'object') {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_BINDING_REQUIRED');
  }
  const model = String(binding.model || '').trim();
  if (!model) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_MODEL_REQUIRED');
  }
  const route = binding.source === 'cloud' ? 'cloud' : 'local';
  return {
    model,
    connectorId: String(binding.connectorId || '').trim(),
    route,
  };
}

function currentTtsModelId(): string {
  const store = useAiConfigStore.getState();
  const binding = store.aiConfig.capabilities.selectedBindings[CAPABILITY_MAP.tts];
  const model = String(binding?.model || '').trim();
  return model || requireAiBinding('tts').model;
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

function toRoutePolicy(route: 'local' | 'cloud'): RoutePolicy {
  return route === 'cloud' ? RoutePolicy.CLOUD : RoutePolicy.LOCAL;
}

function toTimestampIso(value: { seconds?: string | number | bigint; nanos?: number } | undefined): string | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const millis = Math.floor(seconds * 1000) + Math.floor(nanos / 1_000_000);
  return new Date(millis).toISOString();
}

function toDesignedVoiceAsset(asset: VoiceAsset): DesignedVoiceAsset {
  const status: DesignedVoiceAsset['status'] =
    asset.status === VoiceAssetStatus.ACTIVE
      ? 'ACTIVE'
      : asset.status === VoiceAssetStatus.EXPIRED
        ? 'EXPIRED'
        : asset.status === VoiceAssetStatus.DELETED
          ? 'DELETED'
          : asset.status === VoiceAssetStatus.FAILED
            ? 'FAILED'
            : 'UNSPECIFIED';
  return {
    voiceAssetId: String(asset.voiceAssetId || '').trim(),
    providerVoiceRef: String(asset.providerVoiceRef || '').trim() || null,
    modelId: String(asset.modelId || '').trim(),
    targetModelId: String(asset.targetModelId || '').trim(),
    workflowType: asset.workflowType === VoiceWorkflowType.TTS_T2V
      ? 'tts_t2v'
      : asset.workflowType === VoiceWorkflowType.TTS_V2V
        ? 'tts_v2v'
        : 'unspecified',
    status,
    createdAt: toTimestampIso(asset.createdAt),
    updatedAt: toTimestampIso(asset.updatedAt),
    expiresAt: toTimestampIso(asset.expiresAt),
  };
}

async function waitForScenarioJobCompletion(input: {
  jobId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<void> {
  const { runtime } = getPlatformClient();
  const timeoutMs = Number(input.timeoutMs || 180_000);
  const pollIntervalMs = Number(input.pollIntervalMs || 1_500);
  const startedAt = Date.now();

  while (true) {
    const response = await runtime.ai.getScenarioJob({ jobId: input.jobId });
    const job = response.job;
    if (!job) {
      throw new Error('FORGE_ENRICHMENT_SCENARIO_JOB_REQUIRED');
    }
    if (job.status === ScenarioJobStatus.COMPLETED) {
      return;
    }
    if (
      job.status === ScenarioJobStatus.CANCELED
      || job.status === ScenarioJobStatus.FAILED
      || job.status === ScenarioJobStatus.TIMEOUT
    ) {
      throw new Error(String(job.reasonDetail || job.reasonCode || 'FORGE_ENRICHMENT_SCENARIO_JOB_FAILED'));
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('FORGE_ENRICHMENT_SCENARIO_JOB_TIMEOUT');
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

function pickRuntimeAudioArtifact(artifacts: Array<Record<string, unknown> | null | undefined>): AudioArtifactLike | null {
  for (const artifact of artifacts) {
    const item = artifact && typeof artifact === 'object' && !Array.isArray(artifact)
      ? artifact as Record<string, unknown>
      : null;
    if (!item) {
      continue;
    }
    const uri = typeof item.uri === 'string' ? item.uri : undefined;
    const bytes = item.bytes instanceof Uint8Array
      ? item.bytes
      : Array.isArray(item.bytes)
        ? Uint8Array.from(item.bytes.map((value) => Number(value || 0)))
        : undefined;
    if (uri || (bytes && bytes.length > 0)) {
      return {
        artifactId: typeof item.artifactId === 'string' ? item.artifactId : undefined,
        uri,
        bytes,
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
      };
    }
  }
  return null;
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
  voiceAssetId?: string;
}): Promise<StoredAudioArtifact> {
  const { runtime } = getPlatformClient();
  const ttsParams = requireAiBinding('tts');
  const voiceAssetId = String(input.voiceAssetId || '').trim();
  const providerVoiceRef = String(input.voice || '').trim();
  const response = await runtime.ai.executeScenario({
    head: {
      appId: runtime.appId,
      modelId: ttsParams.model,
      routePolicy: toRoutePolicy(ttsParams.route || 'local'),
      timeoutMs: 120_000,
      connectorId: ttsParams.connectorId || '',
    },
    scenarioType: ScenarioType.SPEECH_SYNTHESIZE,
    executionMode: ExecutionMode.SYNC,
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'speechSynthesize' as const,
        speechSynthesize: {
          text: input.text.trim(),
          language: input.language?.trim() || '',
          audioFormat: 'mp3',
          sampleRateHz: 0,
          speed: 0,
          pitch: 0,
          volume: 0,
          emotion: '',
          voiceRef: voiceAssetId
            ? {
              kind: VoiceReferenceKind.VOICE_ASSET,
              reference: {
                oneofKind: 'voiceAssetId' as const,
                voiceAssetId,
              },
            }
            : providerVoiceRef
              ? {
                kind: VoiceReferenceKind.PROVIDER_VOICE_REF,
                reference: {
                  oneofKind: 'providerVoiceRef' as const,
                  providerVoiceRef,
                },
              }
              : undefined,
          timingMode: 0,
        },
      },
    },
  });

  const typedArtifacts =
    response.output?.output?.oneofKind === 'speechSynthesize'
      ? response.output.output.speechSynthesize.artifacts || []
      : [];
  const artifact = pickRuntimeAudioArtifact(
    Array.isArray(typedArtifacts)
      ? typedArtifacts.map((item) => item as unknown as Record<string, unknown>)
      : [],
  );
  if (!artifact) {
    throw new Error('FORGE_ENRICHMENT_VOICE_ARTIFACT_REQUIRED');
  }

  const mimeType = artifact.mimeType || 'audio/mpeg';
  const blob = await toAudioBlob(artifact);
  return uploadAudioBlob(blob, mimeType);
}

export async function designCustomVoiceAsset(input: {
  instructionText: string;
  previewText: string;
  language?: string;
  preferredName?: string;
  targetModelId?: string;
}): Promise<DesignedVoiceAsset> {
  const { runtime } = getPlatformClient();
  const binding = requireVoiceDesignBinding();
  const instructionText = input.instructionText.trim();
  const previewText = input.previewText.trim();
  if (!instructionText) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_INSTRUCTION_REQUIRED');
  }
  if (!previewText) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_PREVIEW_REQUIRED');
  }

  const submit = await runtime.ai.submitScenarioJob({
    head: {
      appId: runtime.appId,
      modelId: binding.model,
      routePolicy: toRoutePolicy(binding.route),
      timeoutMs: 180_000,
      connectorId: binding.connectorId,
    },
    scenarioType: ScenarioType.VOICE_DESIGN,
    executionMode: ExecutionMode.ASYNC_JOB,
    requestId: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    labels: {
      surface: 'forge-agent-asset-ops',
      capability: 'voice_workflow.tts_t2v',
    },
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'voiceDesign' as const,
        voiceDesign: {
          targetModelId: String(input.targetModelId || currentTtsModelId() || binding.model).trim(),
          input: {
            instructionText,
            previewText,
            language: input.language?.trim() || '',
            preferredName: input.preferredName?.trim() || '',
          },
        },
      },
    },
  });

  const jobId = String(submit.job?.jobId || '').trim();
  if (!jobId) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_JOB_ID_REQUIRED');
  }
  await waitForScenarioJobCompletion({ jobId });

  const voiceAssetId = String(submit.asset?.voiceAssetId || '').trim();
  if (!voiceAssetId) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_ASSET_REQUIRED');
  }
  const assetResponse = await runtime.ai.getVoiceAsset({ voiceAssetId });
  if (!assetResponse.asset) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_FETCH_REQUIRED');
  }
  return toDesignedVoiceAsset(assetResponse.asset);
}

export async function listDesignedVoiceAssets(input?: {
  subjectUserId?: string;
  targetModelId?: string;
}): Promise<DesignedVoiceAsset[]> {
  const { runtime } = getPlatformClient();
  const binding = requireVoiceDesignBinding();
  const subjectUserId = String(input?.subjectUserId || '').trim();
  if (!subjectUserId) {
    throw new Error('FORGE_ENRICHMENT_VOICE_DESIGN_SUBJECT_USER_REQUIRED');
  }
  const response = await runtime.ai.listVoiceAssets({
    appId: runtime.appId,
    subjectUserId,
    modelId: binding.model,
    targetModelId: String(input?.targetModelId || currentTtsModelId() || binding.model).trim(),
    workflowType: VoiceWorkflowType.TTS_T2V,
    status: VoiceAssetStatus.ACTIVE,
    pageSize: 50,
    pageToken: '',
    connectorId: binding.connectorId,
  });

  return (response.assets || [])
    .map((asset) => toDesignedVoiceAsset(asset))
    .filter((asset) => Boolean(asset.voiceAssetId))
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || '') || right.voiceAssetId.localeCompare(left.voiceAssetId));
}

export async function synthesizeAgentVoiceSample(input: {
  text: string;
  voice?: string;
  language?: string;
}): Promise<StoredAudioArtifact> {
  return await synthesizeVoiceDemo({
    text: input.text,
    voice: input.voice,
    language: input.language,
  });
}
