import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = readFileSync(new URL('../nimi.app.yaml', import.meta.url), 'utf8');

function declaredScopes() {
  return [...manifest.matchAll(
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
  ]);
  assert.ok(scopes.every(({ purpose }) => purpose.trim().length >= 24));
});

test('Zhiyu manifest declarations do not claim Runtime turn binding authority', () => {
  assert.doesNotMatch(manifest, /^\s+scope: runtime\.agent\.turn\.(?:read|write)$/mu);
});
