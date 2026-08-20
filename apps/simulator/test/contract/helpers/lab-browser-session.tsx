import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><body><main id="simulator-test-root"><section id="simulator-shell-root" tabindex="-1"></section></main></body></html>',
  { pretendToBeVisual: true, url: 'https://simulator.nimi.test/' },
);
const browser = dom.window;

async function waitForCondition(condition: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return;
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

const browserGlobals = {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLLabelElement: browser.HTMLLabelElement,
  Event: browser.Event,
  EventTarget: browser.EventTarget,
  CustomEvent: browser.CustomEvent,
  MutationObserver: browser.MutationObserver,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
};
for (const [name, value] of Object.entries(browserGlobals)) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

Object.defineProperty(browser.HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value() {
    return this.isConnected ? [{ width: 1, height: 1 }] : [];
  },
});

if (!browser.matchMedia) {
  Object.defineProperty(browser, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  });
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, { ResizeObserver: TestResizeObserver });

const [
  { Fragment, act, createElement: h },
  { createRoot },
  { labSimulatorAdapterFactory },
  { simulatorConformanceFixture },
  { labSimulatorRenderer },
  { createGlobalListenerCoordinator },
  { createSimulatorBrowserSurfaceManager },
  { createSimulatorSession },
  { fixtureScenario },
] = await Promise.all([
  import('react'),
  import('react-dom/client'),
  import('../../../../lab/src/simulator/adapter.ts'),
  import('../../../../lab/src/simulator/fixture.ts'),
  import('../../../../lab/src/simulator/renderer.ts'),
  import('../../../src/shell/global-coordinator.ts'),
  import('../../../src/shell/browser-surface-host.tsx'),
  import('../../../src/shell/session.ts'),
  import('../fixtures.mjs'),
]);

const moduleCatalog = {
  moduleId: 'lab',
  orderingKey: 0,
  commandSchemas: simulatorConformanceFixture.catalog.commandSchemas,
  eventSchemas: simulatorConformanceFixture.catalog.eventSchemas,
  queries: {},
  selectSharedProjection: null,
  moduleData: simulatorConformanceFixture.catalog.moduleData,
} as const;
const registryRow = {
  metadata: {
    moduleId: 'lab',
    orderingKey: 0,
    surfaces: [{
      id: 'main',
      label: 'Nimi Lab',
      initialRoute: '/',
    }],
    requirements: {
      kitCapabilities: [],
      sdkMethods: ['nimi.ai.generateText'],
      commands: Object.keys(simulatorConformanceFixture.catalog.commandSchemas),
      events: [],
    },
  },
  loadRenderer: async () => labSimulatorRenderer,
  loadAdapter: async () => labSimulatorAdapterFactory,
  loadStyle: async () => undefined,
} as const;

const listenerFamilies = [
  { id: 'keyboard', eventTarget: 'document', eventTypes: ['keydown', 'keyup'], owner: 'kit-coordinator', capture: true, passive: false },
  { id: 'pointer_dismissal', eventTarget: 'document', eventTypes: ['pointerdown', 'click'], owner: 'kit-coordinator', capture: true, passive: true },
  { id: 'focus', eventTarget: 'document', eventTypes: ['focusin', 'focusout'], owner: 'kit-coordinator', capture: true, passive: false },
] as const;
const listeners = createGlobalListenerCoordinator(listenerFamilies, {
  window: browser,
  document: browser.document,
}, {
  run: (_owner, _phase, callback) => callback(),
});
const simulatorRoot = browser.document.getElementById('simulator-test-root');
const shellRoot = browser.document.getElementById('simulator-shell-root');
assert.ok(simulatorRoot instanceof browser.HTMLElement);
assert.ok(shellRoot instanceof browser.HTMLElement);

const guard = Object.freeze({
  withScope<T>(_scope: unknown, callback: () => T): T {
    return callback();
  },
});
let session: ReturnType<typeof createSimulatorSession> | null = null;
const surfaces = createSimulatorBrowserSurfaceManager({
  guard: guard as never,
  document: browser.document,
  simulatorRoot,
  shellRoot,
  listeners,
  supportedKitCapabilities: new Set(),
  invokeKitOperation: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  reportReadyCandidate(input) {
    const readiness = session?.readinessFor(input.instanceId, input.surfaceId);
    assert.equal(readiness?.ok, true);
    if (!readiness?.ok) throw new Error('Lab readiness barrier is missing.');
    const signaled = readiness.value.signalCandidate();
    assert.equal(signaled.ok, true);
  },
});
const reactRoot = createRoot(shellRoot);
await act(async () => {
  reactRoot.render(h(Fragment, null,
    h('p', { 'data-testid': 'simulator-status' }, 'Simulated data'),
    surfaces.renderPortals(),
  ));
});

session = createSimulatorSession({
  scenario: fixtureScenario({
    scenarioId: 'lab-browser-contract-scenario',
    scenarioRevision: 'lab-browser-contract-scenario-1',
    initialLogicalTime: 1_800_000_000_000,
  }),
  registryModules: [registryRow],
  moduleCatalogs: [moduleCatalog],
  timers: {
    setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => performance.now(),
  },
  effectScope: { run: (_owner, _phase, callback) => callback() },
  prepareSurface: (input) => surfaces.prepare(input),
});

let first: Awaited<ReturnType<typeof session.openInstance>> | null = null;
let second: Awaited<ReturnType<typeof session.openInstance>> | null = null;
await act(async () => {
  first = await session?.openInstance('lab') ?? null;
});
assert.equal(first?.ok, true);
if (!first?.ok) throw new Error('First Lab browser instance did not open.');
const firstReadiness = session.readinessFor(first.value.instanceId, 'main');
assert.equal(firstReadiness.ok, true);
if (!firstReadiness.ok) throw new Error('First Lab readiness observation is missing.');
const firstCompletion = await firstReadiness.value.completion;
assert.equal(firstCompletion.state, 'usable', JSON.stringify({ firstCompletion, instances: session.instances(), diagnostics: session.diagnostics.list() }));

await act(async () => {
  second = await session?.openInstance('lab') ?? null;
});
assert.equal(second?.ok, true);
if (!second?.ok) throw new Error('Second Lab browser instance did not open.');
const secondReadiness = session.readinessFor(second.value.instanceId, 'main');
assert.equal(secondReadiness.ok, true);
if (!secondReadiness.ok) throw new Error('Second Lab readiness observation is missing.');
const secondCompletion = await secondReadiness.value.completion;
assert.equal(secondCompletion.state, 'usable', JSON.stringify({ secondCompletion, instances: session.instances(), diagnostics: session.diagnostics.list() }));

assert.notEqual(first.value.instanceId, second.value.instanceId);

function rootsFor(instanceId: string) {
  const stage = surfaces.stageElement(instanceId);
  assert.ok(stage);
  const renderer = stage.querySelector('.simulator-surface__renderer');
  const overlay = stage.querySelector('.simulator-surface__overlays');
  assert.ok(renderer instanceof browser.HTMLElement);
  assert.ok(overlay instanceof browser.HTMLElement);
  return { renderer, overlay };
}

const firstRoots = rootsFor(first.value.instanceId);
const secondRoots = rootsFor(second.value.instanceId);
assert.notEqual(firstRoots.renderer, secondRoots.renderer);
assert.notEqual(firstRoots.overlay, secondRoots.overlay);
assert.equal(firstRoots.renderer.classList.contains('nimi-ui-module--lab'), true);
assert.equal(firstRoots.overlay.classList.contains('nimi-ui-module--lab'), true);
assert.equal(secondRoots.renderer.classList.contains('nimi-ui-module--lab'), true);
assert.equal(secondRoots.overlay.classList.contains('nimi-ui-module--lab'), true);
assert.notEqual(firstRoots.renderer.closest('.simulator-surface'), secondRoots.renderer.closest('.simulator-surface'));
const disclosure = browser.document.querySelector('[data-testid="simulator-status"]');
assert.ok(disclosure instanceof browser.HTMLElement);
assert.equal(disclosure.closest('.simulator-surface'), null);
assert.match(disclosure.textContent ?? '', /Simulated data/u);
assert.doesNotMatch(firstRoots.renderer.textContent ?? '', /Local app ·|Runtime ·|模拟居民/u);
assert.doesNotMatch(firstRoots.renderer.textContent ?? '', /Runtime · (?:Ready|Connected)|Runtime is connected/u);
assert.doesNotMatch(firstRoots.renderer.textContent ?? '', /Identity protected by Nimi Desktop/u);

const firstPrompt = firstRoots.renderer.querySelector('textarea[aria-label="Text Studio request"]');
const secondPrompt = secondRoots.renderer.querySelector('textarea[aria-label="Text Studio request"]');
assert.ok(firstPrompt instanceof browser.HTMLTextAreaElement);
assert.ok(secondPrompt instanceof browser.HTMLTextAreaElement);
const secondPromptBaseline = secondPrompt.value;
const isolatedPrompt = 'Only the first canonical renderer instance owns this draft.';
const textareaValueSetter = Object.getOwnPropertyDescriptor(
  browser.HTMLTextAreaElement.prototype,
  'value',
)?.set;
assert.ok(textareaValueSetter);
await act(async () => {
  textareaValueSetter.call(firstPrompt, isolatedPrompt);
  firstPrompt.dispatchEvent(new browser.Event('input', { bubbles: true }));
});
await waitForCondition(
  () => firstPrompt.value === isolatedPrompt,
  'the first Lab instance prompt mutation',
);
assert.equal(secondPrompt.value, secondPromptBaseline);
assert.notEqual(secondPrompt.value, isolatedPrompt);
await waitForCondition(() => {
  const labState = session?.engine.getCommitted().partitions.modules.lab;
  return Boolean(
    labState
    && typeof labState.promptDrafts === 'object'
    && labState.promptDrafts !== null
    && !Array.isArray(labState.promptDrafts)
    && Object.values(labState.promptDrafts).includes(isolatedPrompt),
  );
}, 'the first Lab instance draft command to commit');
assert.equal(secondPrompt.value, secondPromptBaseline);

await waitForCondition(() => {
  const button = firstRoots.renderer.querySelector('button[aria-label="Generate text"]');
  return button instanceof browser.HTMLButtonElement && !button.disabled;
}, 'the first Lab SDK action to become usable');
const generateText = firstRoots.renderer.querySelector('button[aria-label="Generate text"]');
assert.ok(generateText instanceof browser.HTMLButtonElement);
await act(async () => {
  generateText.click();
});
await waitForCondition(() => {
  const labState = session?.engine.getCommitted().partitions.modules.lab;
  return Boolean(
    labState
    && Array.isArray(labState.capabilityExecutions)
    && labState.capabilityExecutions.length === 1
    && typeof labState.runHistory === 'object'
    && labState.runHistory !== null
    && !Array.isArray(labState.runHistory)
    && Array.isArray(labState.runHistory['text.generate'])
    && labState.runHistory['text.generate'].length === 1,
  );
}, 'the Lab SDK result and run history to commit');
await waitForCondition(
  () => firstRoots.renderer.textContent?.includes(simulatorConformanceFixture.catalog.moduleData.generatedText) === true,
  'the simulated SDK result to render',
);
assert.match(firstRoots.renderer.textContent ?? '', /Simulator result/u);
assert.match(firstRoots.renderer.textContent ?? '', /SDK testing facade · Simulated/u);
assert.doesNotMatch(firstRoots.renderer.textContent ?? '', /Runtime ready/u);
assert.equal(session.engine.isQuiescent(), true);

for (const attribute of ['id', 'name'] as const) {
  const values = [...browser.document.querySelectorAll<HTMLElement>(`[${attribute}]`)]
    .map((element) => element.getAttribute(attribute))
    .filter((value): value is string => Boolean(value));
  assert.equal(new Set(values).size, values.length, `duplicate document-visible ${attribute} identity`);
}

assert.equal((await session.activateInstance(first.value.instanceId)).ok, true);
assert.equal((await session.activateInstance(second.value.instanceId)).ok, true);
assert.equal((await session.deactivateInstance(first.value.instanceId)).ok, true);
const listenerBaseline = listeners.totalInstalledListeners();
assert.equal(listenerBaseline, 6);
assert.equal(surfaces.liveSurfaceCount, 2);

await act(async () => {
  assert.equal((await session?.closeInstance(first.value.instanceId))?.ok, true);
});
assert.equal(surfaces.stageElement(first.value.instanceId), null);
assert.ok(surfaces.stageElement(second.value.instanceId)?.isConnected);
assert.equal(surfaces.liveSurfaceCount, 1);

await act(async () => {
  assert.equal((await session?.resetScenario())?.ok, true);
});
assert.equal(surfaces.stageElement(second.value.instanceId), null);
assert.equal(surfaces.liveSurfaceCount, 0);
assert.equal(listeners.totalInstalledListeners(), listenerBaseline);
assert.equal(session.instances().length, 0);
assert.equal(disclosure.isConnected, true);
assert.match(disclosure.textContent ?? '', /Simulated data/u);
const resetLabState = session.engine.getCommitted().partitions.modules.lab;
assert.equal(Array.isArray(resetLabState.capabilityExecutions), true);
assert.equal(resetLabState.capabilityExecutions.length, 0);
assert.deepEqual(resetLabState.runHistory, {});
assert.equal(session.engine.isQuiescent(), true);

let reopened: Awaited<ReturnType<typeof session.openInstance>> | null = null;
await act(async () => {
  reopened = await session?.openInstance('lab') ?? null;
});
assert.equal(reopened?.ok, true);
if (!reopened?.ok) throw new Error('Lab browser instance did not reopen.');
assert.ok(surfaces.stageElement(reopened.value.instanceId)?.isConnected);
assert.equal(surfaces.liveSurfaceCount, 1);
await act(async () => {
  assert.equal((await session?.closeInstance(reopened.value.instanceId))?.ok, true);
});
assert.equal(surfaces.liveSurfaceCount, 0);
assert.equal(listeners.totalInstalledListeners(), listenerBaseline);
assert.deepEqual(session.instances().map((instance) => instance.status), ['disposed']);
assert.equal(disclosure.isConnected, true);

await act(async () => { reactRoot.unmount(); });
dom.window.close();
process.stdout.write('lab-browser-session-integration: OK\n');
