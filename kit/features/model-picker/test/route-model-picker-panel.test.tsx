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
  it('renders source tabs, connector select, and selected model', () => {
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

    // Source tabs render as buttons with labels
    expect(html).toContain('Local');
    expect(html).toContain('Cloud');
    // Connector select renders via SelectField (Radix uses hidden <select>)
    expect(html).toContain('select');
    // Model selector shows the selected model value
    expect(html).toContain('qwen3');
  });

  it('renders loading state when loading is true', () => {
    const html = renderToStaticMarkup(
      <RouteModelPickerPanel
        state={state}
        sourceValue="local"
        sourceOptions={[
          { value: 'local', label: 'Local' },
          { value: 'cloud', label: 'Cloud' },
        ]}
        loading
        loadingMessage="Loading models..."
      />,
    );

    expect(html).toContain('Loading models...');
    // Source tabs should NOT render when loading
    expect(html).not.toContain('Local');
  });

  it('renders unavailable state when unavailable is true', () => {
    const html = renderToStaticMarkup(
      <RouteModelPickerPanel
        state={state}
        sourceValue="local"
        sourceOptions={[
          { value: 'local', label: 'Local' },
          { value: 'cloud', label: 'Cloud' },
        ]}
        unavailable
        unavailableMessage="Route options unavailable."
      />,
    );

    expect(html).toContain('Route options unavailable.');
    expect(html).not.toContain('Local');
  });
});
