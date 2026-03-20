import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { AiConfigSection } from './ai-config-section.js';
import { useAiConfigStore } from '@renderer/state/ai-config-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

// Mock localStorage
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const listConnectors = vi.fn().mockResolvedValue({
  connectors: [
    { connectorId: 'c1', provider: 'openai', label: 'OpenAI', status: 1 },
  ],
  nextPageToken: '',
});

const healthFn = vi.fn().mockResolvedValue({ status: 'healthy' });

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      connector: {
        listConnectors,
        listConnectorModels: vi.fn().mockResolvedValue({ models: [], nextPageToken: '' }),
        testConnector: vi.fn().mockResolvedValue({ ack: {} }),
      },
      health: healthFn,
    },
  }),
}));

function renderSection() {
  return render(
    <I18nextProvider i18n={i18n}>
      <AiConfigSection />
    </I18nextProvider>,
  );
}

describe('AiConfigSection', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    useAiConfigStore.setState({
      selections: {
        text: { connectorId: '', model: 'auto', route: 'auto' },
        image: { connectorId: '', model: 'auto', route: 'auto' },
        music: { connectorId: '', model: 'auto', route: 'auto' },
      },
      runtimeStatus: 'unknown',
      connectors: [],
      connectorModels: {},
      loading: false,
      error: null,
    });
  });

  it('renders the AI Configuration heading', () => {
    renderSection();
    expect(screen.getByText('AI Configuration')).toBeTruthy();
  });

  it('shows connected status after runtime health check', async () => {
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeTruthy();
    });
  });

  it('renders capability cards for text, image, and music', () => {
    renderSection();
    expect(screen.getByText('Text Generation')).toBeTruthy();
    expect(screen.getByText('Image Generation')).toBeTruthy();
    expect(screen.getByText('Music Generation')).toBeTruthy();
  });

  it('shows unavailable when runtime health fails', async () => {
    healthFn.mockRejectedValueOnce(new Error('connection refused'));
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeTruthy();
    });
  });

  it('fetches connectors on mount', async () => {
    renderSection();
    await waitFor(() => {
      expect(listConnectors).toHaveBeenCalled();
    });
  });
});
