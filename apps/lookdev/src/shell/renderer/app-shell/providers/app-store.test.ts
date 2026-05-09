import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('lookdev app store', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // LD-SHELL-011 / LD-SHELL-012: auth slice has no app-owned token fields.
  // -------------------------------------------------------------------------

  it('auth slice never carries token fields and setAuthSession takes only the user', async () => {
    const { useAppStore } = await import('./app-store.js');

    const initial = useAppStore.getState().auth;
    expect(initial.status).toBe('bootstrapping');
    expect(initial.user).toBeNull();
    // LD-SHELL-011: token / refreshToken MUST NOT exist on the slice.
    expect(initial).not.toHaveProperty('token');
    expect(initial).not.toHaveProperty('refreshToken');

    useAppStore.getState().setAuthSession({ id: 'u1', displayName: 'Lookdev Operator' });
    const authed = useAppStore.getState().auth;
    expect(authed.status).toBe('authenticated');
    expect(authed.user).toEqual({ id: 'u1', displayName: 'Lookdev Operator' });
    expect(authed).not.toHaveProperty('token');
    expect(authed).not.toHaveProperty('refreshToken');

    useAppStore.getState().clearAuthSession();
    const cleared = useAppStore.getState().auth;
    expect(cleared.status).toBe('unauthenticated');
    expect(cleared.user).toBeNull();
    expect(cleared).not.toHaveProperty('token');
  });

  it('hydrates route settings from persisted storage', async () => {
    localStorage.setItem('nimi:lookdev:route-settings.v1', JSON.stringify({
      version: 1,
      dialogueTargetKey: 'dialogue-key',
      generationTargetKey: 'generation-key',
      evaluationTargetKey: 'evaluation-key',
    }));

    const { useAppStore } = await import('./app-store.js');

    expect(useAppStore.getState().routeSettings).toEqual({
      dialogueTargetKey: 'dialogue-key',
      generationTargetKey: 'generation-key',
      evaluationTargetKey: 'evaluation-key',
    });
  });

  it('persists route settings updates through the shared storage helper', async () => {
    const { useAppStore } = await import('./app-store.js');
    const { loadLookdevRouteSettings } = await import('./lookdev-route-settings-storage.js');

    useAppStore.getState().setDialogueTargetKey('dialogue-next');
    useAppStore.getState().setGenerationTargetKey('generation-next');
    useAppStore.getState().setEvaluationTargetKey('evaluation-next');

    expect(loadLookdevRouteSettings()).toEqual({
      dialogueTargetKey: 'dialogue-next',
      generationTargetKey: 'generation-next',
      evaluationTargetKey: 'evaluation-next',
    });
  });
});
