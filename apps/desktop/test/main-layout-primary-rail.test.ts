import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldHideMainLayoutPrimaryRail } from '../src/shell/renderer/app-shell/layouts/main-layout-primary-rail.js';

test('source detail keeps the authenticated shell primary rail visible', () => {
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'source-detail',
    selectedProfileId: null,
    profileDetailOverlayOpen: false,
  }), false);
});

test('only explicit immersive or overlay states hide the primary rail', () => {
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'gift-inbox',
    selectedProfileId: null,
    profileDetailOverlayOpen: false,
  }), true);
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'profile',
    selectedProfileId: 'profile-1',
    profileDetailOverlayOpen: false,
  }), true);
  assert.equal(shouldHideMainLayoutPrimaryRail({
    activeTab: 'home',
    selectedProfileId: null,
    profileDetailOverlayOpen: true,
  }), true);
});
