import type { ValidateFunction } from 'ajv';
import type {
  HookActionRequestContext,
  HookActionResult,
} from '../../contracts/action.js';

export function createExecutionId(actionId: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `act:${actionId}:${Date.now().toString(36)}:${suffix}`;
}

export function createVerifyTicket(actionId: string): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `verify:${actionId}:${Date.now().toString(36)}:${suffix}`;
}

export function sanitizeActionId(value: string): string {
  return String(value || '').trim();
}

export function sanitizeMode(value: string): 'delegated' | 'autonomous' {
  return value === 'autonomous' ? 'autonomous' : 'delegated';
}

export function sanitizeIsoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeResult(
  input: {
    ok: boolean;
    reasonCode?: string;
    actionHint?: string;
    output?: Record<string, unknown>;
    warnings?: string[];
  },
  executionId: string,
  traceId: string,
  executionMode: HookActionResult['executionMode'],
): HookActionResult {
  return {
    ok: Boolean(input.ok),
    reasonCode: String(input.reasonCode || (input.ok ? 'ACTION_COMMITTED' : 'ACTION_FAILED')).trim(),
    actionHint: String(input.actionHint || (input.ok ? 'none' : 'retry')).trim(),
    executionId,
    traceId,
    output: input.output && typeof input.output === 'object' && !Array.isArray(input.output)
      ? input.output
      : undefined,
    executionMode,
    warnings: Array.isArray(input.warnings)
      ? input.warnings.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
  };
}

export function toReasonText(validator: ValidateFunction): string {
  const errors = Array.isArray(validator.errors) ? validator.errors : [];
  if (errors.length <= 0) return 'schema validation failed';
  return errors
    .map((item) => {
      const instancePath = String(item.instancePath || '').trim() || '/';
      const message = String(item.message || 'invalid').trim();
      return `${instancePath}: ${message}`;
    })
    .join('; ');
}

export function assertValidContext(context: HookActionRequestContext): {
  ok: boolean;
  reasonCode?: string;
  actionHint?: string;
} {
  const principalId = String(context.principalId || '').trim();
  const subjectAccountId = String(context.subjectAccountId || '').trim();
  const mode = sanitizeMode(context.mode);
  const traceId = String(context.traceId || '').trim();

  if (!principalId || !subjectAccountId || !traceId) {
    return {
      ok: false,
      reasonCode: 'ACTION_CONTEXT_INVALID',
      actionHint: 'refresh-token',
    };
  }

  if (context.principalType === 'external-agent') {
    const issuer = String(context.issuer || '').trim();
    const authTokenId = String(context.authTokenId || '').trim();
    if (!issuer || !authTokenId) {
      return {
        ok: false,
        reasonCode: 'ACTION_CONTEXT_INVALID',
        actionHint: 'reauthorize-external-agent',
      };
    }
  }

  if (mode === 'delegated') {
    const userAccountId = String(context.userAccountId || '').trim();
    if (!userAccountId || subjectAccountId !== userAccountId) {
      return {
        ok: false,
        reasonCode: 'SUBJECT_ACCOUNT_MISMATCH',
        actionHint: 'reauthorize-delegated',
      };
    }
    return { ok: true };
  }

  const externalAccountId = String(context.externalAccountId || '').trim();
  if (!externalAccountId || subjectAccountId !== externalAccountId) {
    return {
      ok: false,
      reasonCode: 'SUBJECT_ACCOUNT_MISMATCH',
      actionHint: 'reauthorize-autonomous',
    };
  }

  return { ok: true };
}

export function makeIdempotencyKey(input: {
  principalId: string;
  actionId: string;
  idempotencyKey: string;
}): string {
  return [
    String(input.principalId || '').trim(),
    String(input.actionId || '').trim(),
    String(input.idempotencyKey || '').trim(),
  ].join('::');
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const root = value as Record<string, unknown>;
  const ordered = Object.keys(root)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [key, stableJsonValue(root[key])] as const);
  return Object.fromEntries(ordered);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const payload = encoder.encode(input);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', payload);
    return bytesToHex(new Uint8Array(digest));
  }
  return bytesToHex(payload).slice(0, 64).padEnd(64, '0');
}

export async function toInputDigest(input: Record<string, unknown>): Promise<string> {
  const canonical = JSON.stringify(stableJsonValue(input));
  return sha256Hex(canonical);
}
