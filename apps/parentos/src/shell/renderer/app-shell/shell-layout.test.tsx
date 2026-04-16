// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellLayout } from './shell-layout.js';
import { useAppStore } from './app-store.js';

const { setAppSettingMock } = vi.hoisted(() => ({
  setAppSettingMock: vi.fn().mockResolvedValue(undefined),
}));
const { syncParentOSLocalDataScopeMock } = vi.hoisted(() => ({
  syncParentOSLocalDataScopeMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../bridge/sqlite-bridge.js', () => ({
  setAppSetting: setAppSettingMock,
}));
vi.mock('../infra/parentos-bootstrap.js', () => ({
  syncParentOSLocalDataScope: syncParentOSLocalDataScopeMock,
}));

describe('ShellLayout', () => {
  beforeEach(() => {
    syncParentOSLocalDataScopeMock.mockReset();
    useAppStore.setState({
      bootstrapReady: true,
      familyId: 'family-1',
      activeChildId: 'child-1',
      auth: {
        status: 'authenticated',
        user: {
          id: 'user-1',
          displayName: 'Parent User',
          email: 'parent@example.com',
        },
        token: 'token',
        refreshToken: 'refresh-token',
      },
      children: [
        {
          childId: 'child-1',
          familyId: 'family-1',
          displayName: 'Mimi',
          gender: 'female',
          birthDate: '2024-01-15',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'balanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          childId: 'child-2',
          familyId: 'family-1',
          displayName: 'Niko',
          gender: 'male',
          birthDate: '2022-06-10',
          birthWeightKg: null,
          birthHeightCm: null,
          birthHeadCircCm: null,
          avatarPath: null,
          nurtureMode: 'advanced',
          nurtureModeOverrides: null,
          allergies: null,
          medicalNotes: null,
          recorderProfiles: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });

  afterEach(() => {
    useAppStore.setState({
      bootstrapReady: false,
      auth: { status: 'unauthenticated', user: null, token: '', refreshToken: '' },
      familyId: null,
      activeChildId: null,
      children: [],
    });
  });

  it('shows /reports in navigation and lets the active child switch in-place', async () => {
    const { container } = render(
      <MemoryRouter>
        <ShellLayout>
          <div>APP_CONTENT</div>
        </ShellLayout>
      </MemoryRouter>,
    );

    expect(container.querySelector('a[href="/reports"]')).toBeTruthy();
    expect(screen.getByTestId('shell-main-drag-region')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '打开账号菜单' }));
    fireEvent.click(await screen.findByRole('button', { name: /Niko/i }));

    await waitFor(() => {
      expect(useAppStore.getState().activeChildId).toBe('child-2');
    });
  });

  it('keeps sidebar overflow layers above the main content region', () => {
    const { container } = render(
      <MemoryRouter>
        <ShellLayout>
          <div>APP_CONTENT</div>
        </ShellLayout>
      </MemoryRouter>,
    );

    const shellRoot = container.firstElementChild;
    const nav = container.querySelector('nav');
    const main = container.querySelector('main');

    expect(shellRoot?.className).toContain('isolate');
    expect(nav?.className).toContain('relative');
    expect(nav?.className).toContain('z-30');
    expect(nav?.className).toContain('overflow-visible');
    expect(main?.className).toContain('z-0');
  });

  it('syncs ParentOS local data scope back to anonymous on logout', async () => {
    render(
      <MemoryRouter>
        <ShellLayout>
          <div>APP_CONTENT</div>
        </ShellLayout>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '打开账号菜单' }));
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));

    await waitFor(() => {
      expect(syncParentOSLocalDataScopeMock).toHaveBeenCalledWith(null);
    });
    expect(useAppStore.getState().auth.user).toBeNull();
  });
});
