import {
  createNimiRuntimeConfigConnectorDraft,
  normalizeNimiRuntimeConfigConnectorProjection,
  runtimeConnectorProjectionToNimiRuntimeConfigConnector,
} from '@nimiplatform/sdk/runtime';

export type TesterRuntimeConnectorProjection = {
  draftLabel: string;
  normalizedProvider: string;
  modelCount: number;
  imageCapabilityModels: string[];
  status: string;
};

export function createTesterRuntimeConnectorProjection(): TesterRuntimeConnectorProjection {
  const draft = createNimiRuntimeConfigConnectorDraft({
    id: 'tester-draft',
    vendor: 'openai_compatible',
  });
  const runtimeConnector = runtimeConnectorProjectionToNimiRuntimeConfigConnector({
    id: 'tester-cloud',
    label: 'Tester Cloud',
    vendor: 'tester',
    provider: 'tester',
    authMode: 'api_key',
    endpoint: 'https://tester.invalid/v1',
    scope: 'user',
    hasCredential: true,
    isSystemOwned: false,
    models: ['tester-text', 'tester-image'],
  });
  const normalized = normalizeNimiRuntimeConfigConnectorProjection({
    ...runtimeConnector,
    status: 'healthy',
    modelCapabilities: {
      'tester-text': ['text.generate'],
      'tester-image': ['image.generate', 'image.generate'],
    },
  });

  return {
    draftLabel: draft.label,
    normalizedProvider: normalized.provider,
    modelCount: normalized.models.length,
    imageCapabilityModels: Object.entries(normalized.modelCapabilities || {})
      .filter(([, capabilities]) => capabilities.includes('image.generate'))
      .map(([model]) => model),
    status: normalized.status,
  };
}
