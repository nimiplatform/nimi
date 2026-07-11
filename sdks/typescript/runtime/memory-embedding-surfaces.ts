import { type RuntimeTypedCallOptions } from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  buildNimiMemoryEmbeddingAgentCoreLocator,
  projectNimiMemoryEmbeddingBindResult,
  projectNimiMemoryEmbeddingCutoverResult,
  projectNimiMemoryEmbeddingRuntimeState,
  projectUnavailableNimiMemoryEmbeddingRuntimeState,
} from './memory-embedding-projection';
import type {
  NimiHostMemoryEmbeddingRuntimeClient,
  NimiHostMemoryEmbeddingRuntimeSurfaceOptions,
  NimiMemoryEmbeddingBindResult,
  NimiMemoryEmbeddingCutoverResult,
  NimiMemoryEmbeddingRuntimeInput,
  NimiMemoryEmbeddingRuntimeState,
  NimiMemoryEmbeddingRuntimeSurface,
  NimiProtectedHostMemoryEmbeddingRuntimeClient,
  NimiProtectedHostMemoryEmbeddingRuntimeSurfaceOptions,
} from './memory-embedding-types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => normalizeText(scope)).filter(Boolean))].sort();
}

async function callWithNimiMemoryEmbeddingScopes<T>(
  input: {
    readonly withScopes?: <R>(
      scopes: readonly string[],
      operation: (options: RuntimeTypedCallOptions) => Promise<R>,
    ) => Promise<R>;
  },
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  return input.withScopes ? input.withScopes(scopes, operation) : operation({});
}

export function createNimiHostMemoryEmbeddingRuntimeSurface(
  options: NimiHostMemoryEmbeddingRuntimeSurfaceOptions,
): NimiMemoryEmbeddingRuntimeSurface {
  async function contextOrUnavailable(): Promise<
    | { readonly ok: true; readonly runtime: NimiHostMemoryEmbeddingRuntimeClient; readonly subjectUserId: string }
    | { readonly ok: false; readonly blockedReasonCode: string }
  > {
    const subjectUserId = normalizeText(await options.getSubjectUserId());
    if (!subjectUserId) {
      return { ok: false, blockedReasonCode: options.unavailableReasonCode || 'RUNTIME_UNAVAILABLE' };
    }
    return { ok: true, runtime: await options.runtime(), subjectUserId };
  }

  return {
    async inspect(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingRuntimeState> {
      const context = await contextOrUnavailable();
      if (!context.ok) return projectUnavailableNimiMemoryEmbeddingRuntimeState(context.blockedReasonCode);
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.read'], (callOptions) => (
        context.runtime.memory.inspectMemoryEmbeddingRuntime({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingRuntimeState(result);
    },
    async requestBind(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingBindResult> {
      const context = await contextOrUnavailable();
      if (!context.ok) {
        return {
          outcome: 'rejected',
          blockedReasonCode: context.blockedReasonCode,
          canonicalBankStatusAfter: 'unbound',
          pendingCutover: false,
        };
      }
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.write'], (callOptions) => (
        context.runtime.memory.requestMemoryEmbeddingRuntimeBind({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingBindResult(result);
    },
    async requestCutover(input: NimiMemoryEmbeddingRuntimeInput): Promise<NimiMemoryEmbeddingCutoverResult> {
      const context = await contextOrUnavailable();
      if (!context.ok) {
        return {
          outcome: 'not_ready',
          blockedReasonCode: context.blockedReasonCode,
          canonicalBankStatusAfter: 'unbound',
        };
      }
      const result = await callWithNimiMemoryEmbeddingScopes(options, ['runtime.memory.write'], (callOptions) => (
        context.runtime.memory.requestMemoryEmbeddingRuntimeCutover({
          context: { appId: context.runtime.appId, subjectUserId: context.subjectUserId },
          locator: buildNimiMemoryEmbeddingAgentCoreLocator(input.targetRef),
        }, callOptions)
      ));
      return projectNimiMemoryEmbeddingCutoverResult(result);
    },
  };
}

export function createNimiProtectedHostMemoryEmbeddingRuntimeSurface(
  options: NimiProtectedHostMemoryEmbeddingRuntimeSurfaceOptions,
): NimiMemoryEmbeddingRuntimeSurface {
  let protectedRuntime: NimiProtectedHostMemoryEmbeddingRuntimeClient | null = null;
  async function runtime() {
    protectedRuntime ||= await options.runtime();
    return protectedRuntime;
  }
  return createNimiHostMemoryEmbeddingRuntimeSurface({
    ...options,
    runtime,
    withScopes: async (scopes, operation) => {
      if (!options.withScopes) {
        throw createNimiError({
          message: 'Runtime memory embedding protected access requires a Runtime-owned scoped carrier.',
          reasonCode: 'SDK_RUNTIME_AGENT_SCOPED_CARRIER_REQUIRED',
          actionHint: 'use_runtime_owned_scoped_carrier',
          source: 'runtime',
        });
      }
      return options.withScopes(scopes, operation);
    },
  });
}
