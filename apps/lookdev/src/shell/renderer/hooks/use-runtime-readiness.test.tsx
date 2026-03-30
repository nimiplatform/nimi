import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { useRuntimeReadiness } from './use-runtime-readiness.js';

const useQueryMock = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (input: unknown) => useQueryMock(input),
}));

function HookHost() {
  useRuntimeReadiness();
  return null;
}

describe('useRuntimeReadiness', () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: null,
    });
    useAppStore.setState({
      bootstrapReady: false,
      auth: {
        status: 'unauthenticated',
        user: null,
        token: '',
        refreshToken: '',
      },
      runtimeStatus: 'checking',
    });
  });

  it('keeps readiness probing disabled until bootstrap is ready, then refreshes when auth session changes', async () => {
    render(<HookHost />);

    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      queryKey: ['lookdev', 'runtime-ready', false, 'unauthenticated', ''],
    }));

    useAppStore.setState({
      bootstrapReady: true,
      auth: {
        status: 'authenticated',
        user: {
          id: 'user-1',
          displayName: 'Nimi Test User',
          email: 'test@nimi.xyz',
        },
        token: 'token',
        refreshToken: 'refresh',
      },
    });

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({
        enabled: true,
        queryKey: ['lookdev', 'runtime-ready', true, 'authenticated', 'user-1'],
      }));
    });
  });
});
