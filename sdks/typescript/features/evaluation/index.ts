import { getNimiCapabilityClaim, type NimiCapabilityManifest, type NimiJsonValue, type NimiRunEvent } from '../../core/contracts';

export interface NimiGoldenRun {
  readonly id: string;
  readonly events: readonly NimiRunEvent[];
}

export function createNimiGoldenRun(id: string, events: readonly NimiRunEvent[]): NimiGoldenRun {
  return { id, events };
}

export function assertNimiGoldenRun(actual: NimiGoldenRun, expectedTypes: readonly NimiRunEvent['type'][]): void {
  const actualTypes = actual.events.map((event) => event.type);
  if (actualTypes.join('|') !== expectedTypes.join('|')) {
    throw new Error(`golden run ${actual.id} event order mismatch: ${actualTypes.join('|')}`);
  }
}

export function assertNimiAdapterCapabilityParity(
  manifest: NimiCapabilityManifest,
  requiredCapabilities: readonly string[],
): void {
  const missing = requiredCapabilities.filter((capability) => getNimiCapabilityClaim(manifest, capability).support !== 'supported');
  if (missing.length > 0) {
    throw new Error(`adapter ${manifest.adapterId} missing capabilities: ${missing.join(', ')}`);
  }
}

export type NimiStructuredOutputParseFailureReason =
  | 'invalid-json'
  | 'validator-failed'
  | 'expectation-failed';

export interface NimiStructuredOutputParseSuccess<TValue> {
  readonly ok: true;
  readonly value: TValue;
  readonly raw: string;
}

export interface NimiStructuredOutputParseFailure {
  readonly ok: false;
  readonly reason: NimiStructuredOutputParseFailureReason;
  readonly message: string;
  readonly raw: string;
  readonly error?: unknown;
}

export type NimiStructuredOutputParseResult<TValue> =
  | NimiStructuredOutputParseSuccess<TValue>
  | NimiStructuredOutputParseFailure;

export interface NimiStructuredOutputRepairRequest {
  readonly instruction: string;
  readonly originalText: string;
  readonly failureReason: NimiStructuredOutputParseFailureReason;
  readonly failureMessage: string;
}

export interface NimiStructuredJsonParseInput<TValue> {
  readonly raw: string;
  readonly validate?: (value: unknown) => value is TValue;
  readonly expect?: 'object' | 'array' | 'json';
}

export function parseNimiStructuredJson<TValue = NimiJsonValue>(
  input: NimiStructuredJsonParseInput<TValue>,
): NimiStructuredOutputParseResult<TValue> {
  const raw = input.raw;
  const candidate = extractJsonCandidate(raw);
  if (!candidate) {
    return {
      ok: false,
      reason: 'invalid-json',
      message: 'structured output did not contain a JSON object or array',
      raw,
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-json',
      message: error instanceof Error ? error.message : 'structured output JSON parse failed',
      raw,
      error,
    };
  }

  if (input.expect === 'object' && !isPlainObject(value)) {
    return {
      ok: false,
      reason: 'expectation-failed',
      message: 'structured output JSON value must be an object',
      raw,
    };
  }
  if (input.expect === 'array' && !Array.isArray(value)) {
    return {
      ok: false,
      reason: 'expectation-failed',
      message: 'structured output JSON value must be an array',
      raw,
    };
  }
  if (input.validate && !input.validate(value)) {
    return {
      ok: false,
      reason: 'validator-failed',
      message: 'structured output validator rejected the parsed value',
      raw,
    };
  }

  return {
    ok: true,
    value: value as TValue,
    raw,
  };
}

export function buildNimiStructuredOutputRepairRequest(input: {
  readonly failure: NimiStructuredOutputParseFailure;
  readonly originalText: string;
  readonly instruction?: string;
}): NimiStructuredOutputRepairRequest {
  return {
    instruction: input.instruction
      ?? 'Return only valid JSON matching the requested structure. Do not include prose outside the JSON value.',
    originalText: input.originalText,
    failureReason: input.failure.reason,
    failureMessage: input.failure.message,
  };
}

function extractJsonCandidate(raw: string): string | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    return text;
  }
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  const objectCandidate = objectStart >= 0 && objectEnd > objectStart
    ? text.slice(objectStart, objectEnd + 1)
    : null;
  const arrayCandidate = arrayStart >= 0 && arrayEnd > arrayStart
    ? text.slice(arrayStart, arrayEnd + 1)
    : null;
  if (objectCandidate && arrayCandidate) {
    return objectStart < arrayStart ? objectCandidate : arrayCandidate;
  }
  return objectCandidate ?? arrayCandidate;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
