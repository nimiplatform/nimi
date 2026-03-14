import { i18n } from '@renderer/i18n';
import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';

const RUNTIME_BINARY_NOT_FOUND_CODE = 'RUNTIME_BRIDGE_BUNDLED_RUNTIME_UNAVAILABLE';
const RUNTIME_BINARY_MISSING_CODE = 'RUNTIME_BRIDGE_BUNDLED_RUNTIME_MISSING';
const RUNTIME_BINARY_NOT_FOUND_TEXT = 'release mode requires a bundled runtime staged under ~/.nimi/runtime';

export type RuntimeDaemonIssue = {
  code: 'runtime_binary_missing';
  title: string;
  message: string;
  rawError: string;
};

function translateRuntimeDaemonText(
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>,
): string {
  if (!i18n.isInitialized) {
    return defaultValue;
  }
  return i18n.t(key, {
    defaultValue,
    ...(options || {}),
  });
}

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

  if (
    rawError.includes(RUNTIME_BINARY_NOT_FOUND_CODE)
    || rawError.includes(RUNTIME_BINARY_MISSING_CODE)
    || rawError.includes(RUNTIME_BINARY_NOT_FOUND_TEXT)
  ) {
    return {
      code: 'runtime_binary_missing',
      title: translateRuntimeDaemonText(
        'runtimeConfig.runtime.runtimeBinaryMissingTitle',
        'Bundled runtime is unavailable',
      ),
      message: translateRuntimeDaemonText(
        'runtimeConfig.runtime.runtimeBinaryMissingMessage',
        'Desktop could not stage the bundled `nimi` runtime. Restart the app or reinstall this desktop release.',
      ),
      rawError,
    };
  }

  return null;
}
