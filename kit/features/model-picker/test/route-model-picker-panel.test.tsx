import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UseModelPickerResult } from '../src/headless.js';
import { RouteModelPickerPanel } from '../src/ui.js';

type TestModel = {
  id: string;
  title: string;
};

const models: readonly TestModel[] = [
  { id: 'qwen3', title: 'Qwen 3' },
];

const state: UseModelPickerResult<TestModel> = {
  adapter: {
    listModels: () => models,
    getId: (model) => model.id,
    getTitle: (model) => model.title,
  },
  models,
  filteredModels: models,
  groupedModels: [{ key: 'all', label: 'All Models', models }],
  selectedId: 'qwen3',
  selectedModel: models[0] ?? null,
  isLoading: false,
  error: null,
  searchQuery: '',
  capabilityFilter: 'all',
  sourceFilter: 'all',
  capabilityOptions: [],
  sourceOptions: [],
  setSearchQuery: () => {},
  setCapabilityFilter: () => {},
  setSourceFilter: () => {},
  selectModel: () => {},
  refresh: async () => {},
};

describe('RouteModelPickerPanel', () => {
  it('renders source, connector, and model states', () => {
    const html = renderToStaticMarkup(
      <RouteModelPickerPanel
        state={state}
        sourceValue="cloud"
        sourceOptions={[
          { value: 'local', label: 'Local' },
          { value: 'cloud', label: 'Cloud' },
        ]}
        connectorValue="openai-primary"
        connectorOptions={[
          { value: 'openai-primary', label: 'OpenAI' },
        ]}
        showConnector
        selectedModelValue="qwen3"
        resolvedRouteValue="openai/qwen3"
      />,
    );

    expect(html).toContain('Source');
    expect(html).toContain('Connector');
    expect(html).toContain('Model');
    expect(html).toContain('Local');
    expect(html).toContain('Cloud');
    expect(html).toContain('Qwen 3');
    expect(html).toContain('openai/qwen3');
  });

  it('renders degraded and invalid-binding banners', () => {
    const html = renderToStaticMarkup(
      <RouteModelPickerPanel
        state={state}
        sourceValue="local"
        sourceOptions={[
          { value: 'local', label: 'Local' },
          { value: 'cloud', label: 'Cloud' },
        ]}
        banners={[
          { tone: 'warning', message: 'Saved route is no longer available.' },
          { tone: 'danger', message: 'Route discovery failed.' },
        ]}
      />,
    );

    expect(html).toContain('Saved route is no longer available.');
    expect(html).toContain('Route discovery failed.');
  });
});
