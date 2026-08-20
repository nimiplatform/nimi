import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertAppsAction } from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import { actionPlanForLocalDevelopmentEntry } from '../src/shell/renderer/features/apps/apps-card-actions.js';

describe('Desktop Apps controller action boundary', () => {
  it('maps stopped development apps to launch and running apps to stop', () => {
    assert.equal(actionPlanForLocalDevelopmentEntry(null).primary?.id, 'launch');
    assert.equal(actionPlanForLocalDevelopmentEntry('running').primary?.id, 'stop');
    assert.equal(actionPlanForLocalDevelopmentEntry('launcher-disconnected').primary?.id, 'launch');
  });

  it('fails closed if an untyped lifecycle action reaches the controller', () => {
    const unsafe = assertAppsAction as unknown as (action: string) => void;
    assert.throws(() => unsafe('install'), /Unsupported Apps action/);
    assert.throws(() => unsafe('update'), /Unsupported Apps action/);
    assert.throws(() => unsafe('repair'), /Unsupported Apps action/);
  });
});
