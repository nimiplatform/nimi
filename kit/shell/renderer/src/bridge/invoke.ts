import type { JsonValue } from './types.js';
import { hasShellHostInvoke } from './env.js';
import { invokeShell } from './tauri-api.js';
import {
  isNimiStandardShellErrorEnvelope,
  type NimiStandardShellErrorEnvelope,
} from '@nimiplatform/kit/shell/capabilities';

export class BridgeError extends Error {
  readonly code?: string;
  readonly reasonCode?: string;
  readonly actionHint?: string;
  readonly source?: string;
  readonly details?: Record<string, unknown>;
  readonly envelope?: NimiStandardShellErrorEnvelope;

  constructor(
    message: string,
    public readonly command: string,
    envelope?: NimiStandardShellErrorEnvelope,
  ) {
    super(message);
    this.name = 'BridgeError';
    this.envelope = envelope;
    this.code = envelope?.code;
    this.reasonCode = envelope?.reasonCode;
    this.actionHint = envelope?.actionHint;
    this.source = envelope?.source;
    this.details = envelope?.details;
  }
}

type ShellInvokeFn = (command: string, payload?: JsonValue) => Promise<JsonValue>;

function resolveShellInvoke(): ShellInvokeFn {
  if (!hasShellHostInvoke()) {
    throw createUnavailableBridgeError('resolve');
  }
  return invokeShell;
}

export async function invoke(command: string, payload: JsonValue = {}): Promise<JsonValue> {
  if (!hasShellHostInvoke()) {
    throw createUnavailableBridgeError(command);
  }
  const shellInvoke = resolveShellInvoke();
  try {
    return await shellInvoke(command, payload);
  } catch (error) {
    const message = structuredErrorMessage(error);
    const envelope = standardEnvelopeFromError(error) ?? {
      code: 'host-internal-error',
      reasonCode: 'standard-shell-host-error-envelope-missing',
      actionHint: 'inspect_standard_shell_host_error',
      source: 'host',
      details: {
        command,
        cause: message || 'unknown host error',
      },
    };
    throw new BridgeError(message || `invoke ${command} failed`, command, envelope);
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: JsonValue,
  parseResult: (value: unknown) => T,
): Promise<T> {
  const value = await invoke(command, payload);
  try {
    return parseResult(value);
  } catch (error) {
    if (error instanceof BridgeError) {
      throw error;
    }
    throw new BridgeError(structuredErrorMessage(error) || `${command} returned invalid payload`, command, {
      code: 'invalid-payload',
      reasonCode: 'renderer-standard-shell-result-invalid',
      actionHint: 'inspect_standard_shell_host_result',
      source: 'renderer',
      details: {
        command,
        cause: structuredErrorMessage(error) || 'result parser rejected host payload',
      },
    });
  }
}

function createUnavailableBridgeError(command: string): BridgeError {
  return new BridgeError('Standard shell host invoke is not available', command, {
    code: 'capability-unavailable',
    reasonCode: 'renderer-standard-shell-host-unavailable',
    actionHint: 'install_standard_shell_host_bridge',
    source: 'renderer',
    details: { command },
  });
}

function standardEnvelopeFromError(error: unknown): NimiStandardShellErrorEnvelope | undefined {
  const parsed = parsePossibleJsonEnvelope(error);
  if (parsed !== error) {
    return standardEnvelopeFromError(parsed);
  }
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const parsedMessage = parsePossibleJsonEnvelope(record.message);
  if (parsedMessage !== record.message) {
    const fromMessage = standardEnvelopeFromError(parsedMessage);
    if (fromMessage) {
      return fromMessage;
    }
  }
  const envelope = optionalRecord(record.envelope);
  const code = normalizeStructuredText(record.code) || normalizeStructuredText(envelope?.code);
  const reasonCode = normalizeStructuredText(record.reasonCode) || normalizeStructuredText(envelope?.reasonCode);
  const actionHint = normalizeStructuredText(record.actionHint) || normalizeStructuredText(envelope?.actionHint);
  const source = normalizeStructuredText(record.source) || normalizeStructuredText(envelope?.source) || 'host';
  if (!code || !reasonCode || !actionHint) {
    return undefined;
  }
  const details = optionalRecord(record.details) ?? optionalRecord(envelope?.details);
  const candidate = {
    code: code as NimiStandardShellErrorEnvelope['code'],
    reasonCode,
    actionHint,
    source: source as NimiStandardShellErrorEnvelope['source'],
    details,
  };
  return isNimiStandardShellErrorEnvelope(candidate) ? candidate : undefined;
}

function structuredErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeStructuredText(error.message);
  }
  if (!error || typeof error !== 'object') {
    return normalizeStructuredText(error);
  }
  const record = error as Record<string, unknown>;
  const envelope = optionalRecord(record.envelope);
  const details = optionalRecord(record.details) ?? optionalRecord(envelope?.details);
  return normalizeStructuredText(record.message)
    || normalizeStructuredText(envelope?.message)
    || normalizeStructuredText(details?.cause)
    || normalizeStructuredText(details?.message);
}

function parsePossibleJsonEnvelope(value: unknown): unknown {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text.startsWith('{') || !text.endsWith('}')) {
    return value;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeStructuredText(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '[object Object]' ? '' : text;
}
