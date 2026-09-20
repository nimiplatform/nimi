import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_OWNS_SCROLL_SELECTOR,
  demoRegionInnerCanScroll,
  isEventOutsidePagingRoot,
  isEventOwnedByDemoRegion,
  isPagingKeyExcludedTarget,
  resolvePagingDecision,
  type DemoScrollProbe,
} from '../src/landing/hooks/use-section-paging.js';

test('paging flips to the next section when the current one fits the screen', () => {
  assert.deepEqual(
    resolvePagingDecision({
      direction: 1,
      index: 2,
      sectionCount: 8,
      sectionScrollTop: 0,
      sectionMaxScroll: 0,
    }),
    { kind: 'flip', targetIndex: 3 },
  );
});

test('paging scrolls inside the section before flipping when it overflows', () => {
  assert.deepEqual(
    resolvePagingDecision({
      direction: 1,
      index: 2,
      sectionCount: 8,
      sectionScrollTop: 100,
      sectionMaxScroll: 400,
    }),
    { kind: 'inner', direction: 1 },
  );
});

test('paging flips forward once an overflowing section reaches its bottom', () => {
  assert.deepEqual(
    resolvePagingDecision({
      direction: 1,
      index: 2,
      sectionCount: 8,
      sectionScrollTop: 400,
      sectionMaxScroll: 400,
    }),
    { kind: 'flip', targetIndex: 3 },
  );
});

test('paging does not flip past the last section', () => {
  assert.deepEqual(
    resolvePagingDecision({
      direction: 1,
      index: 7,
      sectionCount: 8,
      sectionScrollTop: 400,
      sectionMaxScroll: 400,
    }),
    { kind: 'none' },
  );
});

test('paging scrolls up inside an overflowing section before flipping back', () => {
  assert.deepEqual(
    resolvePagingDecision({
      direction: -1,
      index: 3,
      sectionCount: 8,
      sectionScrollTop: 120,
      sectionMaxScroll: 400,
    }),
    { kind: 'inner', direction: -1 },
  );
});

test('paging does not flip before the first section', () => {
  assert.deepEqual(
    resolvePagingDecision({
      direction: -1,
      index: 0,
      sectionCount: 8,
      sectionScrollTop: 0,
      sectionMaxScroll: 0,
    }),
    { kind: 'none' },
  );
});

test('wheel or touch gestures inside a demo region are owned by the demo, not paging', () => {
  const inside = { closest: (selector: string) => (selector === DEMO_OWNS_SCROLL_SELECTOR ? {} : null) };
  const outside = { closest: () => null };
  assert.equal(isEventOwnedByDemoRegion(inside), true);
  assert.equal(isEventOwnedByDemoRegion(outside), false);
  assert.equal(isEventOwnedByDemoRegion(null), false);
  assert.equal(isEventOwnedByDemoRegion({}), false);
});

/**
 * Builds a demo-region mock: target -> ...inner -> demoRoot. The demo root
 * answers closest() for any descendant chain link.
 */
function demoChain(inner: Array<NonNullable<DemoScrollProbe>>): { target: DemoScrollProbe; demoRoot: NonNullable<DemoScrollProbe> } {
  const demoRoot: NonNullable<DemoScrollProbe> = { parentElement: null };
  const chain = [...inner, demoRoot];
  chain.forEach((probe, index) => {
    (probe as { closest?: unknown }).closest = (selector: string) =>
      selector === DEMO_OWNS_SCROLL_SELECTOR ? demoRoot : null;
    if (index < chain.length - 1) {
      (probe as { parentElement?: unknown }).parentElement = chain[index + 1];
    }
  });
  return { target: chain[0] ?? null, demoRoot };
}

test('a demo region keeps the gesture while an inner scroller can move', () => {
  const { target } = demoChain([
    { scrollTop: 0, scrollHeight: 600, clientHeight: 200 },
  ]);
  assert.equal(demoRegionInnerCanScroll(target, 1), true);
  assert.equal(demoRegionInnerCanScroll(target, -1), false);
});

test('the gesture chains outward once the inner scroller reaches its edge', () => {
  const atBottom = demoChain([
    { scrollTop: 400, scrollHeight: 600, clientHeight: 200 },
  ]);
  assert.equal(demoRegionInnerCanScroll(atBottom.target, 1), false);
  assert.equal(demoRegionInnerCanScroll(atBottom.target, -1), true);

  const noOverflow = demoChain([
    { scrollTop: 0, scrollHeight: 200, clientHeight: 200 },
  ]);
  assert.equal(demoRegionInnerCanScroll(noOverflow.target, 1), false);
  assert.equal(demoRegionInnerCanScroll(noOverflow.target, -1), false);
});

test('the walk stops at the demo root and never claims the page scroller', () => {
  // Even if an ancestor beyond the demo root could scroll, it must not keep
  // the gesture inside the demo region.
  const demoRoot: NonNullable<DemoScrollProbe> = {
    parentElement: { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 },
  };
  const target: NonNullable<DemoScrollProbe> = {
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    parentElement: demoRoot,
    closest: (selector: string) => (selector === DEMO_OWNS_SCROLL_SELECTOR ? demoRoot : null),
  };
  assert.equal(demoRegionInnerCanScroll(target, 1), false);
});

test('gestures outside a demo region never report inner scroll ownership', () => {
  const outside: DemoScrollProbe = {
    scrollTop: 0,
    scrollHeight: 600,
    clientHeight: 200,
    closest: () => null,
  };
  assert.equal(demoRegionInnerCanScroll(outside, 1), false);
  assert.equal(demoRegionInnerCanScroll(null, 1), false);
});

test('paging keys ignore buttons, links, editable fields, and demo-region focus', () => {
  const button = { tagName: 'button', closest: () => null };
  const link = { tagName: 'A', closest: () => null };
  const editable = { isContentEditable: true, closest: () => null };
  const demoFocus = {
    tagName: 'DIV',
    closest: (selector: string) => (selector === DEMO_OWNS_SCROLL_SELECTOR ? {} : null),
  };
  const body = { tagName: 'BODY', closest: () => null };
  assert.equal(isPagingKeyExcludedTarget(button), true);
  assert.equal(isPagingKeyExcludedTarget(link), true);
  assert.equal(isPagingKeyExcludedTarget(editable), true);
  assert.equal(isPagingKeyExcludedTarget(demoFocus), true);
  assert.equal(isPagingKeyExcludedTarget(body), false);
  assert.equal(isPagingKeyExcludedTarget(null), false);
});

test('gestures inside an overlay layer outside the paging root never reach page paging', () => {
  const inside = {};
  const portalled = {};
  const root = { contains: (target: unknown) => target === inside };
  assert.equal(isEventOutsidePagingRoot(root, portalled), true);
  assert.equal(isEventOutsidePagingRoot(root, inside), false);
  // Missing root or target falls through to the normal paging path.
  assert.equal(isEventOutsidePagingRoot(null, portalled), false);
  assert.equal(isEventOutsidePagingRoot(root, null), false);
});

test('unfocused page keys targeting body still belong to the landing page', () => {
  const root = { contains: () => false };
  const body = { contains: (target: unknown) => target === root };
  assert.equal(isEventOutsidePagingRoot(root, body), false);
});
