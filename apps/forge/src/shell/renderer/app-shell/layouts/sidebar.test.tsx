import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { Sidebar } from './sidebar.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

describe('Sidebar', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      sidebarCollapsed: false,
    }));
  });

  it('highlights the workbench-first navigation and keeps non-core items out of the primary groups', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <Sidebar />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText('Workbench')).toBeTruthy();
    expect(screen.getByText('Worlds')).toBeTruthy();
    expect(screen.getByText('Agents')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Content')).toBeTruthy();
    expect(screen.getByText('Publish')).toBeTruthy();
    expect(screen.queryByText('Import')).toBeNull();
    expect(screen.queryByText('Revenue')).toBeNull();
  });
});
