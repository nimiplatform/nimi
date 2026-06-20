import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const desktopDir = path.resolve(import.meta.dirname, '..');

function readDesktop(relativePath: string): string {
  return readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

test('settings profile summary uses visible light-surface text instead of white-on-white hero styling', () => {
  const source = readDesktop('src/shell/renderer/features/settings/settings-account-panel.tsx');
  const summaryStart = source.indexOf('data-testid="settings-profile-summary"');
  assert.notEqual(summaryStart, -1, 'profile summary must expose a stable test id');

  const summaryEnd = source.indexOf('{/* Basic Information */}', summaryStart);
  assert.notEqual(summaryEnd, -1, 'profile summary source slice must end before basic information');

  const summarySource = source.slice(summaryStart, summaryEnd);
  assert.match(summarySource, /text-\[var\(--nimi-text-primary\)\]/);
  assert.match(summarySource, /text-\[var\(--nimi-text-secondary\)\]/);
  assert.match(summarySource, /border-\[color-mix\(in_srgb,var\(--nimi-action-primary-bg\)_18%,transparent\)\]/);
  assert.doesNotMatch(summarySource, /text-white|text-white\/|bg-white\/20|from-mint-400|to-mint-600/);
});
