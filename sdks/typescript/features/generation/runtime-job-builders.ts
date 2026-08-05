import { createNimiError, ReasonCode } from '../../types';

export interface NimiRuntimeScenarioJobHeadBuilderInput {
  readonly appId: string;
  readonly subjectUserId?: string;
  readonly timeoutMs?: number;
}

export interface NimiRuntimeScenarioJobIdentityInput {
  readonly appId: string;
  readonly capabilityId: string;
  readonly scenarioId: string;
  readonly nonce?: string;
}

export function buildNimiRuntimeScenarioJobHead(input: NimiRuntimeScenarioJobHeadBuilderInput): {
  readonly appId: string;
  readonly subjectUserId: string;
  readonly timeoutMs: number;
} {
  return {
    appId: requireText(input.appId, 'Runtime scenario job head requires appId'),
    subjectUserId: normalizedText(input.subjectUserId),
    timeoutMs: positiveTimeoutMs(input.timeoutMs),
  };
}

export function buildNimiRuntimeScenarioJobIdentity(input: NimiRuntimeScenarioJobIdentityInput): {
  readonly requestId: string;
  readonly idempotencyKey: string;
} {
  const appId = requireText(input.appId, 'Runtime scenario job identity requires appId');
  const capabilityId = requireText(input.capabilityId, 'Runtime scenario job identity requires capabilityId');
  const scenarioId = stableIdPart(requireText(input.scenarioId, 'Runtime scenario job identity requires scenarioId'));
  const nonce = normalizedText(input.nonce) || randomNonce();
  const key = `${appId}:${capabilityId}:${scenarioId}:${nonce}`;
  return {
    requestId: key,
    idempotencyKey: key,
  };
}

function positiveTimeoutMs(value: unknown): number {
  const timeoutMs = value === undefined ? 120_000 : Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw runtimeJobBuilderError(
      'SDK_GENERATION_RUNTIME_JOB_TIMEOUT_INVALID',
      'Runtime scenario job head timeoutMs must be a positive number',
      'provide_runtime_job_timeout',
    );
  }
  return Math.floor(timeoutMs);
}

function requireText(value: unknown, message: string): string {
  const text = normalizedText(value);
  if (!text) {
    throw runtimeJobBuilderError('SDK_GENERATION_RUNTIME_JOB_FIELD_REQUIRED', message, 'provide_runtime_job_field');
  }
  return text;
}

function stableIdPart(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'default';
}

function randomNonce(): string {
  const cryptoSource = globalThis.crypto;
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID();
  }
  if (typeof cryptoSource?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoSource.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  throw runtimeJobBuilderError(
    'SDK_GENERATION_RUNTIME_JOB_RANDOM_UNAVAILABLE',
    'Runtime scenario job identity requires Web Crypto randomUUID or getRandomValues',
    'provide_secure_runtime_job_nonce',
  );
}

function normalizedText(value: unknown): string {
  return String(value ?? '').trim();
}

function runtimeJobBuilderError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}
