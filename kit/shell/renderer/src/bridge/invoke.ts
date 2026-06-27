import type { JsonValue } from './types.js';
import { hasShellHostInvoke } from './env.js';
import { invokeShell } from './tauri-api.js';
import type { NimiStandardShellErrorEnvelope } from '@nimiplatform/kit/shell/capabilities';

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
    const message = error instanceof Error ? error.message : String(error || '');
    const envelope = standardEnvelopeFromError(error);
    throw new BridgeError(message || `invoke ${command} failed`, command, envelope);
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: JsonValue,
  parseResult: (value: unknown) => T,
): Promise<T> {
  return parseResult(await invoke(command, payload));
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
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const reasonCode = typeof record.reasonCode === 'string' ? record.reasonCode : '';
  const actionHint = typeof record.actionHint === 'string' ? record.actionHint : '';
  const source = typeof record.source === 'string' ? record.source : 'host';
  if (!code || !reasonCode || !actionHint) {
    return undefined;
  }
  return {
    code: code as NimiStandardShellErrorEnvelope['code'],
    reasonCode,
    actionHint,
    source: source as NimiStandardShellErrorEnvelope['source'],
    details: record.details && typeof record.details === 'object'
      ? record.details as Record<string, unknown>
      : undefined,
  };
}
