
import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import { asRecord, normalizeText } from './runtime-value-utils.js';
import { extractGenerateText as extractGenerateTextShared } from '../internal/scenario-output.js';
import {
  ScenarioJobStatus,
  type ScenarioArtifact,
  type ScenarioOutput,
} from './generated/runtime/v1/ai';

export const extractGenerateText = extractGenerateTextShared;

export function toEmbeddingVectors(vectors: unknown): number[][] {
  const items = Array.isArray(vectors) ? vectors : [];
  return items.map((entry) => {
    const values = Array.isArray(asRecord(entry).values)
      ? asRecord(entry).values as unknown[]
      : [];
    return values
      .map((value) => {
        const kind = asRecord(asRecord(value).kind);
        if (kind.oneofKind === 'numberValue') {
          const parsed = Number(kind.numberValue);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      })
      .filter((value): value is number => value !== null);
  });
}

export function extractEmbeddingVectors(output: unknown): number[][] {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind !== 'textEmbed') {
    throw createNimiError({
      message: 'runtime media output missing typed textEmbed result',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }
  return variant.textEmbed.vectors.map((vector) => vector.values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item)));
}

export function extractSpeechTranscription(output: unknown): {
  text: string;
  artifacts: ScenarioArtifact[];
} {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind !== 'speechTranscribe') {
    throw createNimiError({
      message: 'runtime media output missing typed speechTranscribe result',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }
  return {
    text: normalizeText(variant.speechTranscribe.text),
    artifacts: Array.isArray(variant.speechTranscribe.artifacts)
      ? variant.speechTranscribe.artifacts
      : [],
  };
}

export function extractScenarioArtifacts(
  output: unknown,
  kind: 'imageGenerate' | 'videoGenerate' | 'musicGenerate' | 'speechSynthesize',
): ScenarioArtifact[] {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  switch (kind) {
    case 'imageGenerate':
      return variant?.oneofKind === 'imageGenerate' && Array.isArray(variant.imageGenerate.artifacts)
        ? variant.imageGenerate.artifacts
        : [];
    case 'videoGenerate':
      return variant?.oneofKind === 'videoGenerate' && Array.isArray(variant.videoGenerate.artifacts)
        ? variant.videoGenerate.artifacts
        : [];
    case 'musicGenerate':
      return variant?.oneofKind === 'musicGenerate' && Array.isArray(variant.musicGenerate.artifacts)
        ? variant.musicGenerate.artifacts
        : [];
    case 'speechSynthesize':
      return variant?.oneofKind === 'speechSynthesize' && Array.isArray(variant.speechSynthesize.artifacts)
        ? variant.speechSynthesize.artifacts
        : [];
    default:
      return [];
  }
}

export function mediaStatusToString(status: ScenarioJobStatus): string {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'SUBMITTED';
    case ScenarioJobStatus.QUEUED:
      return 'QUEUED';
    case ScenarioJobStatus.RUNNING:
      return 'RUNNING';
    case ScenarioJobStatus.COMPLETED:
      return 'COMPLETED';
    case ScenarioJobStatus.FAILED:
      return 'FAILED';
    case ScenarioJobStatus.CANCELED:
      return 'CANCELED';
    case ScenarioJobStatus.TIMEOUT:
      return 'TIMEOUT';
    default:
      return 'UNSPECIFIED';
  }
}
