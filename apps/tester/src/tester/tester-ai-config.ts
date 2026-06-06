import { inspectRuntimeReadiness, type TesterRuntimeInspection } from './tester-runtime.js';

export type TesterAIConfigSummary = {
  runtime: TesterRuntimeInspection;
  schedulingOwner: 'runtime';
  providerCatalogSurface: 'sdk.runtime.listNimiRuntimeRouteOptions';
  appLocalProviderDefaults: false;
};

export async function loadTesterAIConfigSummary(): Promise<TesterAIConfigSummary> {
  return {
    runtime: await inspectRuntimeReadiness(),
    schedulingOwner: 'runtime',
    providerCatalogSurface: 'sdk.runtime.listNimiRuntimeRouteOptions',
    appLocalProviderDefaults: false,
  };
}
