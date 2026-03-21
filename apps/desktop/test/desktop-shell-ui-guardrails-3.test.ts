import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

const blockedUsersSource = readSource('../src/shell/renderer/features/contacts/contacts-blocked-users.tsx');

test('contacts blocked users view does not carry an unused React default import', () => {
  assert.doesNotMatch(blockedUsersSource, /import React from 'react'/);
});
