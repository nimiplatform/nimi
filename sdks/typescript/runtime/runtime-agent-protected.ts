import type { RuntimeTypedCallOptions } from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export interface NimiRuntimeAgentAuthClient {}

export interface NimiRuntimeAgentProtectedRuntime {
  readonly appId: string;
}

export type NimiRuntimeAgentScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
) => Promise<T>;

export interface NimiRuntimeAgentProtectedOptions {
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export async function resolveNimiRuntimeAgentSubjectUserId(
  getSubjectUserId: () => string | Promise<string | undefined> | undefined,
  message: string,
): Promise<string> {
  const subjectUserId = normalizeNimiRuntimeAgentText(await getSubjectUserId());
  if (!subjectUserId) {
    throw createNimiError({
      message,
      reasonCode: 'SDK_RUNTIME_AGENT_SUBJECT_REQUIRED',
      actionHint: 'provide_runtime_agent_subject_user_id',
      source: 'sdk',
    });
  }
  return subjectUserId;
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => normalizeNimiRuntimeAgentText(scope)).filter(Boolean))].sort();
}

export async function withNimiRuntimeAgentScopes<T>(
  input: {
    readonly runtime: NimiRuntimeAgentProtectedRuntime;
    readonly subjectUserId: string;
    readonly withScopes?: NimiRuntimeAgentScopeRunner;
  },
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  const normalizedScopes = normalizeScopes(scopes);
  if (!input.withScopes) {
    throw createNimiError({
      message: 'Runtime Agent protected access requires a host-provided per-operation context.',
      reasonCode: 'SDK_RUNTIME_AGENT_OPERATION_CONTEXT_REQUIRED',
      actionHint: 'use_host_runtime_agent_operation_context',
      source: 'runtime',
    });
  }
  return input.withScopes(normalizedScopes, operation);
}
