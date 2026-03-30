import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLocale, i18n, initI18n, LOCALE_STORAGE_KEY } from '@renderer/i18n/index.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevStore } from '@renderer/features/lookdev/lookdev-store.js';
import { LookdevLayout } from './lookdev-layout.js';

vi.mock('@renderer/hooks/use-runtime-readiness.js', () => ({
  useRuntimeReadiness: vi.fn(),
}));

function renderLayout() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LookdevLayout />}>
            <Route index element={<div>outlet content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('LookdevLayout', () => {
  beforeEach(async () => {
    localStorage.clear();
    await initI18n();
    await changeLocale('en');
    useAppStore.setState({
      bootstrapReady: true,
      runtimeStatus: 'ready',
      runtimeProbe: {
        realmConfigured: true,
        realmAuthenticated: true,
        textDefaultTargetKey: 'text.generate::cloud::text-connector::text-model::',
        textConnectorId: 'text-connector',
        textModelId: 'text-model',
        imageDefaultTargetKey: 'image.generate::cloud::image-connector::image-model::',
        imageConnectorId: 'image-connector',
        imageModelId: 'image-model',
        visionDefaultTargetKey: 'text.generate.vision::cloud::vision-connector::vision-model::',
        visionConnectorId: 'vision-connector',
        visionModelId: 'vision-model',
        textTargets: [{
          key: 'text.generate::cloud::text-connector::text-model::',
          source: 'cloud',
          route: 'cloud',
          connectorId: 'text-connector',
          connectorLabel: 'Text Connector',
          endpoint: 'https://text.example.com/v1',
          provider: 'openai',
          modelId: 'text-model',
          modelLabel: 'Text Model',
          capability: 'text.generate',
        }],
        imageTargets: [{
          key: 'image.generate::cloud::image-connector::image-model::',
          source: 'cloud',
          route: 'cloud',
          connectorId: 'image-connector',
          connectorLabel: 'Image Connector',
          endpoint: 'https://image.example.com/v1',
          provider: 'openai',
          modelId: 'image-model',
          modelLabel: 'Image Model',
          capability: 'image.generate',
        }],
        visionTargets: [{
          key: 'text.generate.vision::cloud::vision-connector::vision-model::',
          source: 'cloud',
          route: 'cloud',
          connectorId: 'vision-connector',
          connectorLabel: 'Vision Connector',
          endpoint: 'https://vision.example.com/v1',
          provider: 'openai',
          modelId: 'vision-model',
          modelLabel: 'Vision Model',
          capability: 'text.generate.vision',
        }],
        issues: ['missing provider metadata', 'stale vision target'],
      },
      auth: {
        status: 'authenticated',
        user: {
          id: 'u1',
          displayName: 'Nimi Test User',
          email: 'test@nimi.xyz',
        },
        token: 'token',
        refreshToken: 'refresh',
      },
    });
    useLookdevStore.setState({
      resumeActiveBatches: vi.fn(async () => {}),
    });
  });

  it('renders english navigation, operator card, and runtime badge', async () => {
    renderLayout();

    expect(screen.getByText('Batch Control Plane')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Batch List' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create Batch' })).toBeInTheDocument();
    expect(screen.getByText('Nimi Test User')).toBeInTheDocument();
    expect(screen.getByText('test@nimi.xyz')).toBeInTheDocument();
    expect(screen.getByText(/Runtime ready/i)).toBeInTheDocument();
    expect(screen.getByText(/2 issues/i)).toBeInTheDocument();
    expect(screen.getByText('outlet content')).toBeInTheDocument();

    await waitFor(() => {
      expect(useLookdevStore.getState().resumeActiveBatches).toHaveBeenCalledTimes(1);
    });
  });

  it('switches locale to zh and persists the selection', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole('button', { name: '简体中文' }));

    expect(await screen.findByRole('link', { name: '批次列表' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '创建批次' })).toBeInTheDocument();
    expect(screen.getByText('语言')).toBeInTheDocument();
    expect(screen.getByText(/运行时/)).toBeInTheDocument();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
