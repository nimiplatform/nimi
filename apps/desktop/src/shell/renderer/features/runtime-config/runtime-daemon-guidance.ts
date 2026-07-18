import { i18n } from '@renderer/i18n';
import type { RuntimeBridgeDaemonStatus } from '@renderer/bridge';

export type RuntimeDaemonIssue = {
  code:
    | 'runtime_service_unavailable'
    | 'runtime_service_untrusted'
    | 'runtime_service_repair_required'
    | 'runtime_restarted'
    | 'process_replaced';
  title: string;
  message: string;
  rawError: string;
};

type IssueDefinition = Omit<RuntimeDaemonIssue, 'rawError'> & { marker: string };

const ISSUE_DEFINITIONS: readonly IssueDefinition[] = [
  {
    marker: 'runtime-service-repair-required',
    code: 'runtime_service_repair_required',
    title: 'Runtime service repair required',
    message: 'The signed Runtime service installation is incomplete or inconsistent. Use the signed service repair flow.',
  },
  {
    marker: 'protected-carrier-required',
    code: 'runtime_service_repair_required',
    title: 'Runtime service repair required',
    message: 'Desktop cannot establish the protected native carrier. Reinstall or repair the signed Nimi service.',
  },
  {
    marker: 'runtime-service-untrusted',
    code: 'runtime_service_untrusted',
    title: 'Runtime service identity rejected',
    message: 'The running Runtime service does not match the signed release identity. Protected access remains blocked.',
  },
  {
    marker: 'runtime-service-unavailable',
    code: 'runtime_service_unavailable',
    title: 'Runtime service unavailable',
    message: 'The independently installed Runtime service is not running or cannot be reached through its protected carrier.',
  },
  {
    marker: 'runtime-restarted',
    code: 'runtime_restarted',
    title: 'Runtime restarted',
    message: 'The old Runtime session is invalid. Desktop must establish a new verified session before continuing.',
  },
  {
    marker: 'process-replaced',
    code: 'process_replaced',
    title: 'Runtime process replaced',
    message: 'The verified Runtime process changed during use. Protected access remains blocked until re-verification succeeds.',
  },
];

function translateRuntimeDaemonText(key: string, defaultValue: string): string {
  if (!i18n.isInitialized) return defaultValue;
  return i18n.t(key, { defaultValue });
}

function collectRuntimeDaemonErrorText(input: {
  status?: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonError?: string | null;
}): string {
  return [
    String(input.runtimeDaemonError || '').trim(),
    String(input.status?.lastError || '').trim(),
  ].filter(Boolean).join('\n');
}

export function describeRuntimeDaemonIssue(input: {
  status?: RuntimeBridgeDaemonStatus | null;
  runtimeDaemonError?: string | null;
}): RuntimeDaemonIssue | null {
  const rawError = collectRuntimeDaemonErrorText(input);
  if (!rawError) return null;
  const definition = ISSUE_DEFINITIONS.find((candidate) => rawError.includes(candidate.marker));
  if (!definition) return null;
  const keyPrefix = `runtimeConfig.runtime.${definition.code}`;
  return {
    code: definition.code,
    title: translateRuntimeDaemonText(`${keyPrefix}Title`, definition.title),
    message: translateRuntimeDaemonText(`${keyPrefix}Message`, definition.message),
    rawError,
  };
}
