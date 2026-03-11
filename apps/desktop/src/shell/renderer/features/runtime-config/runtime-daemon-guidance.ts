import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';

const RUNTIME_BINARY_NOT_FOUND_CODE = 'RUNTIME_BRIDGE_RUNTIME_BINARY_NOT_FOUND';
const RUNTIME_BINARY_NOT_FOUND_TEXT = 'release mode requires `nimi` in PATH';

export type RuntimeDaemonIssue = {
  code: 'runtime_binary_missing';
  title: string;
  message: string;
  rawError: string;
};

function collectRuntimeDaemonErrorText(input: {
  status?: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonError?: string | null;
}): string {
  const parts = [
    String(input.runtimeDaemonError || '').trim(),
    String(input.status?.lastError || '').trim(),
  ].filter((value) => value.length > 0);
  return parts.join('\n');
}

export function describeRuntimeDaemonIssue(input: {
  status?: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonError?: string | null;
}): RuntimeDaemonIssue | null {
  const rawError = collectRuntimeDaemonErrorText(input);
  if (!rawError) {
    return null;
  }

  if (rawError.includes(RUNTIME_BINARY_NOT_FOUND_CODE) || rawError.includes(RUNTIME_BINARY_NOT_FOUND_TEXT)) {
    return {
      code: 'runtime_binary_missing',
      title: 'Nimi runtime binary not found',
      message: 'Desktop could not find the `nimi` binary. Install it or set `NIMI_RUNTIME_BINARY`, then refresh or start the runtime daemon again.',
      rawError,
    };
  }

  return null;
}
