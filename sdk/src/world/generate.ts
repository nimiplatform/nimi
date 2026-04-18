import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';
import type { PlatformClient } from '../platform-client.js';
import type {
  WorldGenerateRuntimeRequest,
  WorldGenerateRuntimeOptions,
  WorldGenerateSubmitInput,
  WorldGenerateSubmitResult,
  WorldInputProjection,
  WorldProjectionInput,
} from './types.js';

function normalizeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
}

function resolveSourceModalities(
  input: WorldProjectionInput,
): Array<'text' | 'image' | 'multi-image' | 'video'> {
  const modalities = new Set<'text' | 'image' | 'multi-image' | 'video'>();
  if (normalizeString(input.textPrompt) || normalizeString(input.worldSummary)) {
    modalities.add('text');
  }
  switch (input.conditioning?.type) {
    case 'image':
      modalities.add('image');
      break;
    case 'multi-image':
      modalities.add('multi-image');
      break;
    case 'video':
      modalities.add('video');
      break;
    default:
      break;
  }
  return Array.from(modalities);
}

function buildProjectionPromptText(projection: WorldInputProjection): string {
  const lines = [
    normalizeString(projection.textPrompt),
    normalizeString(projection.worldSummary)
      ? `World summary: ${normalizeString(projection.worldSummary)}`
      : '',
    normalizeString(projection.spatialSummary)
      ? `Spatial summary: ${normalizeString(projection.spatialSummary)}`
      : '',
    normalizeString(projection.entitySummary)
      ? `Entity summary: ${normalizeString(projection.entitySummary)}`
      : '',
    projection.moodStyleHints?.length
      ? `Mood/style hints: ${projection.moodStyleHints.join(', ')}`
      : '',
    projection.traversalHints?.length
      ? `Traversal hints: ${projection.traversalHints.join(', ')}`
      : '',
    projection.interactionHints?.length
      ? `Interaction hints: ${projection.interactionHints.join(', ')}`
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildWorldInputProjection(
  input: WorldProjectionInput,
): WorldInputProjection {
  const projection: WorldInputProjection = {
    ...(normalizeString(input.worldId) ? { worldId: normalizeString(input.worldId) } : {}),
    ...(normalizeString(input.displayName) ? { displayName: normalizeString(input.displayName) } : {}),
    ...(normalizeString(input.textPrompt) ? { textPrompt: normalizeString(input.textPrompt) } : {}),
    ...(normalizeString(input.worldSummary) ? { worldSummary: normalizeString(input.worldSummary) } : {}),
    ...(normalizeString(input.spatialSummary) ? { spatialSummary: normalizeString(input.spatialSummary) } : {}),
    ...(normalizeString(input.entitySummary) ? { entitySummary: normalizeString(input.entitySummary) } : {}),
    ...(normalizeStringList(input.moodStyleHints).length > 0 ? { moodStyleHints: normalizeStringList(input.moodStyleHints) } : {}),
    ...(normalizeStringList(input.traversalHints).length > 0 ? { traversalHints: normalizeStringList(input.traversalHints) } : {}),
    ...(normalizeStringList(input.interactionHints).length > 0 ? { interactionHints: normalizeStringList(input.interactionHints) } : {}),
    ...(input.conditioning ? { conditioning: input.conditioning } : {}),
    ...(normalizeStringList(input.tags).length > 0 ? { tags: normalizeStringList(input.tags) } : {}),
    ...(Number.isFinite(Number(input.seed)) ? { seed: Number(input.seed) } : {}),
    sourceModalities: resolveSourceModalities(input),
  };
  const hasSemanticInput = Boolean(
    projection.textPrompt
      || projection.worldSummary
      || projection.spatialSummary
      || projection.entitySummary
      || projection.conditioning,
  );
  if (!hasSemanticInput) {
    throw createNimiError({
      message: 'world.generate requires text/world semantic input or conditioning media',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_world_projection_input',
      source: 'sdk',
    });
  }
  return projection;
}

export function toRuntimeWorldGenerateInput(
  projection: WorldInputProjection,
  options: WorldGenerateRuntimeOptions,
): WorldGenerateRuntimeRequest {
  const model = normalizeString(options.model);
  if (!model) {
    throw createNimiError({
      message: 'world.generate requires model',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_world_model',
      source: 'sdk',
    });
  }
  const textPrompt = buildProjectionPromptText(projection);
  if (!textPrompt && !projection.conditioning) {
    throw createNimiError({
      message: 'world.generate projection could not produce runtime input',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_projection_fields',
      source: 'sdk',
    });
  }
  return {
    model,
    ...(projection.displayName ? { displayName: projection.displayName } : {}),
    ...(textPrompt ? { textPrompt } : {}),
    ...(projection.tags?.length ? { tags: projection.tags } : {}),
    ...(Number.isFinite(Number(projection.seed)) ? { seed: Number(projection.seed) } : {}),
    ...(projection.conditioning ? { conditioning: projection.conditioning } : {}),
    ...(options.subjectUserId ? { subjectUserId: normalizeString(options.subjectUserId) } : {}),
    ...(options.route ? { route: options.route } : {}),
    ...(Number.isFinite(Number(options.timeoutMs)) ? { timeoutMs: Number(options.timeoutMs) } : {}),
    ...(options.connectorId ? { connectorId: normalizeString(options.connectorId) } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.idempotencyKey ? { idempotencyKey: normalizeString(options.idempotencyKey) } : {}),
    ...(options.requestId ? { requestId: normalizeString(options.requestId) } : {}),
    ...(options.labels ? { labels: options.labels } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

export async function submitWorldGenerate(
  client: Pick<PlatformClient, 'runtime'>,
  input: WorldGenerateSubmitInput,
): Promise<WorldGenerateSubmitResult> {
  const projection = buildWorldInputProjection(input);
  const request = toRuntimeWorldGenerateInput(projection, input);
  const job = await client.runtime.media.jobs.submit({
    modal: 'world',
    input: request,
  });
  return {
    projection,
    request,
    job,
  };
}

export const generate = {
  project: buildWorldInputProjection,
  toRuntimeInput: toRuntimeWorldGenerateInput,
  submit: submitWorldGenerate,
};
