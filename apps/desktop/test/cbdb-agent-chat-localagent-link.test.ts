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

test('CBDB RealmPersona source admission is blocked on RuntimeSourceSnapshot handoff', () => {
  const admission = readDesktopSource('features/explore/realm-persona-source-admission.ts');
  assert.match(admission, /source_core_handoff_required/);
  assert.match(admission, /RuntimeSourceSnapshot materialization support/);
  assert.doesNotMatch(admission, new RegExp(['Agent', 'Friend'].join('')));
});
