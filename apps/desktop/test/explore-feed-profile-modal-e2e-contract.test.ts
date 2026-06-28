import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const registrySource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/registry.mjs'),
  'utf8',
);
const specSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/specs/explore.feed-profile-modal.e2e.mjs'),
  'utf8',
);
const e2eSelectorsSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/selectors.mjs'),
  'utf8',
);
const rendererSelectorsSource = fs.readFileSync(
  path.join(desktopRoot, 'src/shell/renderer/testability/e2e-ids.ts'),
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

test('explore feed profile modal journey opens the activity feed before selecting an author', () => {
  assert.match(rendererSelectorsSource, /exploreSectionTab:\s*\(sectionId: string\) => `explore-section-tab-\$\{sectionId\}`/);
  assert.match(rendererSelectorsSource, /exploreSection:\s*\(sectionId: string\) => `explore-\$\{sectionId\}-section`/);
  assert.match(e2eSelectorsSource, /const suffix = match\[2\] \|\| '';/);
  assert.match(e2eSelectorsSource, /return \(value\) => `\$\{prefix\}\$\{value\}\$\{suffix\}`;/);
  assert.match(e2eSelectorsSource, /const exploreSectionTabTestId = readRendererSelectorFactory\('exploreSectionTab', 'sectionId'\);/);
  assert.match(e2eSelectorsSource, /const exploreSectionTestId = readRendererSelectorFactory\('exploreSection', 'sectionId'\);/);
  assert.match(specSource, /clickByTestId\(E2E_IDS\.exploreSectionTab\('activity'\)\)/);
  assert.match(specSource, /waitForTestId\(E2E_IDS\.exploreSection\('activity'\)\)/);
  assert.ok(
    specSource.indexOf("E2E_IDS.exploreSection('activity')") < specSource.indexOf("E2E_IDS.feedPostAuthor('post-explore-author-1')"),
    'journey must enter Activity before relying on feed author selectors',
  );
});
