import { beforeEach, expect, it, vi } from 'vitest';
const status = vi.hoisted(() => vi.fn());
vi.mock('../src/shell/auth/local-app-client.js', () => ({ getNimiLocalAppClient: () => ({ auth: { status } }) }));
import { clearTargetRuntimeGate, resolveTargetRuntimeGate } from '../src/shell/workbench-target-adapter.js';

beforeEach(() => { status.mockReset(); clearTargetRuntimeGate(); });

it('preserves structured carrier refusals and re-queries after clearing', async () => {
  const failure = { reasonCode: 'runtime-service-untrusted', message: 'Identity rejected', actionHint: 'restart_fixed_runtime_service', retryable: false };
  status.mockRejectedValueOnce(failure).mockResolvedValueOnce({ sessionBound: true, reasonCode: 'ready' });
  expect(await resolveTargetRuntimeGate()).toMatchObject({ status: 'unavailable', ...failure });
  expect(await resolveTargetRuntimeGate()).toMatchObject({ status: 'unavailable', ...failure });
  expect(status).toHaveBeenCalledTimes(1);
  clearTargetRuntimeGate();
  expect(await resolveTargetRuntimeGate()).toEqual({ status: 'ready' });
  expect(status).toHaveBeenCalledTimes(2);
});

it('preserves a non-bound session and does not invent a sign-in requirement or next action', async () => {
  status.mockResolvedValue({ state: 'unavailable', sessionBound: false, reasonCode: 'runtime-unauthenticated', actionHint: 'open_request_empty_local_app_session', retryable: false });
  expect(await resolveTargetRuntimeGate()).toMatchObject({ status: 'unavailable', reasonCode: 'runtime-unauthenticated', actionHint: 'open_request_empty_local_app_session', retryable: false });
  clearTargetRuntimeGate();
  status.mockRejectedValue(new Error('Unexpected transport error'));
  expect(await resolveTargetRuntimeGate()).toMatchObject({ status: 'unavailable', reasonCode: 'connection-check-failed', message: 'Unexpected transport error', actionHint: undefined });
});
