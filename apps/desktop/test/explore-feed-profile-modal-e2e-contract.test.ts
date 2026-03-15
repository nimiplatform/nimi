import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const registrySource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/registry.mjs'),
  'utf8',
);

test('explore feed profile modal journey is registered in the desktop E2E registry', () => {
  assert.match(
    registrySource,
    /\['explore\.feed-profile-modal',\s*\{\s*bucket:\s*'journeys',\s*profile:\s*'explore\.feed-profile-modal\.json',\s*spec:\s*'apps\/desktop\/e2e\/specs\/explore\.feed-profile-modal\.e2e\.mjs'\s*\}\]/,
  );
});

test('explore feed profile modal journey fixture and spec files exist', () => {
  const fixturePath = path.join(desktopRoot, 'e2e/fixtures/profiles/explore.feed-profile-modal.json');
  const specPath = path.join(desktopRoot, 'e2e/specs/explore.feed-profile-modal.e2e.mjs');

  assert.equal(fs.existsSync(fixturePath), true, `missing fixture profile: ${fixturePath}`);
  assert.equal(fs.existsSync(specPath), true, `missing E2E spec: ${specPath}`);
});
