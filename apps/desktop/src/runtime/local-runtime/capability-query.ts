import type { LocalRuntimeModelRecord } from './types';
import { listLocalRuntimeModels } from './commands';

export type LocalRuntimeCapability =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

function supportsCapability(model: LocalRuntimeModelRecord, capability: LocalRuntimeCapability): boolean {
  return model.capabilities.some((item) => item === capability);
}

export async function queryLocalRuntimeModelsByCapability(
  capability: LocalRuntimeCapability,
): Promise<LocalRuntimeModelRecord[]> {
  const models = await listLocalRuntimeModels();
  return models.filter((model) => model.status !== 'removed' && supportsCapability(model, capability));
}
