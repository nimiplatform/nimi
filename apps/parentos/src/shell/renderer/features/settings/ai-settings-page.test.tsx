// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';
import AiSettingsPage from './ai-settings-page.js';

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({
    runtime: {
      appId: 'app.nimi.parentos',
    },
  }),
}));

describe('AiSettingsPage', () => {
  beforeEach(() => {
    useAppStore.setState({
      aiConfig: null,
    });
  });

  afterEach(() => {
    useAppStore.setState({
      aiConfig: null,
    });
  });

  function renderPage() {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    return render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <MemoryRouter>
            <AiSettingsPage />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
  }

  it('renders the AI settings shell backed by ModelConfigAiModelHub', async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText('AI 模型设置')).toBeTruthy();
    });

    // Three ParentOS capability sections surfaced via the canonical catalog.
    // Sections come from ModelConfigAiModelHub and resolve to i18n keys
    // ModelConfig.section.{chat,stt}.title (text.generate + text.generate.vision
    // both fall in 'chat'; audio.transcribe is in 'stt').
    await waitFor(() => {
      expect(container.textContent).toContain('ModelConfig.section.chat.title');
      expect(container.textContent).toContain('ModelConfig.section.stt.title');
    });
  });

  it('renders exactly one ProfileConfigSection (Import AI Profile) at the hub header', async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText('AI 模型设置')).toBeTruthy();
    });

    // The hub's import-button variant emits a single Import AI Profile trigger.
    const importTriggers = Array.from(container.querySelectorAll('button'))
      .filter((button) => button.textContent?.includes('ModelConfig.profile.importLabel'));
    expect(importTriggers.length).toBe(1);
  });

  it('enables exactly the three ParentOS canonical capabilities (no image/video/voice/embed/world sections)', async () => {
    const { container } = renderPage();

    await waitFor(() => {
      expect(screen.getByText('AI 模型设置')).toBeTruthy();
    });

    // Sections that must NOT render because their capability ids are not enabled.
    expect(container.textContent).not.toContain('ModelConfig.section.tts.title');
    expect(container.textContent).not.toContain('ModelConfig.section.image.title');
    expect(container.textContent).not.toContain('ModelConfig.section.video.title');
    expect(container.textContent).not.toContain('ModelConfig.section.voice.title');
    expect(container.textContent).not.toContain('ModelConfig.section.embed.title');
    expect(container.textContent).not.toContain('ModelConfig.section.world.title');
  });
});
