import type { LocalAiModelRecord } from './types';
import { listLocalAiRuntimeModels } from './commands';

export type LocalAiRuntimeCapability =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

function supportsCapability(model: LocalAiModelRecord, capability: LocalAiRuntimeCapability): boolean {
  return model.capabilities.some((item) => item === capability);
}

export async function queryLocalAiRuntimeModelsByCapability(
  capability: LocalAiRuntimeCapability,
): Promise<LocalAiModelRecord[]> {
  const models = await listLocalAiRuntimeModels();
  return models.filter((model) => model.status !== 'removed' && supportsCapability(model, capability));
}
