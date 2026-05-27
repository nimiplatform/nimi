import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useLookdevRouteSettings } from './use-lookdev-route-settings.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || 'Local Runtime',
  }),
}));

describe('useLookdevRouteSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      runtimeDefaults: null,
      runtimeProbe: {
        realmConfigured: true,
        realmAuthenticated: true,
        textDefaultTargetKey: undefined,
        textConnectorId: undefined,
        textModelId: undefined,
        imageDefaultTargetKey: undefined,
        imageConnectorId: undefined,
        imageModelId: undefined,
        visionDefaultTargetKey: undefined,
        visionConnectorId: undefined,
        visionModelId: undefined,
        textTargets: [],
        imageTargets: [],
        visionTargets: [],
        issues: [],
      },
      routeSettings: {
        dialogueTargetKey: 'text.generate::cloud::gemini::gemini-3-flash-preview::',
        generationTargetKey: 'image.generate::cloud::gemini::gemini-3.1-flash-image-preview::',
        evaluationTargetKey: 'text.generate.vision::cloud::gemini::gemini-3-flash-preview::',
      },
    });
  });

  it('does not overwrite persisted route settings before runtime targets load', () => {
    renderHook(() => useLookdevRouteSettings());

    expect(useAppStore.getState().routeSettings).toEqual({
      dialogueTargetKey: 'text.generate::cloud::gemini::gemini-3-flash-preview::',
      generationTargetKey: 'image.generate::cloud::gemini::gemini-3.1-flash-image-preview::',
      evaluationTargetKey: 'text.generate.vision::cloud::gemini::gemini-3-flash-preview::',
    });
  });
});
