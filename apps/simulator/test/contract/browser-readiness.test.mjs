import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAssignedRootRegistry,
  createBrowserReadinessPort,
  createReactCommitTracker,
} from '../../src/lifecycle/browser-readiness.ts';

class FakeElement {
  constructor(tagName, attributes = {}, children = [], textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = children;
    this.textContent = textContent;
    this.id = attributes.id ?? '';
    this.isConnected = true;
    this.hidden = false;
    this.tabIndex = attributes.tabindex === undefined ? -1 : Number(attributes.tabindex);
    this.disabled = false;
    this.labels = null;
    const declarations = new Map();
    this.style = {
      getPropertyValue: (name) => declarations.get(name)?.value ?? '',
      getPropertyPriority: (name) => declarations.get(name)?.priority ?? '',
      setProperty: (name, value, priority = '') => declarations.set(name, { value, priority }),
      removeProperty: (name) => declarations.delete(name),
    };
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  closest() { return null; }
  getClientRects() { return this.visible === false ? [] : [{}]; }
  querySelectorAll(selector) {
    const attribute = selector === '[id]' ? 'id' : 'data-nimi-semantic-id';
    const output = [];
    const visit = (node) => {
      if (node.hasAttribute(attribute)) output.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return output;
  }
}

const EXPECTATION = {
  contractId: 'fixture/v1',
  rootContentSemanticId: 'content',
  primaryControl: {
    semanticId: 'primary',
    ariaRole: 'button',
    accessibleName: 'Run fixture',
  },
  projectionPredicateId: 'projection',
  blockingStatePredicateId: 'blocking',
};

function browserHarness({ paintCompositeEvidence = null } = {}) {
  const commits = createReactCommitTracker();
  const roots = createAssignedRootRegistry();
  let frame = 0;
  const port = createBrowserReadinessPort({
    commits,
    roots,
    requestAnimationFrame(callback) {
      frame += 1;
      queueMicrotask(() => callback(frame));
      return frame;
    },
    cancelAnimationFrame() {},
    computedStyle: () => ({ display: 'block', visibility: 'visible' }),
    paintCompositeEvidence,
  });
  return { commits, roots, port };
}

test('React commit tracker resolves only a token strictly after the signal floor', async () => {
  const tracker = createReactCommitTracker();
  const scope = { instanceId: '1:instance:1', surfaceId: 'main' };
  tracker.recordCommit(scope);
  const abort = new AbortController();
  let settled = false;
  const waiting = tracker.awaitAfter({ ...scope, floor: 1, signal: abort.signal })
    .then((token) => { settled = true; return token; });
  await Promise.resolve();
  assert.equal(settled, false);
  tracker.recordCommit(scope);
  assert.equal(await waiting, 2);
});

test('cancelled commit waiters reject and cannot be revived by a late commit', async () => {
  const tracker = createReactCommitTracker();
  const scope = { instanceId: '1:instance:1', surfaceId: 'main' };
  const abort = new AbortController();
  const waiting = tracker.awaitAfter({ ...scope, floor: 0, signal: abort.signal });
  abort.abort();
  await assert.rejects(waiting, /SIMULATOR_READINESS_CANCELLED/);
  assert.equal(tracker.recordCommit(scope), 1);
});

test('commit tokens and releases are isolated by instance and surface', async () => {
  const tracker = createReactCommitTracker();
  const first = { instanceId: '1:instance:1', surfaceId: 'main' };
  const second = { instanceId: '1:instance:2', surfaceId: 'main' };
  const alternate = { instanceId: '1:instance:1', surfaceId: 'secondary' };
  const firstAbort = new AbortController();
  const secondAbort = new AbortController();
  let firstSettled = false;
  const firstWaiting = tracker.awaitAfter({ ...first, floor: 0, signal: firstAbort.signal })
    .then((token) => { firstSettled = true; return token; });
  const secondWaiting = tracker.awaitAfter({ ...second, floor: 0, signal: secondAbort.signal });

  assert.equal(tracker.recordCommit(second), 1);
  assert.equal(await secondWaiting, 1);
  await Promise.resolve();
  assert.equal(firstSettled, false);
  assert.equal(tracker.current(alternate), 0);

  tracker.release(first);
  await assert.rejects(firstWaiting, /SIMULATOR_READINESS_CANCELLED/);
  assert.equal(tracker.current(first), 0);
  assert.equal(tracker.recordCommit(first), 1);
  assert.equal(firstSettled, false);
});

test('assigned root registry rejects duplicate/colliding ownership and releases exactly', () => {
  const registry = createAssignedRootRegistry();
  const renderer = new FakeElement('div');
  const overlay = new FakeElement('div');
  registry.assign('1:instance:1', 'main', { renderer, overlay });
  assert.deepEqual(registry.get('1:instance:1', 'main'), { renderer, overlay });
  assert.throws(() => registry.assign('1:instance:1', 'main', { renderer, overlay }), /DUPLICATE/);
  assert.throws(() => registry.assign('1:instance:2', 'main', { renderer, overlay: renderer }), /COLLISION/);
  registry.release('1:instance:1', 'main');
  assert.equal(registry.get('1:instance:1', 'main'), null);
});

test('semantic evidence searches only assigned roots and requires one exact actionable control', async () => {
  const content = new FakeElement('section', { 'data-nimi-semantic-id': 'content' });
  const control = new FakeElement('button', { 'data-nimi-semantic-id': 'primary' }, [], 'Run fixture');
  const renderer = new FakeElement('div', {}, [content, control]);
  const overlay = new FakeElement('div');
  const { roots, port } = browserHarness();
  roots.assign('1:instance:1', 'main', { renderer, overlay });
  const signal = new AbortController().signal;
  assert.deepEqual(await port.checkSemanticMarkers({
    instanceId: '1:instance:1', surfaceId: 'main', expectation: EXPECTATION, signal,
  }), { ok: true });

  overlay.children.push(new FakeElement('button', {
    'data-nimi-semantic-id': 'primary', 'aria-label': 'Run fixture',
  }));
  assert.deepEqual(await port.checkSemanticMarkers({
    instanceId: '1:instance:1', surfaceId: 'main', expectation: EXPECTATION, signal,
  }), { ok: false });
});

test('Paint/Composite evidence is fail-closed unless the pinned-browser source proves the interval', async () => {
  const withoutEvidence = browserHarness();
  const signal = new AbortController().signal;
  assert.equal(await withoutEvidence.port.beginPaintComposite({
    instanceId: '1:instance:1', surfaceId: 'main', signal,
  }), null);
  assert.equal(await withoutEvidence.port.observePaintComposite({
    instanceId: '1:instance:1', surfaceId: 'main', firstFrame: 1, secondFrame: 2,
    observationToken: 'missing', signal,
  }), false);

  const markerFilters = [];
  const withEvidence = browserHarness({
    paintCompositeEvidence: {
      begin: () => 'trace:1',
      mark: () => { markerFilters.push(renderer.style.getPropertyValue('filter')); return true; },
      end: ({ firstFrame, secondFrame }) => firstFrame === 1 && secondFrame === 2,
    },
  });
  const renderer = new FakeElement('div');
  renderer.style.setProperty('filter', 'blur(1px)', 'important');
  renderer.style.setProperty('opacity', '0');
  withEvidence.roots.assign('1:instance:1', 'main', {
    renderer,
    overlay: new FakeElement('div'),
  });
  const observationToken = await withEvidence.port.beginPaintComposite({
    instanceId: '1:instance:1', surfaceId: 'main', signal,
  });
  assert.equal(observationToken, 'trace:1');
  assert.equal(await withEvidence.port.markPaintCompositeFrame({
    observationToken, ordinal: 'first', frame: 1, signal,
  }), true);
  assert.equal(renderer.style.getPropertyValue('filter'), 'opacity(0.999999)');
  assert.equal(renderer.style.getPropertyPriority('filter'), 'important');
  assert.equal(renderer.style.getPropertyValue('opacity'), '0');
  assert.deepEqual(markerFilters, ['opacity(0.999999)']);
  assert.equal(await withEvidence.port.markPaintCompositeFrame({
    observationToken, ordinal: 'second', frame: 2, signal,
  }), true);
  assert.deepEqual(markerFilters, ['opacity(0.999999)', 'opacity(0.999999)']);
  assert.equal(await withEvidence.port.observePaintComposite({
    instanceId: '1:instance:1', surfaceId: 'main', firstFrame: 1, secondFrame: 2,
    observationToken, signal,
  }), true);
  assert.equal(renderer.style.getPropertyValue('filter'), 'blur(1px)');
  assert.equal(renderer.style.getPropertyPriority('filter'), 'important');
  assert.equal(renderer.style.getPropertyValue('opacity'), '0');
});

test('Paint/Composite probe restores assigned-root styling on cancellation', async () => {
  const ended = [];
  const harness = browserHarness({
    paintCompositeEvidence: {
      begin: () => 'trace:cancel',
      mark: () => true,
      end: (input) => { ended.push(input); return false; },
    },
  });
  const renderer = new FakeElement('div');
  harness.roots.assign('1:instance:1', 'main', { renderer, overlay: new FakeElement('div') });
  const abort = new AbortController();
  const observationToken = await harness.port.beginPaintComposite({
    instanceId: '1:instance:1', surfaceId: 'main', signal: abort.signal,
  });
  assert.equal(await harness.port.markPaintCompositeFrame({
    observationToken, ordinal: 'first', frame: 1, signal: abort.signal,
  }), true);
  assert.equal(renderer.style.getPropertyValue('filter'), 'opacity(0.999999)');
  abort.abort();
  assert.equal(renderer.style.getPropertyValue('filter'), '');
  assert.deepEqual(ended, [{ observationToken: 'trace:cancel', firstFrame: null, secondFrame: null }]);
});
