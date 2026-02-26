import type {
  HookActionDescriptorView,
  HookActionRequestContext,
} from '../contracts/action.js';
import { ReasonCode } from '@nimiplatform/sdk/types';

type SocialCheckInput = {
  descriptor: HookActionDescriptorView;
  context: HookActionRequestContext;
  input: Record<string, unknown>;
};

export type SocialCheckResolver = (input: {
  humanAccountId: string;
  agentAccountId: string;
  descriptor: HookActionDescriptorView;
  context: HookActionRequestContext;
  input: Record<string, unknown>;
}) => Promise<boolean>;

function readString(value: unknown): string {
  return String(value || '').trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveAgentAccountId(
  input: Record<string, unknown>,
  context: HookActionRequestContext,
): string {
  const direct = [
    readString(input.agentAccountId),
    readString(input.targetAgentAccountId),
    readString(input.agentId),
    readString(input.targetAgentId),
  ].find(Boolean);
  if (direct) return direct;

  const chain = Array.isArray(context.delegationChain)
    ? context.delegationChain.map((value) => readString(value)).filter(Boolean)
    : [];
  if (chain.length > 0) {
    return chain[chain.length - 1] || '';
  }

  const meta = asRecord(input.meta);
  return [
    readString(meta.agentAccountId),
    readString(meta.targetAgentAccountId),
    readString(meta.agentId),
    readString(meta.targetAgentId),
  ].find(Boolean) || '';
}

export class HookActionSocialPreconditionService {
  constructor(private readonly resolve: SocialCheckResolver | null) {
    if (!resolve) {
      // Fail-close remains enforced; warn once to surface runtime wiring mistakes.
      // eslint-disable-next-line no-console
      console.warn('[hook-action] social precondition resolver unavailable; guarded actions will deny');
    }
  }

  async evaluate(input: SocialCheckInput): Promise<{ ok: true } | {
    ok: false;
    reasonCode: string;
    actionHint: string;
  }> {
    const requirement = input.descriptor.socialPrecondition || 'none';
    if (requirement === 'none') {
      return { ok: true };
    }

    if (requirement !== 'human-agent-active') {
      return {
        ok: false,
        reasonCode: ReasonCode.SOCIAL_PRECONDITION_FAILED,
        actionHint: 'unsupported-social-precondition',
      };
    }

    const humanAccountId = readString(input.context.subjectAccountId);
    if (!humanAccountId) {
      return {
        ok: false,
        reasonCode: ReasonCode.SOCIAL_PRECONDITION_FAILED,
        actionHint: 'missing-subject-account',
      };
    }

    const agentAccountId = resolveAgentAccountId(input.input, input.context);
    if (!agentAccountId) {
      return {
        ok: false,
        reasonCode: ReasonCode.SOCIAL_PRECONDITION_FAILED,
        actionHint: 'provide-agent-account-id',
      };
    }

    if (!this.resolve) {
      return {
        ok: false,
        reasonCode: ReasonCode.SOCIAL_PRECONDITION_FAILED,
        actionHint: 'social-snapshot-unavailable',
      };
    }

    let ok = false;
    try {
      ok = await this.resolve({
        humanAccountId,
        agentAccountId,
        descriptor: input.descriptor,
        context: input.context,
        input: input.input,
      });
    } catch {
      ok = false;
    }

    if (!ok) {
      return {
        ok: false,
        reasonCode: ReasonCode.SOCIAL_PRECONDITION_FAILED,
        actionHint: 'activate-friendship',
      };
    }

    return { ok: true };
  }
}
