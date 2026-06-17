import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoSrc = resolve(__dirname, '../src');

function read(relativePath: string): string {
  return readFileSync(resolve(repoSrc, relativePath), 'utf8');
}

test('source admission quota projection surface is removed after Realm core hard cut', () => {
  const legacyLimitName = ['load', 'Agent', 'Friend', 'Limit'].join('');
  const legacyFetchName = ['fetch', 'Agent', 'Friend', 'Limit'].join('');
  const legacySdkFetchName = ['fetch', 'Nimi', 'Realm', 'Agent', 'Friend', 'Limit'].join('');
  const legacyLimitPath = ['agent', 'friend', 'limit'].join('-');
  assert.equal(
    existsSync(resolve(repoSrc, `shell/renderer/features/relationship/${legacyLimitPath}.ts`)),
    false,
  );
  assert.doesNotMatch(
    read('shell/renderer/features/social/data/realm-social-data.ts'),
    new RegExp(legacyLimitName),
  );
  assert.doesNotMatch(
    read('shell/renderer/features/social/data/profile-data.ts'),
    new RegExp(`${legacyFetchName}|${legacyLimitName}`),
  );
  assert.doesNotMatch(
    read('shell/renderer/features/social/data/social-snapshot.ts'),
    new RegExp(`${legacyFetchName}|${legacySdkFetchName}`),
  );
});
