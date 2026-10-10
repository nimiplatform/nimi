import {
  ExecutionMode,
  type ScenarioExtension,
  type ScenarioRequestHead,
  type SubmitScenarioJobRequest,
} from '../../core-generated/runtime-typed-client';
import { createNimiError } from '../../types';
import { toRuntimeScenario, type NimiRuntimeGenerationScenario } from './runtime-scenarios';

export interface NimiRuntimeGenerationHeadInput {
  readonly appId: string;
  readonly subjectUserId?: string;
}

export interface NimiRuntimeGenerationSubmitInput {
  readonly head?: Partial<NimiRuntimeGenerationHeadInput>;
  readonly scenario: NimiRuntimeGenerationScenario;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly extensions?: readonly ScenarioExtension[];
}

export function buildNimiRuntimeGenerationSubmitRequest(
  defaultHead: NimiRuntimeGenerationHeadInput,
  input: NimiRuntimeGenerationSubmitInput,
): SubmitScenarioJobRequest {
  const scenario = toRuntimeScenario(input.scenario);
  return {
    head: toRuntimeHead({ ...defaultHead, ...input.head }),
    scenarioType: scenario.scenarioType,
    executionMode: ExecutionMode.ASYNC_JOB,
    spec: scenario.spec,
    requestId: requireText(input.requestId, 'Runtime generation submit requires requestId', 'provide_generation_request_id'),
    idempotencyKey: requireText(
      input.idempotencyKey,
      'Runtime generation submit requires idempotencyKey',
      'provide_generation_idempotency_key',
    ),
    labels: normalizeLabels(input.labels),
    extensions: [...(input.extensions ?? [])],
  };
}

function toRuntimeHead(input: NimiRuntimeGenerationHeadInput): ScenarioRequestHead {
  // Accept the wire's reserved zero check slot when this is composed with the
  // canonical Job-head builder; it never supplies an execution deadline.
  if ('timeoutMs' in input && input.timeoutMs !== 0) {
    throw createNimiError({ message: 'Job business timeout is no longer supported', reasonCode: 'AI_MEDIA_OPTION_UNSUPPORTED', actionHint: 'remove_job_business_timeout', source: 'sdk' });
  }
  return {
    appId: requireText(input.appId, 'Runtime generation head requires appId', 'provide_generation_app_id'),
    subjectUserId: normalizeText(input.subjectUserId),
    timeoutMs: 0,
  };
}

function normalizeLabels(labels: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    const normalizedKey = normalizeText(key);
    if (normalizedKey) {
      normalized[normalizedKey] = normalizeText(value);
    }
  }
  return normalized;
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const text = normalizeText(value);
  if (!text) {
    throw createNimiError({
      message,
      code: 'SDK_GENERATION_FIELD_REQUIRED',
      reasonCode: 'SDK_GENERATION_FIELD_REQUIRED',
      actionHint,
      source: 'sdk',
    });
  }
  return text;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
