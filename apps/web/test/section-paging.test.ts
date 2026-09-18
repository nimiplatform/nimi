import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEMO_OWNS_SCROLL_SELECTOR,
  isEventOwnedByDemoRegion,
  isPagingKeyExcludedTarget,
  resolvePagingDecision,
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
