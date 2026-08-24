import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldHideMainLayoutPrimaryRail } from '../src/shell/renderer/app-shell/layouts/main-layout-primary-rail.js';

test('source detail keeps the authenticated shell primary rail visible', () => {
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'source-detail',
    profileDetailOverlayOpen: false,
  }), false);
});

test('human profile detail keeps the authenticated shell primary rail visible', () => {
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'profile',
    profileDetailOverlayOpen: false,
  }), false);
});

test('only explicit overlay states hide the primary rail', () => {
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'home',
    profileDetailOverlayOpen: true,
  }), true);
});
