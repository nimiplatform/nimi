import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');

function declaredScopes() {
  const permissionSection = manifest.match(/permissions:\r?\n([\s\S]*?)disposition:/u)?.[1] || '';
  return [...permissionSection.matchAll(
    /^    - scope: ([^\r\n]+)\r?\n(?:      qualifier: ([^\r\n]+)\r?\n)?      purpose: ([^\r\n]+)$/gmu,
  )].map((match) => ({
    scope: match[1],
    qualifier: match[2] || '',
    purpose: match[3],
  }));
}

test('Zhiyu local-development manifest mirrors the active registry transparency scopes', () => {
  const scopes = declaredScopes();
  assert.deepEqual(scopes.map(({ scope, qualifier }) => qualifier ? `${scope}#${qualifier}` : scope), [
    'account.session.read',
    'data.scope.read#realm.worlds.read-probe',
    'agent.identity.project',
    'ai.spend.meter',
    'ai_profile.selection.consume',
    'memory.read.bounded#persona-scoped',
    'memory.write.admitted#session-scoped-chat-derived-projection',
    'notification.subscribe#proactive_interruptibility_v1.in_app_surface',
    'audit.read.scoped#zhiyu-own-audit-projections',
    'file.read.scoped#app-local-drafts',
    'file.write.scoped#app-local-drafts',
  ]);
  assert.ok(scopes.every(({ purpose }) => purpose.trim().length >= 24));
});

test('Zhiyu manifest declarations keep Runtime Agent operation authority in scoped binding requests', () => {
  const permissionScopes = declaredScopes().map(({ scope }) => scope);
  assert.ok(!permissionScopes.includes('runtime.agent.turn.read'));
  assert.ok(!permissionScopes.includes('runtime.agent.turn.write'));

  const requestSection = manifest.match(/  runtime_scoped_binding_requests:\r?\n([\s\S]*?)  electron:/u)?.[1] || '';
  const requests = [...requestSection.matchAll(
    /^    - scope: ([^\r\n]+)\r?\n      purpose: ([^\r\n]+)$/gmu,
  )].map((match) => ({ scope: match[1], purpose: match[2] }));
  assert.deepEqual(requests.map(({ scope }) => scope), [
    'runtime.agent.turn.read',
    'runtime.agent.turn.write',
    'runtime.agent.voice.transcribe',
    'runtime.agent.voice.read',
  ]);
  assert.ok(requests.every(({ purpose }) => purpose.trim().length >= 24));
});
