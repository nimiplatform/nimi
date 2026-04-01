import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('lookdev app store', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
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
