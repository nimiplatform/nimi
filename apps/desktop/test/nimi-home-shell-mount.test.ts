import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const mainLayoutViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/layouts/main-layout-view.tsx'),
  'utf8',
);
const uiSliceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/ui-slice.ts'),
  'utf8',
);
const homeViewSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/home/home-view.tsx'),
  'utf8',
);

// D-HOMEFEED-001 / D-HOMEFEED-003: the `home` primary-nav tab renders the Realm
// feed surface, not the `Nimi Home` installed-shell panel (`NimiHomePanel`).
test('home tab mounts the Realm feed Home surface, not the Nimi Home shell panel', () => {
  assert.match(mainLayoutViewSource, /features\/home\/home-panel/);
  assert.match(mainLayoutViewSource, /default:\s*mod\.HomePanel/);
  assert.doesNotMatch(mainLayoutViewSource, /features\/nimi-home\/nimi-home-panel/);
  assert.doesNotMatch(mainLayoutViewSource, /NimiHomePanel/);
});

// D-HOMEFEED-002: ready Desktop entry is Chat; `home` remains a primary destination.
test('ready Desktop entry starts at Chat while Home remains a primary destination', () => {
  assert.match(uiSliceSource, /activeTab:\s*'chat'/);
  assert.match(mainLayoutViewSource, /E2E_IDS\.navTab\('home'\)/);
});

// D-HOMEFEED-001 / D-HOMEFEED-005: the Home feed surface presents the Realm feed
// and a Create Post affordance.
test('Home feed surface presents the Realm post feed and Create Post affordance', () => {
  for (const expected of ['PostFeed', 'CreatePostModal', 'createPostRequestKey']) {
    assert.ok(homeViewSource.includes(expected), `missing ${expected}`);
  }
});

// D-HOMEFEED-006: the Home feed surface consumes the SDK-typed Realm feed
// projection through the Desktop Realm data adapter, not a renderer-local raw fetch.
test('Home feed surface consumes the SDK-typed Realm feed projection', () => {
  assert.match(homeViewSource, /realmSocialData\.loadPostFeed/);
});
