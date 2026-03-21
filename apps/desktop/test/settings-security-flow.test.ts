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

test('security page hides TOTP setup secrets behind an explicit reveal toggle', () => {
  assert.match(securityPageSource, /const \[revealTwoFactorSecret, setRevealTwoFactorSecret\] = useState\(false\)/);
  assert.match(securityPageSource, /maskedTwoFactorSecret/);
  assert.match(securityPageSource, /SecuritySettings\.revealSecret/);
  assert.match(securityPageSource, /SecuritySettings\.copySecret/);
  assert.doesNotMatch(securityPageSource, /Secret: \{twoFactorSecret\}/);
  assert.doesNotMatch(securityPageSource, /URI: \{twoFactorUri\}/);
});

test('security page removes unpersisted login alerts toggle until backend persistence exists', () => {
  assert.doesNotMatch(securityPageSource, /const \[loginAlerts, setLoginAlerts\]/);
  assert.doesNotMatch(securityPageSource, /SecuritySettings\.loginAlertsTitle/);
  assert.doesNotMatch(securityPageSource, /SecuritySettings\.emailAlertsLabel/);
});
