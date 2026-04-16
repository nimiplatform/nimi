import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');
const registrySource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/registry.mjs'),
  'utf8',
);
const selectorsSource = fs.readFileSync(
  path.join(desktopRoot, 'e2e/helpers/selectors.mjs'),
  'utf8',
);

test('tester speech bundle journey is registered in the desktop E2E registry', () => {
  assert.match(
    registrySource,
    /\['tester\.speech-bundle-panels',\s*\{\s*bucket:\s*'journeys',\s*profile:\s*'tester\.speech-bundle-panels\.json',\s*spec:\s*'apps\/desktop\/e2e\/specs\/tester\.speech-bundle-panels\.e2e\.mjs'\s*\}\]/,
  );
});

test('tester speech bundle journey fixture and spec files exist', () => {
  const fixturePath = path.join(desktopRoot, 'e2e/fixtures/profiles/tester.speech-bundle-panels.json');
  const specPath = path.join(desktopRoot, 'e2e/specs/tester.speech-bundle-panels.e2e.mjs');

  assert.equal(fs.existsSync(fixturePath), true, `missing fixture profile: ${fixturePath}`);
  assert.equal(fs.existsSync(specPath), true, `missing E2E spec: ${specPath}`);
});

test('tester speech bundle journey exports stable selector helpers', () => {
  assert.match(selectorsSource, /testerCapabilityTab: \(capabilityId\) => `tester-capability-tab:\$\{capabilityId\}`,/);
  assert.match(selectorsSource, /testerPanel: \(capabilityId\) => `tester-panel:\$\{capabilityId\}`,/);
  assert.match(selectorsSource, /testerInput: \(name\) => `tester-input:\$\{name\}`,/);
});
