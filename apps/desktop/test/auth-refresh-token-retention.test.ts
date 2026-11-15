import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthSlice } from '../src/shell/renderer/app-shell/providers/auth-slice';

test('setAuthSession keeps renderer auth projection token-free', () => {
  let state: Record<string, unknown> = {
    auth: {
      status: 'anonymous',
      user: null,
    },
    selectedChatId: null,
  };
  const set = (partial: unknown) => {
    const next = typeof partial === 'function'
      ? (partial as (prev: Record<string, unknown>) => Record<string, unknown>)(state)
      : (partial as Record<string, unknown>);
    state = {
      ...state,
      ...next,
    };
  };
  const slice = createAuthSlice(set as never);

  slice.setAuthSession({ id: 'u1' });
  assert.equal('token' in (state.auth as Record<string, unknown>), false);
  assert.equal('accessToken' in (state.auth as Record<string, unknown>), false);
  assert.equal('refreshToken' in (state.auth as Record<string, unknown>), false);

  slice.clearAuthSession();
  assert.equal('token' in (state.auth as Record<string, unknown>), false);
  assert.equal('accessToken' in (state.auth as Record<string, unknown>), false);
  assert.equal('refreshToken' in (state.auth as Record<string, unknown>), false);
});
