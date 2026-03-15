import type {
  WorldStudioMainSlice,
  WorldStudioWorkflowSlice,
} from '@world-engine/controllers/world-studio-screen-model.js';
import type { WorldStudioRuntimeAiClient } from '@world-engine/runtime-ai-client.js';
import type { WorldStudioCreateStep } from '@world-engine/contracts.js';
import { getPlatformClient } from '@runtime/platform-client.js';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function setTimeFlowRatioOnWorldviewPatch(worldviewPatch: Record<string, unknown>, value: string): Record<string, unknown> {
  const numeric = Number(value);
  const timeModel = asRecord(worldviewPatch.timeModel);
  return {
    ...worldviewPatch,
    timeModel: {
      ...timeModel,
      timeFlowRatio: Number.isFinite(numeric) ? numeric : 1,
    },
  };
}

export function getTimeFlowRatioFromWorldviewPatch(worldviewPatch: Record<string, unknown>): string {
  const timeModel = asRecord(worldviewPatch.timeModel);
  const ratio = timeModel.timeFlowRatio;
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    return String(ratio);
  }
  return '1';
}

export function createForgeAiClient(): WorldStudioRuntimeAiClient {
  const { runtime } = getPlatformClient();
  return {
    generateText: async (input) => {
      const result = await runtime.ai.text.generate({
        model: 'auto',
        input: input.prompt,
        system: input.systemPrompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
      const traceId = String(result.trace?.traceId || '').trim();
      return {
        text: String(result.text || ''),
        traceId,
        promptTraceId: traceId,
      };
    },
    generateImage: async (input) => {
      const result = await runtime.media.image.generate({
        model: 'auto',
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        size: input.size,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        style: input.style,
        seed: input.seed,
        responseFormat: input.responseFormat,
        signal: input.abortSignal,
      });
      const artifacts = result.artifacts as unknown as Array<Record<string, unknown>>;
      return {
        artifacts: Array.isArray(artifacts)
          ? artifacts.map((artifact) => ({
              uri: String(artifact.url || artifact.uri || '').trim() || undefined,
              mimeType: String(artifact.mimeType || '').trim() || undefined,
              bytes: artifact.bytes && (artifact.bytes as Uint8Array).length > 0 ? artifact.bytes as Uint8Array : undefined,
            }))
          : [],
        traceId: String(result.trace?.traceId || '').trim(),
      };
    },
    generateEmbedding: async (input) => {
      const result = await runtime.ai.embedding.generate({
        model: input.model || 'auto',
        input: input.input,
      });
      return {
        embeddings: Array.isArray(result.vectors) ? result.vectors : [],
        traceId: String(result.trace?.traceId || '').trim(),
      };
    },
  };
}

function encodeImageArtifactBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

export function resolveGeneratedImageUrl(
  artifacts: Array<{ url?: string; uri?: string; mimeType?: string; base64?: string; bytes?: Uint8Array }>,
): string {
  const artifact = artifacts[0];
  if (!artifact) return '';
  const url = String(artifact.url || artifact.uri || '').trim();
  if (url) return url;
  if (artifact.base64) {
    const mimeType = String(artifact.mimeType || '').trim() || 'image/png';
    return `data:${mimeType};base64,${artifact.base64}`;
  }
  if (artifact.bytes && artifact.bytes.length > 0) {
    const mimeType = String(artifact.mimeType || '').trim() || 'image/png';
    return `data:${mimeType};base64,${encodeImageArtifactBytes(artifact.bytes)}`;
  }
  return '';
}

export function toCreateDisplayStage(step: WorldStudioCreateStep): WorldStudioWorkflowSlice['createDisplayStage'] {
  if (step === 'CHECKPOINTS') return 'CURATE';
  if (step === 'SYNTHESIZE') return 'GENERATE';
  if (step === 'DRAFT' || step === 'PUBLISH') return 'REVIEW';
  return 'IMPORT';
}

export function toImportSubview(step: WorldStudioCreateStep): WorldStudioMainSlice['importSubview'] {
  if (step === 'SOURCE') return 'PREPARE';
  if (step === 'INGEST' || step === 'EXTRACT') return 'RUNNING';
  return 'RESULT';
}

export function toReviewSubview(step: WorldStudioCreateStep): WorldStudioMainSlice['reviewSubview'] {
  return step === 'PUBLISH' ? 'PUBLISH_REVIEW' : 'EDIT';
}

export function toDraftStatus(step: WorldStudioCreateStep): 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED' {
  if (step === 'SYNTHESIZE') return 'SYNTHESIZE';
  if (step === 'DRAFT') return 'REVIEW';
  if (step === 'PUBLISH') return 'PUBLISH';
  return 'DRAFT';
}
