import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const securityPageSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/features/settings/settings-security-page.tsx'),
  'utf8',
);

test('security page uses real password + 2FA APIs instead of timeout mock save', () => {
  assert.match(securityPageSource, /dataSync\.updatePassword\(/);
  assert.match(securityPageSource, /dataSync\.prepareTwoFactor\(/);
  assert.match(securityPageSource, /dataSync\.enableTwoFactor\(/);
  assert.match(securityPageSource, /dataSync\.disableTwoFactor\(/);
  assert.doesNotMatch(securityPageSource, /setTimeout\(/);
});
