import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { generateEffectCatalog } from '../../build/generate-effect-catalog.mjs';
import { createSimulatorStateEngine } from '../../src/state-engine/engine.ts';
import { createGlobalListenerCoordinator } from '../../src/shell/global-coordinator.ts';
import {
  SIMULATOR_OVERLAY_Z_INDEX_BASE,
  createSimulatorOverlayCoordinator,
} from '../../src/shell/overlay-coordinator.ts';
import { fixtureModuleCatalog, fixtureScenario } from './fixtures.mjs';

const catalog = generateEffectCatalog({ write: false });

test('one overlay coordinator isolates two instance stacks and owns modal effects', async () => {
  const fixture = await createFixture();
  const {
    document,
    window,
    root,
    disclosure,
    shell,
    diagnostics,
    safeFocus,
    instanceA,
    instanceB,
    coordinator,
    listeners,
  } = fixture;
  const reasonsA = [];
  const reasonsB = [];
  const triggerA = button(document, instanceA.rendererRoot, 'trigger-a');
  const triggerB = button(document, instanceB.rendererRoot, 'trigger-b');
  const contentA = overlayContent(document, instanceA.overlayRoot, 'content-a');
  const contentB = overlayContent(document, instanceB.overlayRoot, 'content-b');
  const focusA = button(document, contentA, 'focus-a');
  const focusB = button(document, contentB, 'focus-b');
  instanceA.rendererRoot.setAttribute('aria-hidden', 'false');

  const acquiredA = await instanceA.host.port.acquire(modalOptions('A modal'));
  assert.equal(acquiredA.ok, true);
  assert.deepEqual(acquiredA.value.registerNodes({
    trigger: triggerA,
    content: contentA,
    initialFocus: focusA,
    fallbackFocus: triggerA,
    returnFocus: triggerA,
  }), { ok: true, value: { registered: true } });
  acquiredA.value.subscribeDismiss((reason) => reasonsA.push(reason));

  const acquiredB = await instanceB.host.port.acquire(modalOptions('B modal'));
  assert.equal(acquiredB.ok, true);
  acquiredB.value.registerNodes({
    trigger: triggerB,
    content: contentB,
    initialFocus: focusB,
    fallbackFocus: triggerB,
    returnFocus: triggerB,
  });
  acquiredB.value.subscribeDismiss((reason) => reasonsB.push(reason));

  assert.equal(contentA.style.zIndex, String(SIMULATOR_OVERLAY_Z_INDEX_BASE));
  assert.equal(contentB.style.zIndex, String(SIMULATOR_OVERLAY_Z_INDEX_BASE + 1));
  assert.equal(document.activeElement, focusB);
  assert.equal(instanceA.rendererRoot.inert, true);
  assert.equal(instanceA.overlayRoot.inert, true);
  assert.equal(instanceB.rendererRoot.inert, true);
  assert.notEqual(diagnostics.inert, true);
  assert.notEqual(disclosure.inert, true);
  assert.equal(disclosure.parentElement, root.parentElement);
  assert.equal(root.contains(disclosure), false);
  assert.equal(root.dataset.nimiScrollLocked, 'true');
  assert.equal(root.style.overflow, 'hidden');
  assert.equal(document.body.style.overflow, '');

  assert.equal(coordinator.listenerCount(), 3);
  assert.equal(listeners.familyListenerCount('keyboard'), 2);
  assert.equal(listeners.familyListenerCount('pointer_dismissal'), 2);
  assert.equal(listeners.familyListenerCount('focus'), 2);

  document.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  }));
  await flushCommands();
  assert.deepEqual(reasonsA, []);
  assert.deepEqual(reasonsB, ['escape']);
  assert.equal(acquiredB.value.state(), 'dismiss-requested');
  assert.deepEqual(
    await acquiredB.value.acknowledgeContentUnmounted(),
    { ok: true, value: { released: false } },
  );
  assert.equal(coordinator.activeLeaseCount(), 2);

  contentB.remove();
  assert.deepEqual(
    await acquiredB.value.acknowledgeContentUnmounted(),
    { ok: true, value: { released: true } },
  );
  assert.equal(acquiredB.value.state(), 'released');
  assert.equal(acquiredA.value.state(), 'open');
  assert.equal(document.activeElement, focusA);
  assert.equal(instanceA.rendererRoot.inert, true);
  assert.equal(instanceB.rendererRoot.inert, true);
  assert.equal(contentA.style.zIndex, String(SIMULATOR_OVERLAY_Z_INDEX_BASE));

  shell.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  await flushCommands();
  assert.deepEqual(reasonsA, ['outside-pointer']);
  assert.equal(acquiredA.value.state(), 'dismiss-requested');
  contentA.remove();
  assert.equal((await acquiredA.value.acknowledgeContentUnmounted()).value.released, true);
  assert.equal(document.activeElement, triggerA);
  assert.equal(root.dataset.nimiScrollLocked, undefined);
  assert.equal(root.style.overflow, '');
  assert.notEqual(instanceA.rendererRoot.inert, true);
  assert.equal(instanceA.rendererRoot.getAttribute('aria-hidden'), 'false');
  assert.notEqual(instanceB.rendererRoot.inert, true);
  assert.notEqual(diagnostics.inert, true);
  assert.notEqual(safeFocus.inert, true);

  const shellProjection = fixture.engine.getCommitted().partitions.shell;
  assert.deepEqual(shellProjection.overlays, {});

  assert.deepEqual(coordinator.disposeAfterRootUnmounted(), {
    ok: true,
    value: { disposed: true },
  });
  assert.equal(listeners.totalInstalledListeners(), 0);
  assert.ok(fixture.effectScopes.some(([owner]) => owner === 'kit-primitive'));
  assert.deepEqual(fixture.callbackFailures, []);
});

test('instance disposal uses typed dismissal and refuses release before content unmount', async () => {
  const fixture = await createFixture();
  const { document, instanceA, coordinator } = fixture;
  const trigger = button(document, instanceA.rendererRoot, 'dispose-trigger');
  const content = overlayContent(document, instanceA.overlayRoot, 'dispose-content');
  const reasons = [];
  const acquired = await instanceA.host.port.acquire(modalOptions('Disposable modal'));
  assert.equal(acquired.ok, true);
  acquired.value.registerNodes({
    trigger,
    content,
    initialFocus: null,
    fallbackFocus: trigger,
    returnFocus: trigger,
  });
  const subscription = acquired.value.subscribeDismiss((reason) => reasons.push(reason));
  assert.equal(subscription.ok, true);

  const requested = await instanceA.host.requestDismissAll('dispose');
  assert.deepEqual(requested, { ok: true, value: { requested: 1 } });
  assert.deepEqual(reasons, ['dispose']);
  assert.equal(acquired.value.state(), 'dismiss-requested');

  const premature = await acquired.value.acknowledgeContentUnmounted();
  assert.deepEqual(premature, { ok: true, value: { released: false } });
  assert.equal(instanceA.host.activeLeaseCount, 1);

  content.remove();
  const released = await instanceA.host.acknowledgeInstanceUnmounted('dispose');
  assert.deepEqual(released, { ok: true, value: { released: 1 } });
  assert.equal(instanceA.host.activeLeaseCount, 0);
  assert.deepEqual(
    await instanceA.host.acknowledgeInstanceUnmounted('dispose'),
    { ok: true, value: { released: 0 } },
  );
  subscription.value();
  subscription.value();

  assert.equal((await instanceA.host.port.acquire(modalOptions('late'))).ok, false);
  assert.equal((await instanceA.host.requestDismissAll('reset')).error.code, 'SIMULATOR_INVALID_LIFECYCLE');
  assert.equal(coordinator.disposeAfterRootUnmounted().ok, true);
});

test('off-root nodes and duplicate instance hosts fail closed without allocating new truth', async () => {
  const fixture = await createFixture();
  const { document, root, instanceA, coordinator } = fixture;
  const acquired = await instanceA.host.port.acquire(modalOptions('Scoped modal'));
  const outside = button(document, root, 'outside-content');
  const before = fixture.engine.getCommitted().revision;
  assert.deepEqual(acquired.value.registerNodes({
    trigger: null,
    content: outside,
    initialFocus: null,
    fallbackFocus: null,
    returnFocus: null,
  }), { ok: false, error: { disposition: 'invalid-input' } });
  assert.equal(fixture.engine.getCommitted().revision, before);

  const duplicate = coordinator.createInstanceHost({
    moduleId: 'module-a',
    instanceId: instanceA.instanceId,
    rendererRoot: instanceA.rendererRoot,
    overlayRoot: instanceA.overlayRoot,
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, 'SIMULATOR_INVALID_LIFECYCLE');

  const requested = await acquired.value.requestDismiss('app');
  assert.deepEqual(requested, { ok: true, value: { requested: true } });
  assert.equal((await acquired.value.acknowledgeContentUnmounted()).value.released, true);
  assert.equal(coordinator.disposeAfterRootUnmounted().ok, true);
});

async function createFixture() {
  const dom = new JSDOM(`<!doctype html><html><body>
  <header id="disclosure" style="position: sticky; z-index: 2010099">Simulated</header>
  <div id="root">
    <section id="shell"></section>
    <section id="diagnostics"><button id="safe-focus">Safe</button></section>
    <section id="a-renderer"></section><section id="a-overlay"></section>
    <section id="b-renderer"></section><section id="b-overlay"></section>
  </div></body></html>`, { pretendToBeVisual: true });
  const { document } = dom.window;
  const root = element(document, 'root');
  const disclosure = element(document, 'disclosure');
  const shell = element(document, 'shell');
  const diagnostics = element(document, 'diagnostics');
  const safeFocus = element(document, 'safe-focus');
  const engine = createSimulatorStateEngine({ scenario: fixtureScenario({
    shellState: { overlays: {} },
  }) });
  engine.registerModuleCatalog(fixtureModuleCatalog(emptyModule('module-a', 0)));
  engine.registerModuleCatalog(fixtureModuleCatalog(emptyModule('module-b', 1)));
  const openedA = await openInstance(engine, 'module-a');
  const openedB = await openInstance(engine, 'module-b');
  const listeners = createGlobalListenerCoordinator(
    catalog.listenerFamilies.map((family) => ({
      id: family.id,
      eventTarget: family.eventTarget,
      eventTypes: family.eventTypes,
      capture: family.capture,
      passive: family.passive,
      owner: family.owner,
    })),
    { window: dom.window, document },
    { run: (_owner, _phase, callback) => callback() },
  );
  const effectScopes = [];
  const callbackFailures = [];
  const coordinator = createSimulatorOverlayCoordinator({
    engine,
    listeners,
    simulatorRoot: root,
    interactiveRoots: () => [
      shell,
      element(document, 'a-renderer'),
      element(document, 'a-overlay'),
      element(document, 'b-renderer'),
      element(document, 'b-overlay'),
    ],
    diagnosticsRoots: () => [diagnostics],
    safeFocusTarget: () => safeFocus,
    effectScope: {
      run(owner, phase, callback) {
        effectScopes.push([owner, phase]);
        return callback();
      },
    },
    onInstanceCallbackFailure: (instanceId, cause) => callbackFailures.push([instanceId, cause]),
  });
  const instanceAResult = coordinator.createInstanceHost({
    moduleId: 'module-a',
    instanceId: openedA.instanceId,
    rendererRoot: element(document, 'a-renderer'),
    overlayRoot: element(document, 'a-overlay'),
  });
  const instanceBResult = coordinator.createInstanceHost({
    moduleId: 'module-b',
    instanceId: openedB.instanceId,
    rendererRoot: element(document, 'b-renderer'),
    overlayRoot: element(document, 'b-overlay'),
  });
  assert.equal(instanceAResult.ok, true);
  assert.equal(instanceBResult.ok, true);
  return {
    dom,
    window: dom.window,
    document,
    root,
    disclosure,
    shell,
    diagnostics,
    safeFocus,
    engine,
    listeners,
    coordinator,
    effectScopes,
    callbackFailures,
    instanceA: {
      instanceId: openedA.instanceId,
      rendererRoot: element(document, 'a-renderer'),
      overlayRoot: element(document, 'a-overlay'),
      host: instanceAResult.value,
    },
    instanceB: {
      instanceId: openedB.instanceId,
      rendererRoot: element(document, 'b-renderer'),
      overlayRoot: element(document, 'b-overlay'),
      host: instanceBResult.value,
    },
  };
}

async function openInstance(engine, moduleId) {
  await engine.acceptCommand('simulator.behavior.activate', { moduleId }, {
    kind: 'shell', moduleId: null, instanceId: null,
  });
  const opened = await engine.acceptCommand('simulator.instance.open', {
    moduleId,
    surfaceId: 'main',
    initialRoute: { pathname: '/', search: [], fragment: null },
  }, { kind: 'shell', moduleId: null, instanceId: null });
  assert.equal(opened.ok, true);
  const instanceId = opened.value.instanceId;
  await engine.acceptCommand('simulator.instance.transition', {
    instanceId,
    transition: 'module_loaded',
  }, { kind: 'shell', moduleId: null, instanceId: null });
  await engine.acceptCommand('simulator.instance.transition', {
    instanceId,
    transition: 'prepare_success',
  }, { kind: 'shell', moduleId: null, instanceId: null });
  return { instanceId };
}

function modalOptions(ariaLabel) {
  return {
    kind: 'dialog',
    modal: true,
    dismissOnEscape: true,
    dismissOnOutsidePointer: true,
    returnFocus: true,
    initialFocusSemanticId: null,
    returnFocusSemanticId: null,
    scrollLock: 'simulator-root',
    ariaLabel,
  };
}

function overlayContent(document, parent, id) {
  const content = document.createElement('section');
  content.id = id;
  parent.append(content);
  return content;
}

function button(document, parent, id) {
  const target = document.createElement('button');
  target.id = id;
  target.textContent = id;
  parent.append(target);
  return target;
}

function element(document, id) {
  const value = document.getElementById(id);
  assert.ok(value, `missing fixture element ${id}`);
  return value;
}

async function flushCommands() {
  await new Promise((resolve) => setImmediate(resolve));
}

function emptyModule(moduleId, orderingKey) {
  return {
    moduleId,
    orderingKey,
    behavior: {
      initialState: () => ({}),
      reduce: (_state, envelope) => {
        throw new Error(`unexpected command ${envelope.type} for ${moduleId}`);
      },
      project: () => ({}),
    },
    commandSchemas: {},
    eventSchemas: {},
    queries: {},
    selectSharedProjection: null,
    moduleData: null,
  };
}
