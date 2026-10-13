import assert from 'node:assert/strict';
import test from 'node:test';
import { createHomeNavigation, validateHomeDestination } from '../src/shell/renderer/app-shell/providers/home-navigation.js';
import { createDesktopRendererRuntimeConfigNavigationPort } from '../src/shell/renderer/renderer/runtime-config-navigation-port.js';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-storage-defaults.js';
import { resetRuntimePageViewport } from '../src/shell/renderer/features/runtime-config/runtime-config-page-shell.js';

test('Runtime workspace, capabilities, model section and references use one history', async () => {
  const navigation = createHomeNavigation();
  const port = createDesktopRendererRuntimeConfigNavigationPort(() => navigation);
  port.openPage('aiSettings');
  port.openCapability('text.generate');
  port.openCapability('image.generate');
  await navigation.push({ id: 'runtime', runtime: { page: 'modelLibrary', section: 'downloaded' } });
  await navigation.back();
  assert.equal(navigation.getSnapshot().current.destination.runtime?.capabilityContract, 'image.generate');
  await navigation.back();
  assert.equal(navigation.getSnapshot().current.destination.runtime?.capabilityContract, 'text.generate');
  await navigation.forward();
  await navigation.forward();
  assert.deepEqual(navigation.getSnapshot().current.destination.runtime, { page: 'modelLibrary', section: 'downloaded' });
  await navigation.back();
  port.openSetupTask('task-a');
  assert.equal(navigation.getSnapshot().current.destination.runtime?.setupTaskId, 'task-a');
  assert.equal(navigation.getSnapshot().canGoForward, false);
  port.openProfileUse({ kind: 'app', ownerAppId: 'example.app' });
  await navigation.back();
  assert.equal(navigation.getSnapshot().current.destination.runtime?.setupTaskId, 'task-a');
  port.openPage('advancedDiagnostics', { pane: 'activity' });
  assert.equal(navigation.getSnapshot().current.destination.runtime?.pane, 'activity');
  const entry = navigation.getSnapshot().current;
  port.openPage('advancedDiagnostics', { pane: 'activity' });
  assert.equal(navigation.getSnapshot().current, entry, 'repeated entry does not build a second history');
  navigation.dispose();
});

test('one-time model import is consumed once and cannot replay on history or scope reset', async () => {
  const navigation = createHomeNavigation();
  const port = createDesktopRendererRuntimeConfigNavigationPort(() => navigation);
  const action = { page: 'modelLibrary', action: 'import-model-files', focus: 'runtime-config-action-focus.model-library-import' } as const;
  port.focusAction(action); await Promise.resolve();
  assert.deepEqual(port.takeAction(), action);
  assert.equal(port.takeAction(), null);
  await navigation.back(); await navigation.forward();
  assert.equal(port.takeAction(), null);
  port.focusAction(action); navigation.reset({ id: 'home' }); await Promise.resolve();
  assert.equal(port.takeAction(), null);
  port.focusAction(action); await Promise.resolve(); await navigation.back();
  assert.equal(port.takeAction(), null, 'a pending action belongs to the exact entry that requested it');
  navigation.dispose();
});

test('Runtime destination validator refuses unknown fields and preserves explicit references', () => {
  assert.throws(() => validateHomeDestination({ id: 'runtime', runtime: { page: 'legacy' } }));
  assert.throws(() => validateHomeDestination({ id: 'runtime', runtime: { page: 'aiSettings', section: 'downloaded' } }));
  assert.throws(() => validateHomeDestination({ id: 'runtime', runtime: { page: 'modelLibrary', draft: { text: 'business data' } } }));
  assert.throws(() => validateHomeDestination({ id: 'runtime', runtime: { market: 'slot', capabilityContract: 'text.generate' } }));
  assert.deepEqual(validateHomeDestination({ id: 'runtime', runtime: { capabilityContract: 'unavailable.ref', loadoutId: 'loadout-ref' } }).runtime,
    { page: 'aiSettings', section: 'overview', capabilityContract: 'unavailable.ref', loadoutId: 'loadout-ref' });
  const state = createDefaultStateV11();
  assert.equal(state.version, 16);
  for (const field of ['activePage', 'actionFocus', 'selectedConnectorId']) assert.equal(field in state, false);
});

test('page navigation resets the shared Runtime viewport to the start', () => {
  let requested: ScrollToOptions | null = null;
  resetRuntimePageViewport({ scrollTo(options: ScrollToOptions) { requested = options; } } as Pick<HTMLDivElement, 'scrollTo'>);
  assert.deepEqual(requested, { top: 0, left: 0 });
});
