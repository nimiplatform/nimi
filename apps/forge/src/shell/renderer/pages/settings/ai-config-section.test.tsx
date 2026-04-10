import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { AiConfigSection } from './ai-config-section.js';
import { useAiConfigStore } from '@renderer/state/ai-config-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});

const healthFn = vi.fn().mockResolvedValue({ status: 'healthy' });

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: { health: healthFn },
  }),
}));

vi.mock('@nimiplatform/sdk/mod', () => ({
  createModRuntimeClient: () => ({
    route: {
      listOptions: vi.fn().mockResolvedValue({
        capability: 'text.generate',
        selected: null,
        local: {
          models: [
            { localModelId: 'qwen3-4b', model: 'Qwen3-4B-Q4', engine: 'llama', status: 'active', capabilities: ['text.generate'] },
          ],
        },
        connectors: [],
      }),
    },
  }),
  createEmptyAIConfig: (scopeRef?: { kind: string; ownerId: string; surfaceId?: string }) => ({
    scopeRef: scopeRef || { kind: 'app', ownerId: 'forge', surfaceId: 'settings' },
    capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
    profileOrigin: null,
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
      aiConfig: {
        scopeRef: { kind: 'app', ownerId: 'forge', surfaceId: 'settings' },
        capabilities: { selectedBindings: {}, localProfileRefs: {}, selectedParams: {} },
        profileOrigin: null,
      },
      runtimeStatus: 'unknown',
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

  it('renders capability section titles for chat, image, music, and tts', () => {
    renderSection();
    expect(screen.getByText('Chat Model')).toBeTruthy();
    expect(screen.getByText('Image Model')).toBeTruthy();
    expect(screen.getByText('Music Model')).toBeTruthy();
    expect(screen.getByText('TTS Model')).toBeTruthy();
  });

  it('does not render Preview badge — all capabilities are stable', () => {
    renderSection();
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('shows unavailable when runtime health fails', async () => {
    healthFn.mockRejectedValueOnce(new Error('connection refused'));
    renderSection();
    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeTruthy();
    });
  });

  it('renders source toggle buttons for each capability', async () => {
    renderSection();
    await waitFor(() => {
      const localButtons = screen.getAllByText('Local');
      const cloudButtons = screen.getAllByText('Cloud');
      expect(localButtons.length).toBeGreaterThanOrEqual(4);
      expect(cloudButtons.length).toBeGreaterThanOrEqual(4);
    });
  });
});
