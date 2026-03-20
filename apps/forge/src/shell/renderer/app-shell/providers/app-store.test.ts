import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app-store.js';

describe('ForgeAppStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useAppStore.setState({
      auth: { status: 'bootstrapping', user: null, token: '', refreshToken: '' },
      bootstrapReady: false,
      bootstrapError: null,
      runtimeDefaults: null,
      creatorAccess: { checked: false, hasAccess: false },
      sidebarCollapsed: false,
    });
  });

  describe('auth', () => {
    it('starts in bootstrapping state', () => {
      const state = useAppStore.getState();
      expect(state.auth.status).toBe('bootstrapping');
      expect(state.auth.user).toBeNull();
      expect(state.auth.token).toBe('');
      expect(state.auth.refreshToken).toBe('');
    });

    it('setAuthSession transitions to authenticated', () => {
      const user = { id: 'u1', displayName: 'Test User', email: 'test@example.com' };
      useAppStore.setState({ creatorAccess: { checked: true, hasAccess: true } });
      useAppStore.getState().setAuthSession(user, 'tok123', 'ref456');

      const state = useAppStore.getState();
      expect(state.auth.status).toBe('authenticated');
      expect(state.auth.user).toEqual(user);
      expect(state.auth.token).toBe('tok123');
      expect(state.auth.refreshToken).toBe('ref456');
      expect(state.creatorAccess).toEqual({ checked: false, hasAccess: false });
    });

    it('clearAuthSession transitions to unauthenticated', () => {
      const user = { id: 'u1', displayName: 'Test' };
      useAppStore.getState().setAuthSession(user, 'tok', 'ref');
      useAppStore.setState({ creatorAccess: { checked: true, hasAccess: true } });
      useAppStore.getState().clearAuthSession();

      const state = useAppStore.getState();
      expect(state.auth.status).toBe('unauthenticated');
      expect(state.auth.user).toBeNull();
      expect(state.auth.token).toBe('');
      expect(state.creatorAccess).toEqual({ checked: false, hasAccess: false });
    });
  });

  describe('bootstrap', () => {
    it('setBootstrapReady', () => {
      useAppStore.getState().setBootstrapReady(true);
      expect(useAppStore.getState().bootstrapReady).toBe(true);
    });

    it('setBootstrapError', () => {
      useAppStore.getState().setBootstrapError('Connection failed');
      expect(useAppStore.getState().bootstrapError).toBe('Connection failed');
    });

    it('setBootstrapError can clear error', () => {
      useAppStore.getState().setBootstrapError('err');
      useAppStore.getState().setBootstrapError(null);
      expect(useAppStore.getState().bootstrapError).toBeNull();
    });
  });

  describe('creatorAccess', () => {
    it('starts unchecked', () => {
      const state = useAppStore.getState();
      expect(state.creatorAccess.checked).toBe(false);
      expect(state.creatorAccess.hasAccess).toBe(false);
    });

    it('setCreatorAccess marks checked and sets access', () => {
      useAppStore.getState().setCreatorAccess(true);
      const state = useAppStore.getState();
      expect(state.creatorAccess.checked).toBe(true);
      expect(state.creatorAccess.hasAccess).toBe(true);
    });

    it('setCreatorAccess with false marks checked without access', () => {
      useAppStore.getState().setCreatorAccess(false);
      const state = useAppStore.getState();
      expect(state.creatorAccess.checked).toBe(true);
      expect(state.creatorAccess.hasAccess).toBe(false);
    });
  });

  describe('sidebar', () => {
    it('toggleSidebar flips collapsed state', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('runtimeDefaults', () => {
    it('setRuntimeDefaults stores defaults', () => {
      const defaults = { realmBaseUrl: 'https://api.example.com', accessToken: 'tok' };
      useAppStore.getState().setRuntimeDefaults(defaults as any);
      expect(useAppStore.getState().runtimeDefaults).toEqual(defaults);
    });
  });
});
