import assert from 'node:assert/strict';
import test from 'node:test';
import { dcoFailures } from './lib/dco.mjs';

function commit(message, overrides = {}) {
  return {
    sha: 'test-commit', parents: [{}], author: { type: 'User' },
    commit: {
      author: { name: 'Contributor', email: 'contributor@example.com' },
      committer: { name: 'Maintainer', email: 'maintainer@example.com' },
      message,
    },
    ...overrides,
  };
}

test('unsigned and mismatched commits fail without writing or manufacturing a sign-off', () => {
  for (const message of ['fix: behavior', 'fix: behavior\n\nSigned-off-by: Stranger <other@example.com>']) {
    const value = commit(message);
    assert.equal(dcoFailures([value]).length, 1);
    assert.equal(value.commit.message, message);
  }
});

test('existing author/committer and multiple-signoff semantics are retained', () => {
  for (const signoff of ['Contributor <contributor@example.com>', 'Maintainer <maintainer@example.com>', 'CONTRIBUTOR <CONTRIBUTOR@example.com>']) {
    assert.deepEqual(dcoFailures([commit(`fix: behavior\n\nSigned-off-by: ${signoff}`)]), []);
  }
  assert.deepEqual(dcoFailures([commit('fix\n\nSigned-off-by: Other <other@example.com>\nSigned-off-by: Contributor <contributor@example.com>')]), []);
});

test('only existing merge and GitHub Bot exemptions bypass sign-off validation', () => {
  assert.deepEqual(dcoFailures([commit('merge', { parents: [{}, {}] })]), []);
  assert.deepEqual(dcoFailures([commit('dependency update', { author: { type: 'Bot' } })]), []);
  assert.equal(dcoFailures([commit('unsigned', { author: null })]).length, 1);
});
