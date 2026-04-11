import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app-shell/app-store.js';

const mockSetAppSetting = vi.fn();

vi.mock('../../bridge/sqlite-bridge.js', () => ({
  getAppSetting: vi.fn(),
  setAppSetting: mockSetAppSetting,
}));

vi.mock('../../bridge/ulid.js', () => ({
  isoNow: () => '2026-04-10T10:00:00.000Z',
}));

const {
  PARENTOS_AI_SCOPE_REF,
} = await import('./parentos-ai-config.js');

const {
  getParentosAIConfigService,
} = await import('./parentos-ai-config-service.js');

describe('parentos-ai-config-service', () => {
  beforeEach(() => {
    mockSetAppSetting.mockReset();
    useAppStore.setState({ aiConfig: null });
  });

  it('returns an empty ParentOS profile catalog without app-owned profile authority', async () => {
    const profiles = await getParentosAIConfigService().aiProfile.list();

    expect(profiles).toEqual([]);
  });

  it('fails closed when applying an unknown profile', async () => {
    const result = await getParentosAIConfigService().aiProfile.apply(PARENTOS_AI_SCOPE_REF, 'family-advisor');

    expect(result).toEqual({
      success: false,
      config: null,
      failureReason: 'Profile not found: family-advisor',
      probeWarnings: [],
    });
    expect(useAppStore.getState().aiConfig).toBe(null);
    expect(mockSetAppSetting).not.toHaveBeenCalled();
  });
});
