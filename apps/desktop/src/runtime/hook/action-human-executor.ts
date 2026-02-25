import type { HookActionResult } from './contracts/action.js';
import { getRuntimeHookRuntime } from '@runtime/mod';

type HumanActionContextInput = {
  userAccountId: string;
  principalId?: string;
  traceId?: string;
};

type HumanActionRequest = {
  actionId: string;
  input: Record<string, unknown>;
  idempotencyKey?: string;
  context: HumanActionContextInput;
};

type HumanActionRuntime = {
  dryRunAction: (input: {
    actionId: string;
    input: Record<string, unknown>;
    idempotencyKey?: string;
    context: ReturnType<typeof buildHumanContext>;
  }) => Promise<HookActionResult>;
  verifyAction: (input: {
    actionId: string;
    input: Record<string, unknown>;
    idempotencyKey?: string;
    context: ReturnType<typeof buildHumanContext>;
  }) => Promise<HookActionResult & { verifyTicket: string; expiresAt: string }>;
  commitAction: (input: {
    actionId: string;
    input: Record<string, unknown>;
    idempotencyKey?: string;
    verifyTicket?: string;
    context: ReturnType<typeof buildHumanContext>;
  }) => Promise<HookActionResult>;
};

function normalizeTraceId(input?: string): string {
  const traceId = String(input || '').trim();
  if (traceId) return traceId;
  return `human-action:${Date.now().toString(36)}`;
}

function normalizePrincipalId(input: HumanActionContextInput): string {
  const principalId = String(input.principalId || '').trim();
  if (principalId) return principalId;
  return `human:${input.userAccountId}`;
}

function buildHumanContext(input: HumanActionContextInput) {
  const userAccountId = String(input.userAccountId || '').trim();
  if (!userAccountId) {
    throw new Error('HUMAN_ACTION_USER_ACCOUNT_REQUIRED');
  }
  return {
    principalId: normalizePrincipalId({ ...input, userAccountId }),
    principalType: 'human' as const,
    subjectAccountId: userAccountId,
    mode: 'delegated' as const,
    traceId: normalizeTraceId(input.traceId),
    userAccountId,
  };
}

export function createHumanActionExecutor(input?: {
  runtime?: HumanActionRuntime;
}) {
  const runtime = input?.runtime || getRuntimeHookRuntime();
  return {
    async dryRunActionAsHuman(payload: HumanActionRequest): Promise<HookActionResult> {
      return runtime.dryRunAction({
        actionId: payload.actionId,
        input: payload.input,
        idempotencyKey: payload.idempotencyKey,
        context: buildHumanContext(payload.context),
      });
    },
    async verifyActionAsHuman(payload: HumanActionRequest): Promise<HookActionResult & { verifyTicket: string; expiresAt: string }> {
      return runtime.verifyAction({
        actionId: payload.actionId,
        input: payload.input,
        idempotencyKey: payload.idempotencyKey,
        context: buildHumanContext(payload.context),
      });
    },
    async commitActionAsHuman(payload: HumanActionRequest & { verifyTicket?: string }): Promise<HookActionResult> {
      return runtime.commitAction({
        actionId: payload.actionId,
        input: payload.input,
        idempotencyKey: payload.idempotencyKey,
        verifyTicket: payload.verifyTicket,
        context: buildHumanContext(payload.context),
      });
    },
  };
}

export async function dryRunActionAsHuman(payload: HumanActionRequest): Promise<HookActionResult> {
  return createHumanActionExecutor().dryRunActionAsHuman(payload);
}

export async function verifyActionAsHuman(payload: HumanActionRequest): Promise<HookActionResult & { verifyTicket: string; expiresAt: string }> {
  return createHumanActionExecutor().verifyActionAsHuman(payload);
}

export async function commitActionAsHuman(payload: HumanActionRequest & { verifyTicket?: string }): Promise<HookActionResult> {
  return createHumanActionExecutor().commitActionAsHuman(payload);
}
