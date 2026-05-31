import {
  normalizeRuntimeConfigLocalModelProjection,
  normalizeRuntimeConfigLocalNodeMatrixEntryProjection,
  pickPreferredRuntimeConfigLocalModel,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeLocalConfigProjection = {
  preferredLocalModelId: string | null;
  normalizedEndpoint: string;
  nodeProvider: string;
  nodeAvailable: boolean;
};

export function createTesterRuntimeLocalConfigProjection(): TesterRuntimeLocalConfigProjection {
  const models = [
    normalizeRuntimeConfigLocalModelProjection({
      localModelId: 'tester-removed',
      model: 'tester/removed',
      capabilities: ['chat'],
      status: 'removed',
    }),
    normalizeRuntimeConfigLocalModelProjection({
      localModelId: 'tester-active',
      model: 'tester/active',
      engine: 'llama',
      endpoint: 'http://127.0.0.1:11434/v1///',
      capabilities: ['chat'],
      status: 'active',
    }),
  ];
  const node = normalizeRuntimeConfigLocalNodeMatrixEntryProjection({
    nodeId: 'tester-chat.llama',
    capability: 'chat',
    serviceId: 'tester-runtime-local',
    provider: 'LLAMA',
    adapter: 'llama_native_adapter',
    available: true,
  });
  const preferred = pickPreferredRuntimeConfigLocalModel({ models, capability: 'chat' });
  return {
    preferredLocalModelId: preferred?.localModelId || null,
    normalizedEndpoint: models[1]?.endpoint || '',
    nodeProvider: node.provider,
    nodeAvailable: node.available,
  };
}
