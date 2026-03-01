import type { HealthResult, ModelProfile } from '../types';
import type { ProviderAdapter } from '../providers';

export async function listModelsWithRuntimeProbe(adapter: ProviderAdapter): Promise<ModelProfile[]> {
  return adapter.listModels();
}

export async function checkModelHealthWithRuntimeProbe(
  adapter: ProviderAdapter,
  model: string,
): Promise<HealthResult> {
  return adapter.healthCheck(model);
}
