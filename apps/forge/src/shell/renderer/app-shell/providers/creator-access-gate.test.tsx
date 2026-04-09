import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { CreatorAccessGate } from './creator-access-gate.js';
import { useAppStore } from './app-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

const getMyWorldAccess = vi.fn();

vi.mock('@renderer/data/world-data-client.js', () => ({
  getMyWorldAccess: (...args: unknown[]) => getMyWorldAccess(...args),
}));

const EMPTY_ACCESS = { checked: false, hasAccess: false, canCreateWorld: false, canMaintainWorld: false, records: [] };

describe('CreatorAccessGate', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState((state) => ({
      ...state,
      creatorAccess: { ...EMPTY_ACCESS },
    }));
  });

  it('renders children when the normalized access response grants access', async () => {
    getMyWorldAccess.mockResolvedValue({
      hasAccess: true,
      canCreateWorld: true,
      canMaintainWorld: true,
      records: [{ id: 'r1', userId: 'u1', scopeType: 'CREATE', canCreateWorld: true, canMaintainWorld: true, maintainRole: 'OWNER', status: 'ACTIVE', expiresAt: null }],
    });

    render(
      <I18nextProvider i18n={i18n}>
        <CreatorAccessGate>
          <div>forge-home</div>
        </CreatorAccessGate>
      </I18nextProvider>,
    );

    expect(await screen.findByText('forge-home')).toBeTruthy();
    await waitFor(() => {
      const access = useAppStore.getState().creatorAccess;
      expect(access.checked).toBe(true);
      expect(access.hasAccess).toBe(true);
      expect(access.canCreateWorld).toBe(true);
      expect(access.records).toHaveLength(1);
    });
  });

  it('renders the blocked state when the normalized access response denies access', async () => {
    getMyWorldAccess.mockResolvedValue({
      hasAccess: false,
      canCreateWorld: false,
      canMaintainWorld: false,
      records: [],
    });

    render(
      <I18nextProvider i18n={i18n}>
        <CreatorAccessGate>
          <div>forge-home</div>
        </CreatorAccessGate>
      </I18nextProvider>,
    );

    expect(await screen.findByText('Creator access is required to use Forge')).toBeTruthy();
    expect(screen.getByText('Creator access is managed outside Forge right now. Ask an admin to grant access, then re-check here.')).toBeTruthy();
    await waitFor(() => {
      const access = useAppStore.getState().creatorAccess;
      expect(access.checked).toBe(true);
      expect(access.hasAccess).toBe(false);
      expect(access.records).toHaveLength(0);
    });
  });
});
