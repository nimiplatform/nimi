import { ReasonCode } from '@nimiplatform/sdk/types';
import { hasTauriInvoke, tauriInvoke } from '../llm-adapter/tauri-bridge';
import { emitRuntimeLog } from '../telemetry/logger';
import type { LocalAiRuntimeWriteOptions } from './types';
import { asRecord, asString } from './parser-primitives';

type TauriEventUnsubscribe = () => void;
type TauriEventListen = (
  eventName: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<TauriEventUnsubscribe | undefined> | TauriEventUnsubscribe | undefined;

function decodeProtoDynamic(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => decodeProtoDynamic(item));
  }
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return value;
  }
  const kind = asRecord(record.kind);
  const oneofKind = asString(kind.oneofKind);
  switch (oneofKind) {
    case 'nullValue':
      return null;
    case 'numberValue':
      return typeof kind.numberValue === 'number' ? kind.numberValue : Number(kind.numberValue || 0);
    case 'stringValue':
      return asString(kind.stringValue);
    case 'boolValue':
      return Boolean(kind.boolValue);
    case 'structValue':
      return decodeProtoDynamic(kind.structValue);
    case 'listValue': {
      const values = Array.isArray(asRecord(kind.listValue).values)
        ? (asRecord(kind.listValue).values as unknown[])
        : [];
      return values.map((item) => decodeProtoDynamic(item));
    }
    default:
      break;
  }
  const fields = asRecord(record.fields);
  if (Object.keys(fields).length > 0 && Object.keys(record).every((key) => key === 'fields')) {
    return Object.fromEntries(
      Object.entries(fields).map(([key, entry]) => [key, decodeProtoDynamic(entry)]),
    );
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodeProtoDynamic(entry)]),
  );
}

export function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  const decoded = decodeProtoDynamic(value);
  const record = asRecord(decoded);
  return Object.keys(record).length > 0 ? record : undefined;
}

export function readGlobalTauriEventListen(): TauriEventListen | null {
  const value = globalThis as {
    window?: {
      __TAURI__?: {
        event?: {
          listen?: TauriEventListen;
        };
      };
    };
    __TAURI__?: {
      event?: {
        listen?: TauriEventListen;
      };
    };
  };
  const fromWindow = value.window?.__TAURI__?.event?.listen;
  if (typeof fromWindow === 'function') {
    return fromWindow.bind(value.window?.__TAURI__?.event);
  }
  const fromGlobal = value.__TAURI__?.event?.listen;
  if (typeof fromGlobal === 'function') {
    return fromGlobal.bind(value.__TAURI__?.event);
  }
  return null;
}

export function normalizeCaller(caller: LocalAiRuntimeWriteOptions['caller']): string {
  return asString(caller || 'core').toLowerCase() || 'core';
}

export function assertLifecycleWriteAllowed(
  command: string,
  caller: LocalAiRuntimeWriteOptions['caller'],
): void {
  const normalizedCaller = normalizeCaller(caller);
  if (normalizedCaller === 'core') return;

  emitRuntimeLog({
    level: 'warn',
    area: 'local-ai-runtime-audit',
    message: 'fallback:local-runtime-lifecycle-write-denied',
    details: {
      command,
      caller: normalizedCaller,
      decision: 'DENY',
      reasonCode: ReasonCode.LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED,
    },
  });
  throw new Error(`LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED: caller=${normalizedCaller}`);
}

export async function invokeLocalAiCommand<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!hasTauriInvoke()) {
    throw new Error('LOCAL_AI_TAURI_INVOKE_UNAVAILABLE: tauriInvoke is not available');
  }
  return tauriInvoke<T>(command, args);
}
