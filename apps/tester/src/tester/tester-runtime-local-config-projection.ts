import {
  normalizeNimiRuntimeConfigLocalModelProjection,
  normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection,
  pickPreferredNimiRuntimeConfigLocalModel,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeLocalConfigProjection = {
  preferredLocalModelId: string | null;
  normalizedEndpoint: string;
  nodeProvider: string;
  nodeAvailable: boolean;
};

export function createTesterRuntimeLocalConfigProjection(): TesterRuntimeLocalConfigProjection {
  const models = [
    normalizeNimiRuntimeConfigLocalModelProjection({
      localModelId: 'tester-removed',
      model: 'tester/removed',
      capabilities: ['chat'],
      status: 'removed',
    }),
    normalizeNimiRuntimeConfigLocalModelProjection({
      localModelId: 'tester-active',
      model: 'tester/active',
      engine: 'runtime-native',
      endpoint: 'http://127.0.0.1:11434/v1///',
      capabilities: ['chat'],
      status: 'active',
    }),
  ];
  const node = normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection({
    nodeId: 'tester-chat.runtime-native',
    capability: 'chat',
    serviceId: 'tester-runtime-local',
    provider: 'runtime-local',
    adapter: 'media_native_adapter',
    available: true,
  });
  const preferred = pickPreferredNimiRuntimeConfigLocalModel({ models, capability: 'chat' });
  return {
    preferredLocalModelId: preferred?.localModelId || null,
    normalizedEndpoint: models[1]?.endpoint || '',
    nodeProvider: node.provider,
    nodeAvailable: node.available,
  };
}
