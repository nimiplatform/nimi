import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopRoot = path.join(import.meta.dirname, '..');

function readDesktop(pathname: string): string {
  return fs.readFileSync(path.join(desktopRoot, pathname), 'utf8');
}

test('CBDB legacy source-open E2E journey is not registered after Realm core hard cut', () => {
  const legacyName = ['agent', 'friend'].join('');
  const legacyScenario = ['chat', 'cbdb', legacyName, 'open'].join('-').replace('chat-', 'chat.');
  const registrySource = readDesktop('e2e/helpers/registry.mjs');
  const fixtureServerSource = readDesktop('e2e/fixtures/realm-fixture-server.mjs');

  assert.doesNotMatch(registrySource, new RegExp(legacyScenario));
  assert.equal(
    fs.existsSync(path.join(desktopRoot, `e2e/specs/${legacyScenario}.e2e.mjs`)),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(desktopRoot, `e2e/fixtures/profiles/${legacyScenario}.json`)),
    false,
  );
  assert.doesNotMatch(fixtureServerSource, new RegExp(['/api/human/me/friends', 'agent-limit'].join('/')));
});

test('Explore source card E2E selector remains and primary action materializes a local agent', () => {
  const e2eIdsSource = readDesktop('src/shell/renderer/testability/e2e-ids.ts');
  const personaSourceCardSource = readDesktop('src/shell/renderer/features/explore/explore-persona-source-card.tsx');

  assert.match(e2eIdsSource, /explorePersonaSourceCard:\s*\(sourceId: string\) => `explore-persona-source-card:\$\{sourceId\}`/);
  assert.match(e2eIdsSource, /explorePersonaSourcePrimaryAction:\s*\(sourceId: string\) => `explore-persona-source-primary-action:\$\{sourceId\}`/);
  assert.match(personaSourceCardSource, /data-source-state=\{sourceState\}/);
  assert.match(personaSourceCardSource, /source_materializable/);
  assert.doesNotMatch(personaSourceCardSource, /source_connected/);
  assert.doesNotMatch(personaSourceCardSource, /source_core_handoff_required/);
});
