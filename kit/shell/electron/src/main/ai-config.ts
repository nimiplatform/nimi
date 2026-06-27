import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { normalizeText } from './paths.js';

export async function getElectronAiConfig(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly scopeRef: string; readonly config: Readonly<Record<string, unknown>> }> {
  const store = host?.aiConfigStore;
  if (!store) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const scopeRef = normalizeText(payload.scopeRef);
  if (!scopeRef) {
    throw new NimiElectronShellHostError({
      code: 'not-found',
      message: 'Electron AI Config scope was not found: <missing>',
      reasonCode: 'electron-ai-config-scope-not-found',
      actionHint: 'provide_admitted_ai_config_scope_ref',
      details: { command, scopeRef },
    });
  }
  const config = await store.get({ scopeRef });
  if (!config) {
    throw new NimiElectronShellHostError({
      code: 'not-found',
      message: `Electron AI Config scope was not found: ${scopeRef}`,
      reasonCode: 'electron-ai-config-scope-not-found',
      actionHint: 'initialize_ai_config_for_scope_before_reading',
      details: { command, scopeRef },
    });
  }
  return { scopeRef, config };
}
export async function setElectronAiConfig(
  host: NimiElectronStandardShellHost | undefined,
  payload: Readonly<Record<string, unknown>>,
  command: string,
): Promise<{ readonly scopeRef: string; readonly config: Readonly<Record<string, unknown>> }> {
  const store = host?.aiConfigStore;
  if (!store) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const scopeRef = normalizeText(payload.scopeRef);
  if (!scopeRef) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron AI Config scopeRef is required',
      reasonCode: 'electron-ai-config-scope-ref-required',
      actionHint: 'provide_admitted_ai_config_scope_ref',
      details: { command },
    });
  }
  if (!payload.config || typeof payload.config !== 'object' || Array.isArray(payload.config)) {
    throw new NimiElectronShellHostError({
      code: 'invalid-payload',
      message: 'Electron AI Config set payload requires config object',
      reasonCode: 'electron-ai-config-value-required',
      actionHint: 'provide_full_materialized_ai_config',
      details: { command, scopeRef },
    });
  }
  const config = payload.config as Readonly<Record<string, unknown>>;
  const saved = await store.set({ scopeRef, config });
  return { scopeRef, config: saved };
}
