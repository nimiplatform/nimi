import type { NimiError } from '@nimiplatform/sdk/types';
import {
  getShellBridgeUserMessageProjection,
  hasElectronInvoke,
  invokeShell,
  toShellBridgeNimiError,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { emitRendererLog, resolveRendererSessionTraceId, toRendererLogMessage } from '@nimiplatform/kit/telemetry';
import { parseOptionalJsonObject } from './shared.js';
import type { JsonObject } from './types';

function translateBridgeMessage(key: string, defaultValue: string): string {
  void key;
  return defaultValue;
}

export function toBridgeUserMessage(error: unknown): string {
  const projection = getShellBridgeUserMessageProjection(error);
  return translateBridgeMessage(projection.key, projection.defaultValue);
}

// @nimi-authority: definition.nimi.desktop.shell-ui.error-boundary
// @nimi-authority: rule.nimi.desktop.bridge-ipc.r016
// @nimi-authority: rule.nimi.desktop.shell-ui.r073
export function toBridgeNimiError(error: unknown): NimiError {
  return toShellBridgeNimiError(error, { translate: translateBridgeMessage });
}

function summarizeInvokePayload(command: string, payload: unknown): JsonObject {
  if (command !== 'http_request') {
    return {};
  }

  const root = parseOptionalJsonObject(payload) || {};
  const inner = parseOptionalJsonObject(root.payload) || {};
  const url = String(inner.url || '').trim();
  const method = String(inner.method || 'GET').toUpperCase();
  const body = typeof inner.body === 'string' ? inner.body : '';

  return {
    requestUrl: url,
    requestMethod: method,
    requestBodyBytes: body.length,
  };
}

type ShellInvokeFn = (command: string, payload?: unknown) => Promise<unknown>;

function resolveShellInvoke(): ShellInvokeFn {
  if (!hasElectronInvoke()) {
    throw toBridgeNimiError(new Error('RUNTIME_UNAVAILABLE'));
  }
  return invokeShell;
}

function createSecureInvokeId(command: string): string {
  if (typeof globalThis.crypto === 'undefined') {
    throw new Error('Secure random generator is unavailable');
  }
  const secureCrypto = globalThis.crypto;
  if (typeof secureCrypto.randomUUID === 'function') {
    return `${command}-${secureCrypto.randomUUID().replace(/-/g, '')}`;
  }
  const bytes = new Uint8Array(12);
  secureCrypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${command}-${suffix}`;
}

// @nimi-authority: definition.nimi.desktop.bridge-ipc.invoke-infrastructure
// @nimi-authority: definition.nimi.desktop.shell-ui.telemetry
// @nimi-authority: rule.nimi.desktop.shell-ui.r094
export async function invoke(command: string, payload: unknown = {}): Promise<unknown> {
  const startedAt = performance.now();
  if (!hasElectronInvoke()) {
    throw toBridgeNimiError(new Error('RUNTIME_UNAVAILABLE'));
  }
  const shellInvoke = resolveShellInvoke();
  const invokeId = createSecureInvokeId(command);
  const sessionTraceId = resolveRendererSessionTraceId();
  const payloadSummary = summarizeInvokePayload(command, payload);
  const commandLog = {
    level: 'info' as const,
    area: 'bridge',
    message: toRendererLogMessage(`action:invoke-start:${command}`),
    details: {
      invokeId,
      command,
      hasPayload: Boolean(payload),
      sessionTraceId,
      ...payloadSummary,
      },
  };
  void emitRendererLog(commandLog);
  try {
    const result = await shellInvoke(command, payload);
    const costMs = Number((performance.now() - startedAt).toFixed(2));
    void emitRendererLog({
      level: 'debug',
      area: 'bridge',
      message: toRendererLogMessage(`action:invoke-success:${command}`),
      details: {
        invokeId,
        command,
        costMs,
        sessionTraceId,
        ...payloadSummary,
      },
      costMs,
    });
    return result;
  } catch (error) {
    const bridgeError = toBridgeNimiError(error);
    const costMs = Number((performance.now() - startedAt).toFixed(2));
    const rawMessage = String(bridgeError.details?.rawMessage || bridgeError.message || '').trim();
    void emitRendererLog({
      level: 'error',
      area: 'bridge',
      message: toRendererLogMessage(`action:invoke-failed:${command}`),
      details: {
        invokeId,
        command,
        costMs,
        sessionTraceId,
        ...payloadSummary,
        reasonCode: bridgeError.reasonCode,
        actionHint: bridgeError.actionHint,
        traceId: bridgeError.traceId || null,
        retryable: bridgeError.retryable,
        rawMessage,
        userMessage: bridgeError.details?.userMessage,
      },
      costMs,
    });
    throw bridgeError;
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: unknown,
  parseResult: (value: unknown) => T,
): Promise<T> {
  return parseResult(await invoke(command, payload));
}
