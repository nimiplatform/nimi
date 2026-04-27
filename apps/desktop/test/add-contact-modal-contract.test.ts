import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readDesktopLocaleSource } from './helpers/read-desktop-locale';

function readSource(relativePath: string): string {
  return readFileSync(path.join(import.meta.dirname, relativePath), 'utf8');
}

test('add contact modal maps legacy handle prefix errors to user-facing copy', () => {
  const modalSource = readSource('../src/shell/renderer/features/contacts/add-contact-modal.tsx');
  const enSource = readDesktopLocaleSource('en');
  const zhSource = readDesktopLocaleSource('zh');

  assert.match(modalSource, /next === 'HANDLE_PREFIX_UNSUPPORTED'/);
  assert.match(modalSource, /AddContact\.legacyPrefixUnsupported/);
  assert.match(enSource, /"legacyPrefixUnsupported": "Use a handle or ID without @ or ~\."/);
  assert.match(zhSource, /"legacyPrefixUnsupported": "请直接输入 handle 或 ID，不要带 @ 或 ~。"/);
});
