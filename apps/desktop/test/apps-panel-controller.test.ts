import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runReadOnlyAppsAction } from '../src/shell/renderer/features/apps/apps-panel-controller.js';

describe('Desktop Apps controller action boundary', () => {
  it('treats details as renderer-only view state', () => {
    assert.doesNotThrow(() => runReadOnlyAppsAction('details'));
  });

  it('fails closed if an untyped lifecycle action reaches the controller', () => {
    const unsafe = runReadOnlyAppsAction as unknown as (action: string) => void;
    assert.throws(() => unsafe('open'), /Unsupported Apps action/);
    assert.throws(() => unsafe('install'), /Unsupported Apps action/);
    assert.throws(() => unsafe('update'), /Unsupported Apps action/);
    assert.throws(() => unsafe('repair'), /Unsupported Apps action/);
  });
});
