import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelPicker,
  ModelPickerDetail,
  type ModelCatalogAdapter,
  useModelPicker,
} from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

type TestModel = {
  id: string;
  title: string;
  description: string;
  source: string;
  capabilities: string[];
  badges?: Array<{ label: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' }>;
};

const models: readonly TestModel[] = [
  { id: 'alpha-text', title: 'Alpha Text', description: 'Fast text model', source: 'builtin', capabilities: ['text.generate'] },
  { id: 'vision-pro', title: 'Vision Pro', description: 'Image model', source: 'custom', capabilities: ['image.generate'] },
  { id: 'voice-studio', title: 'Voice Studio', description: 'Speech model', source: 'builtin', capabilities: ['audio.synthesize'] },
];

const adapter: ModelCatalogAdapter<TestModel> = {
  listModels: async () => models,
  getId: (model) => model.id,
  getTitle: (model) => model.title,
  getDescription: (model) => model.description,
  getCapabilities: (model) => model.capabilities,
  getBadges: (model) => model.badges || [],
  getSource: (model) => model.source,
  getSearchText: (model) => `${model.title} ${model.description} ${(model.badges || []).map((badge) => badge.label).join(' ')}`,
  getGroupKey: (model) => model.source,
  getGroupLabel: (groupKey) => `Group: ${groupKey}`,
  getDetailRows: (model) => [
    { label: 'ID', value: model.id },
    { label: 'Source', value: model.source },
  ],
};

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function Harness() {
  const state = useModelPicker({ adapter });
  return (
    <div>
      <ModelPicker state={state} />
      <ModelPickerDetail
        state={state}
        renderActions={(model) => <button type="button">Inspect {model.id}</button>}
      />
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('ModelPicker', () => {
  it('filters by search and renders selected detail', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<Harness />);
      await flush();
      await flush();
    });

    expect(container.textContent).toContain('Alpha Text');
    expect(container.textContent).toContain('Vision Pro');
    expect(container.textContent).toContain('Group: builtin');
    expect(container.textContent).toContain('Group: custom');
    expect(container.textContent).toContain('Alpha Text');

    const searchInput = container.querySelector('input');
    expect(searchInput).toBeTruthy();
    searchInput?.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
    if (searchInput instanceof HTMLInputElement) {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(searchInput, 'vision');
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    await act(async () => {
      await flush();
      await flush();
    });

    const filteredButtons = Array.from(container.querySelectorAll('button'))
      .map((button) => button.textContent || '')
      .filter((text) => text.includes('Vision Pro') || text.includes('Alpha Text'));
    expect(filteredButtons.some((text) => text.includes('Vision Pro'))).toBe(true);
    expect(filteredButtons.some((text) => text.includes('Alpha Text'))).toBe(false);

    const buttons = Array.from(container.querySelectorAll('button'));
    const visionButton = buttons.find((button) => button.textContent?.includes('Vision Pro'));
    expect(visionButton).toBeTruthy();

    await act(async () => {
      visionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(container.textContent).toContain('Image model');
    expect(container.textContent).toContain('ID');
    expect(container.textContent).toContain('vision-pro');
    expect(container.textContent).toContain('Inspect vision-pro');
  });
});
