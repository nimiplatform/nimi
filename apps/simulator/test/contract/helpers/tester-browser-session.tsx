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
  { testerSimulatorAdapterFactory },
  { simulatorConformanceFixture },
  { testerSimulatorRenderer },
  { createAssignedRootRegistry, createBrowserReadinessPort, createReactCommitTracker, isSimulationDisclosureVisible },
  { createGlobalListenerCoordinator },
  { createSimulatorBrowserSurfaceManager },
  { createSimulatorSession },
  { fixtureScenario },
] = await Promise.all([
  import('react'),
  import('react-dom/client'),
  import('../../../../tester/src/simulator/adapter.ts'),
  import('../../../../tester/src/simulator/fixture.ts'),
  import('../../../../tester/src/simulator/renderer.ts'),
  import('../../../src/lifecycle/browser-readiness.ts'),
  import('../../../src/shell/global-coordinator.ts'),
  import('../../../src/shell/browser-surface-host.tsx'),
  import('../../../src/shell/session.ts'),
  import('../fixtures.mjs'),
]);

const readinessDeclaration = simulatorConformanceFixture.readiness[0];
const readinessExpectation = {
  contractId: readinessDeclaration.contractId,
  rootContentSemanticId: readinessDeclaration.rootContentSemanticId,
  primaryControl: readinessDeclaration.primaryControl,
  projectionPredicateId: 'tester-projection-ready',
  blockingStatePredicateId: 'tester-no-blocking-lease',
} as const;
const moduleCatalog = {
  moduleId: 'tester',
  orderingKey: 0,
  commandSchemas: simulatorConformanceFixture.catalog.commandSchemas,
  eventSchemas: simulatorConformanceFixture.catalog.eventSchemas,
  queries: {},
  selectSharedProjection: null,
  moduleData: simulatorConformanceFixture.catalog.moduleData,
} as const;
const registryRow = {
  metadata: {
    moduleId: 'tester',
    orderingKey: 0,
    surfaces: [{
      id: 'main',
      label: 'Nimi Lab',
      initialRoute: '/',
      readinessContractId: readinessDeclaration.contractId,
    }],
    requirements: {
      kitCapabilities: [],
      sdkMethods: ['nimi.ai.generateText'],
      commands: Object.keys(simulatorConformanceFixture.catalog.commandSchemas),
      events: [],
    },
  },
  loadRenderer: async () => testerSimulatorRenderer,
  loadAdapter: async () => testerSimulatorAdapterFactory,
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
const assignedRoots = createAssignedRootRegistry();
const commits = createReactCommitTracker();
const readinessBrowser = createBrowserReadinessPort({
  commits,
  roots: assignedRoots,
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser),
  computedStyle: (element) => browser.getComputedStyle(element),
  paintCompositeEvidence: {
    begin: async () => 'fixture-paint-window',
    mark: async () => true,
    end: async () => true,
  },
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
  assignedRoots,
  commits,
  listeners,
  supportedKitCapabilities: new Set(),
  invokeKitOperation: async () => ({ ok: false, error: { disposition: 'unsupported' } }),
  reportReadyCandidate(input) {
    const readiness = session?.readinessFor(input.instanceId, input.surfaceId);
    assert.equal(readiness?.ok, true);
    if (!readiness?.ok) throw new Error('Tester readiness barrier is missing.');
    const signaled = readiness.value.signalCandidate({ contractId: input.contractId });
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
    scenarioId: 'tester-browser-contract-scenario',
    scenarioRevision: 'tester-browser-contract-scenario-1',
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
  readinessBrowser,
  readinessDeclarations: { 'tester/main': readinessDeclaration },
  readinessExpectations: { 'tester/main': readinessExpectation },
  readinessProjectionPredicates: {
    'tester-projection-ready': (value) => (
      typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && value.protocolRevision === 1
    ),
  },
  readinessBlockingPredicates: { 'tester-no-blocking-lease': () => false },
  commitToken: commits.current,
  simulationDisclosureVisible: () => isSimulationDisclosureVisible(
    browser.document.querySelector('[data-testid="simulator-status"]'),
    (element) => browser.getComputedStyle(element),
  ),
});

let first: Awaited<ReturnType<typeof session.openInstance>> | null = null;
let second: Awaited<ReturnType<typeof session.openInstance>> | null = null;
await act(async () => {
  first = await session?.openInstance('tester') ?? null;
});
assert.equal(first?.ok, true);
if (!first?.ok) throw new Error('First Tester browser instance did not open.');
const firstReadiness = session.readinessFor(first.value.instanceId, 'main');
assert.equal(firstReadiness.ok, true);
if (!firstReadiness.ok) throw new Error('First Tester readiness evidence is missing.');
const firstCompletion = await firstReadiness.value.completion;
assert.equal(firstCompletion.state, 'usable', JSON.stringify({ firstCompletion, instances: session.instances(), diagnostics: session.diagnostics.list() }));

await act(async () => {
  second = await session?.openInstance('tester') ?? null;
});
assert.equal(second?.ok, true);
if (!second?.ok) throw new Error('Second Tester browser instance did not open.');
const secondReadiness = session.readinessFor(second.value.instanceId, 'main');
assert.equal(secondReadiness.ok, true);
if (!secondReadiness.ok) throw new Error('Second Tester readiness evidence is missing.');
const secondCompletion = await secondReadiness.value.completion;
assert.equal(secondCompletion.state, 'usable', JSON.stringify({ secondCompletion, instances: session.instances(), diagnostics: session.diagnostics.list() }));

assert.notEqual(first.value.instanceId, second.value.instanceId);

const firstRoots = assignedRoots.get(first.value.instanceId, 'main');
const secondRoots = assignedRoots.get(second.value.instanceId, 'main');
assert.ok(firstRoots);
assert.ok(secondRoots);
assert.notEqual(firstRoots.renderer, secondRoots.renderer);
assert.notEqual(firstRoots.overlay, secondRoots.overlay);
assert.equal(firstRoots.renderer.classList.contains('nimi-ui-module--tester'), true);
assert.equal(firstRoots.overlay.classList.contains('nimi-ui-module--tester'), true);
assert.equal(secondRoots.renderer.classList.contains('nimi-ui-module--tester'), true);
assert.equal(secondRoots.overlay.classList.contains('nimi-ui-module--tester'), true);
assert.notEqual(firstRoots.renderer.closest('.simulator-surface'), secondRoots.renderer.closest('.simulator-surface'));
assert.equal(
  firstRoots.renderer.querySelectorAll('[data-nimi-semantic-id="tester-main-root"]').length,
  1,
  JSON.stringify({ html: firstRoots.renderer.innerHTML, instances: session.instances(), diagnostics: session.diagnostics.list() }),
);
assert.equal(secondRoots.renderer.querySelectorAll('[data-nimi-semantic-id="tester-main-root"]').length, 1);
assert.equal(firstRoots.renderer.querySelectorAll('[data-nimi-semantic-id="tester-primary-action"]').length, 1);
assert.equal(secondRoots.renderer.querySelectorAll('[data-nimi-semantic-id="tester-primary-action"]').length, 1);
await waitForCondition(
  () => firstRoots.renderer.textContent?.includes('Local app · Unavailable') === true
    && firstRoots.renderer.textContent?.includes('Runtime · Simulated') === true,
  'the canonical Tester UI to disclose unavailable identity and simulated execution',
);
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
  'the first Tester instance prompt mutation',
);
assert.equal(secondPrompt.value, secondPromptBaseline);
assert.notEqual(secondPrompt.value, isolatedPrompt);
await waitForCondition(() => {
  const testerState = session?.engine.getCommitted().partitions.modules.tester;
  return Boolean(
    testerState
    && typeof testerState.promptDrafts === 'object'
    && testerState.promptDrafts !== null
    && !Array.isArray(testerState.promptDrafts)
    && Object.values(testerState.promptDrafts).includes(isolatedPrompt),
  );
}, 'the first Tester instance draft command to commit');
assert.equal(secondPrompt.value, secondPromptBaseline);

await waitForCondition(() => {
  const button = firstRoots.renderer.querySelector('button[aria-label="Generate text"]');
  return button instanceof browser.HTMLButtonElement && !button.disabled;
}, 'the first Tester SDK action to become usable');
const generateText = firstRoots.renderer.querySelector('button[aria-label="Generate text"]');
assert.ok(generateText instanceof browser.HTMLButtonElement);
await act(async () => {
  generateText.click();
});
await waitForCondition(() => {
  const testerState = session?.engine.getCommitted().partitions.modules.tester;
  return Boolean(
    testerState
    && Array.isArray(testerState.capabilityExecutions)
    && testerState.capabilityExecutions.length === 1
    && typeof testerState.runHistory === 'object'
    && testerState.runHistory !== null
    && !Array.isArray(testerState.runHistory)
    && Array.isArray(testerState.runHistory['text.generate'])
    && testerState.runHistory['text.generate'].length === 1,
  );
}, 'the Tester SDK result and run history to commit');
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
assert.equal(surfaces.activeOverlayLeaseCount, 0);

await act(async () => {
  assert.equal((await session?.closeInstance(first.value.instanceId))?.ok, true);
});
assert.equal(assignedRoots.get(first.value.instanceId, 'main'), null);
assert.ok(assignedRoots.get(second.value.instanceId, 'main')?.renderer.isConnected);
assert.equal(surfaces.liveSurfaceCount, 1);
assert.equal(surfaces.activeOverlayLeaseCount, 0);

await act(async () => {
  assert.equal((await session?.resetScenario())?.ok, true);
});
assert.equal(assignedRoots.get(second.value.instanceId, 'main'), null);
assert.equal(surfaces.liveSurfaceCount, 0);
assert.equal(surfaces.activeOverlayLeaseCount, 0);
assert.equal(listeners.totalInstalledListeners(), listenerBaseline);
assert.equal(session.instances().length, 0);
const resetTesterState = session.engine.getCommitted().partitions.modules.tester;
assert.equal(Array.isArray(resetTesterState.capabilityExecutions), true);
assert.equal(resetTesterState.capabilityExecutions.length, 0);
assert.deepEqual(resetTesterState.runHistory, {});
assert.equal(session.engine.isQuiescent(), true);

let reopened: Awaited<ReturnType<typeof session.openInstance>> | null = null;
await act(async () => {
  reopened = await session?.openInstance('tester') ?? null;
});
assert.equal(reopened?.ok, true);
if (!reopened?.ok) throw new Error('Tester browser instance did not reopen.');
assert.ok(assignedRoots.get(reopened.value.instanceId, 'main')?.renderer.isConnected);
assert.equal(surfaces.liveSurfaceCount, 1);
await act(async () => {
  assert.equal((await session?.closeInstance(reopened.value.instanceId))?.ok, true);
});
assert.equal(surfaces.liveSurfaceCount, 0);
assert.equal(surfaces.activeOverlayLeaseCount, 0);
assert.equal(listeners.totalInstalledListeners(), listenerBaseline);
assert.deepEqual(session.instances().map((instance) => instance.status), ['disposed']);

await act(async () => { reactRoot.unmount(); });
dom.window.close();
process.stdout.write('tester-browser-session-integration: OK\n');
