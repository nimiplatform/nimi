import { asRecord, normalizeText } from './utils.js';
import type { JsonObject } from './utils.js';
import { asNimiError, createNimiError } from '../runtime/errors.js';
import type {
  WorldEvolutionSelectorReadMethodId,
  WorldEvolutionSelectorReadRejectionCategory,
} from '../runtime/world-evolution-selector-read.js';
import { ReasonCode } from '../types/index.js';
import type { RejectionInput } from './world-evolution-selector-read-types.js';

function mapReasonCode(category: WorldEvolutionSelectorReadRejectionCategory): string {
  switch (category) {
    case 'INVALID_SELECTOR':
    case 'INCOMPLETE_SELECTOR':
      return ReasonCode.ACTION_INPUT_INVALID;
    case 'MISSING_REQUIRED_EVIDENCE':
      return ReasonCode.ACTION_NOT_FOUND;
    case 'UNSUPPORTED_PROJECTION_SHAPE':
      return ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED;
    case 'BOUNDARY_DENIED':
      return ReasonCode.ACTION_PERMISSION_DENIED;
  }
}

function mapActionHint(category: WorldEvolutionSelectorReadRejectionCategory): string {
  switch (category) {
    case 'INVALID_SELECTOR':
      return 'fix_world_evolution_selector';
    case 'INCOMPLETE_SELECTOR':
      return 'complete_world_evolution_selector';
    case 'MISSING_REQUIRED_EVIDENCE':
      return 'provide_world_evolution_evidence';
    case 'UNSUPPORTED_PROJECTION_SHAPE':
      return 'check_world_evolution_projection_shape';
    case 'BOUNDARY_DENIED':
      return 'ensure_world_evolution_read_boundary';
  }
}

export function createSelectorReadError(input: RejectionInput): Error {
  return createNimiError({
    message: input.message,
    reasonCode: mapReasonCode(input.category),
    actionHint: mapActionHint(input.category),
    source: 'sdk',
    details: {
      rejectionCategory: input.category,
      methodId: input.methodId,
      ...(input.details || {}),
    },
  });
}

export function createWorldEvolutionSelectorReadError(
  category: WorldEvolutionSelectorReadRejectionCategory,
  methodId: WorldEvolutionSelectorReadMethodId,
  message: string,
  details?: JsonObject,
): Error {
  return createSelectorReadError({
    category,
    methodId,
    message,
    details,
  });
}

export function normalizeProviderError(
  error: unknown,
  methodId: WorldEvolutionSelectorReadMethodId,
): Error {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.ACTION_PERMISSION_DENIED,
    actionHint: 'ensure_world_evolution_read_boundary',
    source: 'sdk',
  });
  const category = normalizeText(asRecord(normalized.details).rejectionCategory) as WorldEvolutionSelectorReadRejectionCategory;
  if (
    category === 'INVALID_SELECTOR'
    || category === 'INCOMPLETE_SELECTOR'
    || category === 'MISSING_REQUIRED_EVIDENCE'
    || category === 'UNSUPPORTED_PROJECTION_SHAPE'
    || category === 'BOUNDARY_DENIED'
  ) {
    return createSelectorReadError({
      category,
      methodId,
      message: normalized.message,
      details: asRecord(normalized.details),
    });
  }
  return createSelectorReadError({
    category: 'BOUNDARY_DENIED',
    methodId,
    message: normalized.message || `${methodId} denied by provider boundary`,
    details: {
      providerReasonCode: normalized.reasonCode,
    },
  });
}
