
import { ReasonCode } from '../types/index.js';
import { RuntimeMethodIds, isRuntimeStreamMethod } from './method-ids.js';

export type RuntimeMethodLookupEntry = {
  moduleKey: keyof typeof RuntimeMethodIds;
  methodKey: string;
  stream: boolean;
};

export const PHASE2_MODULE_KEYS: ReadonlySet<string> = new Set([
  'workflow',
  'model',
  'knowledge',
  'memory',
  'agent',
  'app',
]);

export const PHASE2_AUDIT_METHOD_IDS: ReadonlySet<string> = new Set([
  RuntimeMethodIds.audit.listAuditEvents,
  RuntimeMethodIds.audit.exportAuditEvents,
  RuntimeMethodIds.audit.listUsageStats,
]);

export function parseSemverMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

export const RETRYABLE_RUNTIME_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCode.RUNTIME_UNAVAILABLE,
  ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING,
  ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING,
]);

export const RUNTIME_METHOD_LOOKUP: Readonly<Record<string, RuntimeMethodLookupEntry>> = buildRuntimeMethodLookup();

function buildRuntimeMethodLookup(): Readonly<Record<string, RuntimeMethodLookupEntry>> {
  const lookup: Record<string, RuntimeMethodLookupEntry> = {};
  const groups = Object.entries(RuntimeMethodIds) as Array<
    [keyof typeof RuntimeMethodIds, Record<string, string>]
  >;

  for (const [moduleKey, methods] of groups) {
    for (const [methodKey, methodId] of Object.entries(methods)) {
      lookup[methodId] = {
        moduleKey,
        methodKey,
        stream: isRuntimeStreamMethod(methodId),
      };
    }
  }

  return Object.freeze(lookup);
}
