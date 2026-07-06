import {
  ScopedAppBindingPurpose,
  type AccountCaller,
  type IssueScopedAppBindingResponse,
  type RuntimeTypedCallOptions,
  type ScopedAppBindingRelation,
  type ScopedRuntimeBindingAttachment,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import type { RuntimeAccountModule } from './runtime-method-modules';

export const NIMI_RUNTIME_AGENT_SCOPED_BINDING_DEFAULT_TTL_SECONDS = 15 * 60;
export const NIMI_RUNTIME_AGENT_SCOPED_BINDING_DEFAULT_REFRESH_SKEW_MS = 60_000;

export interface NimiRuntimeAgentScopedBindingRuntime {
  readonly account: Pick<RuntimeAccountModule, 'issueScopedAppBinding'>;
}

export interface NimiRuntimeAgentScopedBindingIssueInput {
  readonly runtime: NimiRuntimeAgentScopedBindingRuntime;
  readonly caller: AccountCaller;
  readonly runtimeAppId?: string;
  readonly appInstanceId?: string;
  readonly windowId?: string;
  readonly avatarInstanceId?: string;
  readonly agentId: string;
  readonly conversationAnchorId?: string;
  readonly worldId?: string;
  readonly scopes: readonly string[];
  readonly ttlSeconds?: number;
  readonly options?: RuntimeTypedCallOptions;
}

export interface NimiRuntimeAgentScopedBindingIssueResult {
  readonly scopedBinding: ScopedRuntimeBindingAttachment;
  readonly relation: ScopedAppBindingRelation;
  readonly expiresAtMs: number;
}

export async function issueNimiRuntimeAgentScopedBinding(
  input: NimiRuntimeAgentScopedBindingIssueInput,
): Promise<NimiRuntimeAgentScopedBindingIssueResult> {
  const runtimeAppId = requiredText(input.runtimeAppId ?? input.caller.appId, 'runtimeAppId');
  const appInstanceId = requiredText(input.appInstanceId ?? input.caller.appInstanceId, 'appInstanceId');
  const agentId = requiredText(input.agentId, 'agentId');
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) {
    throw scopedBindingError(
      'Runtime Agent scoped binding requires at least one scope.',
      'SDK_RUNTIME_AGENT_SCOPED_BINDING_INPUT_INVALID',
      'provide_runtime_agent_scoped_binding_scopes',
    );
  }
  const response = await input.runtime.account.issueScopedAppBinding({
    caller: input.caller,
    ttlSeconds: positiveInteger(input.ttlSeconds, NIMI_RUNTIME_AGENT_SCOPED_BINDING_DEFAULT_TTL_SECONDS),
    relation: {
      bindingId: '',
      runtimeAppId,
      appInstanceId,
      windowId: normalizeText(input.windowId),
      avatarInstanceId: normalizeText(input.avatarInstanceId),
      agentId,
      conversationAnchorId: normalizeText(input.conversationAnchorId),
      worldId: normalizeText(input.worldId),
      purpose: ScopedAppBindingPurpose.APP_SCOPED_RUNTIME,
      scopes,
      state: 0,
      reasonCode: 0,
    },
  }, input.options ?? {});
  return projectNimiRuntimeAgentScopedBinding(response);
}

export function projectNimiRuntimeAgentScopedBinding(
  response: IssueScopedAppBindingResponse,
): NimiRuntimeAgentScopedBindingIssueResult {
  const bindingId = normalizeText(response.bindingId);
  const relation = response.relation;
  if (!response.accepted || !bindingId || !relation) {
    throw scopedBindingError(
      'Runtime rejected the scoped Runtime Agent binding request.',
      'SDK_RUNTIME_AGENT_SCOPED_BINDING_REJECTED',
      'inspect_runtime_account_scoped_binding_response',
    );
  }
  return {
    scopedBinding: {
      bindingId,
      bindingHandle: normalizeText(response.bindingCarrier),
      runtimeAppId: normalizeText(relation.runtimeAppId),
      appInstanceId: normalizeText(relation.appInstanceId),
      windowId: normalizeText(relation.windowId),
      avatarInstanceId: normalizeText(relation.avatarInstanceId),
      agentId: normalizeText(relation.agentId),
      conversationAnchorId: normalizeText(relation.conversationAnchorId),
      worldId: normalizeText(relation.worldId),
    },
    relation,
    expiresAtMs: timestampToMs(relation.expiresAt),
  };
}

export function runtimeAgentScopedBindingNeedsRenewal(
  input: {
    readonly expiresAtMs?: number;
    readonly nowMs?: number;
    readonly refreshSkewMs?: number;
  },
): boolean {
  const expiresAtMs = Number(input.expiresAtMs ?? 0);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= 0) {
    return true;
  }
  const nowMs = Number(input.nowMs ?? Date.now());
  const refreshSkewMs = Number(input.refreshSkewMs ?? NIMI_RUNTIME_AGENT_SCOPED_BINDING_DEFAULT_REFRESH_SKEW_MS);
  return expiresAtMs - nowMs <= Math.max(0, refreshSkewMs);
}

function requiredText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw scopedBindingError(
      `Runtime Agent scoped binding requires ${field}.`,
      'SDK_RUNTIME_AGENT_SCOPED_BINDING_INPUT_INVALID',
      `provide_${field}`,
    );
  }
  return normalized;
}

function normalizeScopes(values: readonly unknown[]): string[] {
  return [...new Set(values.map(normalizeText).filter(Boolean))].sort();
}

function positiveInteger(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function timestampToMs(value: ScopedAppBindingRelation['expiresAt']): number {
  if (!value) {
    return 0;
  }
  const seconds = Number(value.seconds || 0);
  const nanos = Number(value.nanos || 0);
  const millis = (seconds * 1000) + Math.floor(nanos / 1_000_000);
  return Number.isFinite(millis) && millis > 0 ? millis : 0;
}

function scopedBindingError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
