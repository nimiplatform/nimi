/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import type { RuntimeDefaults } from '@renderer/bridge/types.js';
import SettingsPage from './settings-page.js';

const runtimeModelPickerPanelMock = vi.fn((_props: unknown) => <div data-testid="runtime-model-picker-panel" />);
const useRuntimeModelPickerPanelMock = vi.fn((_options: unknown) => ({ models: [] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./parent-mode-panel.js', () => ({
  ParentModePanel: () => <div data-testid="parent-mode-panel" />,
}));

vi.mock('@nimiplatform/nimi-kit/features/model-picker/ui', () => ({
  RuntimeModelPickerPanel: (props: unknown) => runtimeModelPickerPanelMock(props),
}));

vi.mock('@nimiplatform/nimi-kit/features/model-picker/runtime', () => ({
  useRuntimeModelPickerPanel: (options: unknown) => useRuntimeModelPickerPanelMock(options),
}));

const BASE_RUNTIME_DEFAULTS: RuntimeDefaults = {
  realm: {
    realmBaseUrl: 'https://realm.example.com',
    realtimeUrl: '',
    accessToken: '',
    jwksUrl: 'https://realm.example.com/api/auth/jwks',
    jwtIssuer: 'https://realm.example.com',
    jwtAudience: 'nimi-runtime',
  },
  runtime: {
    localProviderEndpoint: '',
    localProviderModel: '',
    localOpenAiEndpoint: '',
    connectorId: '',
    targetType: '',
    targetAccountId: '',
    agentId: '',
    worldId: '',
    provider: '',
    userConfirmedUpload: false,
  },
};

describe('SettingsPage', () => {
  beforeEach(() => {
    runtimeModelPickerPanelMock.mockClear();
    useRuntimeModelPickerPanelMock.mockClear();
    useAppStore.setState({
      runtimeDefaults: BASE_RUNTIME_DEFAULTS,
      aiModel: '',
    });
  });

  it('shows a hard-cut unavailable message when provider catalog is absent', () => {
    render(<SettingsPage />);
    expect(screen.getByText('当前无可用的模型目录。')).toBeTruthy();
    expect(runtimeModelPickerPanelMock).not.toHaveBeenCalled();
  });
});
