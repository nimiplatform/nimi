import {
  createNimiStandardShellError,
  type NimiStandardShellErrorCode,
} from '@nimiplatform/kit/shell/capabilities';

import type {
  NimiRendererHostFailureDisposition,
  NimiRendererHostResult,
} from './types.js';

interface StandardErrorProjection {
  readonly code: NimiStandardShellErrorCode;
  readonly reasonCode: string;
  readonly actionHint: string;
}

const ERROR_PROJECTIONS: Readonly<Record<
  NimiRendererHostFailureDisposition,
  StandardErrorProjection
>> = Object.freeze({
  unsupported: {
    code: 'capability-unavailable',
    reasonCode: 'renderer-host-operation-unsupported',
    actionHint: 'use_supported_renderer_host_operation',
  },
  'capability-denied': {
    code: 'capability-unavailable',
    reasonCode: 'renderer-host-capability-denied',
    actionHint: 'use_enabled_renderer_host_capability',
  },
  'resource-exhausted': {
    code: 'resource-exhausted',
    reasonCode: 'renderer-host-resource-exhausted',
    actionHint: 'release_renderer_host_resources',
  },
  'invalid-input': {
    code: 'invalid-payload',
    reasonCode: 'renderer-host-input-invalid',
    actionHint: 'correct_renderer_host_input',
  },
  'host-unavailable': {
    code: 'capability-unavailable',
    reasonCode: 'renderer-host-unavailable',
    actionHint: 'wait_for_renderer_host',
  },
  'effect-forbidden': {
    code: 'forbidden-renderer-access',
    reasonCode: 'renderer-host-effect-forbidden',
    actionHint: 'use_admitted_renderer_host_effect',
  },
  internal: {
    code: 'host-internal-error',
    reasonCode: 'renderer-host-internal-failure',
    actionHint: 'inspect_renderer_host_diagnostics',
  },
});

const DISPOSITIONS = new Set<string>(Object.keys(ERROR_PROJECTIONS));

export function createNimiRendererHostError(
  disposition: NimiRendererHostFailureDisposition,
  method: string,
) {
  const projection = ERROR_PROJECTIONS[disposition];
  return createNimiStandardShellError({
    ...projection,
    source: 'host',
    details: { method },
  });
}

export function normalizeNimiRendererHostResult<TValue>(
  value: NimiRendererHostResult<TValue>,
): NimiRendererHostResult<TValue> {
  if (isExactRecord(value, ['ok', 'value']) && value.ok === true) {
    return Object.freeze({ ok: true as const, value: value.value as TValue });
  }
  if (isExactRecord(value, ['error', 'ok'])
    && value.ok === false
    && isExactRecord(value.error, ['disposition'])
    && isDisposition(value.error.disposition)) {
    return hostFailure(value.error.disposition);
  }
  return hostFailure('internal');
}

export function hostFailure<TValue>(
  disposition: NimiRendererHostFailureDisposition,
): NimiRendererHostResult<TValue> {
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ disposition }),
  });
}

function isDisposition(value: unknown): value is NimiRendererHostFailureDisposition {
  return typeof value === 'string' && DISPOSITIONS.has(value);
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
