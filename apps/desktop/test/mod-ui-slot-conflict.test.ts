import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactNode } from 'react';

import type { UiExtensionRegistration } from '../src/shell/renderer/mod-ui/contracts';
import { SlotRegistry } from '../src/shell/renderer/mod-ui/registry/slot-registry';

function createRegistration(
  extensionId: string,
  strategy: UiExtensionRegistration['strategy'],
): UiExtensionRegistration {
  return {
    extensionId,
    modId: extensionId,
    slot: 'ui-extension.app.content.routes',
    priority: 120,
    strategy,
    render: (): ReactNode => null,
  };
}

test('same-priority append entries resolve without conflicts', () => {
  const registry = new SlotRegistry();
  registry.register(createRegistration('world.nimi.buddy', 'append'));
  registry.register(createRegistration('world.nimi.daily-outfit', 'append'));

  const resolution = registry.resolve('ui-extension.app.content.routes');

  assert.equal(resolution.append.length, 2);
  assert.deepEqual(resolution.conflicts, []);
});

test('same-priority replace entries still surface conflicts', () => {
  const registry = new SlotRegistry();
  registry.register(createRegistration('world.nimi.buddy', 'replace'));
  registry.register(createRegistration('world.nimi.daily-outfit', 'replace'));

  const resolution = registry.resolve('ui-extension.app.content.routes');

  assert.equal(resolution.replace.length, 2);
  assert.deepEqual(resolution.conflicts, [
    {
      strategy: 'replace',
      priority: 120,
      extensionIds: ['world.nimi.buddy', 'world.nimi.daily-outfit'],
    },
  ]);
});
