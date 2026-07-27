import assert from 'node:assert/strict';
import test from 'node:test';

import { RUNTIME_PAGE_META } from '../src/shell/renderer/features/runtime-config/runtime-config-meta-v11';
import { RUNTIME_SIDEBAR_ITEMS } from '../src/shell/renderer/features/runtime-config/runtime-config-sidebar';
import { normalizePageIdV11 } from '../src/shell/renderer/features/runtime-config/runtime-config-state-types';

const RUNTIME_SECTIONS = [
  'overview',
  'profiles',
  'models',
  'cloud',
  'environment',
  'advanced',
] as const;

const NON_NAVIGABLE_PAGE_IDS = [
  'recommend',
  'catalog',
  'data-management',
  'performance',
  'local',
  'runtime',
  'mods',
  'mod-developer',
] as const;

test('Runtime sidebar exposes the six product sections in order', () => {
  assert.deepEqual(
    RUNTIME_SIDEBAR_ITEMS.map((item) => item.id),
    [...RUNTIME_SECTIONS],
  );
  assert.deepEqual(
    RUNTIME_SIDEBAR_ITEMS.map((item) => item.label),
    [
      'Overview',
      'Profiles',
      'Models',
      'Cloud Connectors',
      'Environment',
      'Advanced',
    ],
  );
});

test('Runtime page metadata is defined for every navigable section', () => {
  assert.deepEqual(Object.keys(RUNTIME_PAGE_META).sort(), [...RUNTIME_SECTIONS].sort());
});

test('Runtime page normalization fails closed to Overview for non-navigable ids', () => {
  for (const pageId of NON_NAVIGABLE_PAGE_IDS) {
    assert.equal(normalizePageIdV11(pageId), 'overview');
  }
  for (const pageId of RUNTIME_SECTIONS) {
    assert.equal(normalizePageIdV11(pageId), pageId);
  }
});
