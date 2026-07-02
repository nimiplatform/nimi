import type { NimiRuntimeAgentScopeRunner } from '@nimiplatform/sdk/runtime';

const ZHIYU_ELECTRON_RUNTIME_PROTECTED_SCOPES = [
  'runtime.agent.read',
  'runtime.agent.write',
  'runtime.agent.turn.read',
  'runtime.agent.turn.write',
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
  'ai.spend.meter',
] as const;

export const withZhiyuElectronRuntimeProtectedScopes: NimiRuntimeAgentScopeRunner = async (
  scopes,
  operation,
) => {
  assertZhiyuRuntimeProtectedScopes(scopes);
  return operation({});
};

export function assertZhiyuRuntimeProtectedScopes(scopes: readonly string[]): void {
  const allowed = new Set<string>(ZHIYU_ELECTRON_RUNTIME_PROTECTED_SCOPES);
  const unsupported = [...new Set(scopes.map(normalizeText).filter(Boolean))]
    .filter((scope) => !allowed.has(scope));
  if (unsupported.length > 0) {
    const error = new Error(
      `Zhiyu Electron Runtime protected access does not include scopes: ${unsupported.join(', ')}`,
    ) as Error & {
      readonly reasonCode: string;
      readonly actionHint: string;
      readonly source: string;
    };
    Object.assign(error, {
      reasonCode: 'PRINCIPAL_UNAUTHORIZED',
      actionHint: 'register_zhiyu_runtime_protected_scope',
      source: 'runtime',
    });
    throw error;
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
