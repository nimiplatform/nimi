import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..');

function readDesktopSource(path: string): string {
  return readFileSync(resolve(repoRoot, 'src/shell/renderer', path), 'utf8');
}

function desktopSourceExists(path: string): boolean {
  return existsSync(resolve(repoRoot, 'src/shell/renderer', path));
}

test('CBDB legacy friend local chat path is removed from active Desktop sources', () => {
  const removedBase = ['realm', 'agent', 'friend'].join('-');
  assert.equal(
    desktopSourceExists(`features/explore/${removedBase}-actions.ts`),
    false,
  );
  assert.equal(
    desktopSourceExists(`features/explore/${removedBase}-state.ts`),
    false,
  );

  const threadModel = readDesktopSource('features/chat/chat-agent-thread-model.ts');
  assert.doesNotMatch(threadModel, new RegExp(['to', 'Agent', 'Friend', 'Targets', 'From', 'Social', 'Snapshot'].join('')));
  assert.doesNotMatch(threadModel, new RegExp(['parse', 'Agent', 'Friend', 'Target'].join('')));
});

test('CBDB character source materialization uses the SDK terminal materialization surface', () => {
  const materialization = readDesktopSource('features/explore/character-source-materialization.ts');
  const sourceIdentity = readDesktopSource('features/realm-source/realm-source-identity.ts');
  const materializationSurface = `${materialization}\n${sourceIdentity}`;
  assert.match(materialization, /sdk\.accountProduct\(\)\.materializeRealmSource/);
  assert.match(materialization, /materializeRealmSource/);
  assert.doesNotMatch(materialization, /intendedRuntimeAudience/);
  assert.doesNotMatch(materialization, /connectNimiRealmSource/);
  assert.doesNotMatch(materialization, new RegExp(['list', 'Nimi', 'Realm', 'Source', 'Connections'].join('')));
  assert.match(materialization, /resolveCharacterSourceRefV3/);
  assert.match(materializationSurface, /sourceHash/);
  assert.doesNotMatch(materializationSurface, /source_core_handoff_required/);
  assert.doesNotMatch(materializationSurface, new RegExp(['Agent', 'Friend'].join('')));
});

test('CBDB character source materialization maps runtime failures before showing UI feedback', () => {
  const materialization = readDesktopSource('features/explore/character-source-materialization.ts');
  assert.match(materialization, /characterSourceMaterializationFailureMessage/);
  assert.match(materialization, /characterSourceMaterializationRejectedMessage/);

  const uiSources = [
    'features/explore/explore-panel.tsx',
    'features/source-detail/source-detail-panel.tsx',
    'features/relationship/profile-detail-modal.tsx',
    'features/profile/profile-panel.tsx',
    'features/world/world-detail.tsx',
  ].map((path) => readDesktopSource(path));
  for (const source of uiSources) {
    assert.match(source, /characterSourceMaterializationFailureMessage/);
  }
  assert.doesNotMatch(
    uiSources.join('\n'),
    /message:\s*error instanceof Error \? error\.message : characterSourceMaterializationMessage\(\)/,
  );
});

test('CBDB runtime anchor metadata does not carry source/profile prompt authority', () => {
  const hostActions = readDesktopSource('features/chat/chat-agent-shell-host-actions-helpers.ts');

  assert.match(hostActions, /surface: 'desktop-agent-chat'/);
  assert.doesNotMatch(hostActions, new RegExp(['realm', 'Profile', 'Context'].join(''), 'i'));
  assert.doesNotMatch(hostActions, /sourceProfileId/);
  assert.doesNotMatch(hostActions, /forge-imported-system/);
});
