import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runReadOnlyAppsAction } from '../src/shell/renderer/features/apps/apps-panel-controller.js';

describe('Desktop Apps controller action boundary', () => {
  it('routes sign-in only through the Desktop account gate', () => {
    let calls = 0;
    runReadOnlyAppsAction('sign_in', { requestSignIn: () => { calls += 1; } });
    assert.equal(calls, 1);
  });

  it('treats details as renderer-only view state', () => {
    assert.doesNotThrow(() => runReadOnlyAppsAction('details'));
  });

  it('fails closed if an untyped lifecycle action reaches the controller', () => {
    const unsafe = runReadOnlyAppsAction as unknown as (action: string) => void;
    assert.throws(() => unsafe('open'), /Unsupported Apps action/);
    assert.throws(() => unsafe('install'), /Unsupported Apps action/);
  });

  it('fails closed when sign-in has no shell account gate', () => {
    assert.throws(() => runReadOnlyAppsAction('sign_in'), /Desktop account gate/);
  });
});
