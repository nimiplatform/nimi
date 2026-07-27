import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { expect, test } from 'vitest';
import { renderDesktopOAuthResultPage } from '../src/logic/native-oauth-result-page.js';

const source = fs.readFileSync(
  path.join(import.meta.dirname, '../src/logic/native-oauth-result-page.ts'),
  'utf8',
);
const template = fs.readFileSync(
  path.join(import.meta.dirname, '../src/logic/native-oauth-result-page.template.html'),
  'utf8',
);
const shellTemplate = fs.readFileSync(
  path.join(import.meta.dirname, '../../shell/tauri/src/native-oauth-result-page.template.html'),
  'utf8',
);
const copyDistAssetsScript = fs.readFileSync(
  path.join(import.meta.dirname, '../../scripts/copy-dist-assets.mjs'),
  'utf8',
);
const currentDesktopLogoPng = fs.readFileSync(
  path.join(import.meta.dirname, '../../../apps/desktop/src/shell/renderer/assets/logo.png'),
);
const kitOAuthLogoPng = fs.readFileSync(
  path.join(import.meta.dirname, '../src/logic/native-oauth-result-logo.png'),
);

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function extractLogoDataUri(page: string): string {
  const match = page.match(/<img class="logo" src="(data:image\/png;base64,[^"]+)"/u);
  if (!match) {
    throw new Error('OAuth result page logo data URI not found');
  }
  return match[1];
}

function maxLineBytes(value: string): number {
  return Math.max(...value.split(/\r?\n/).map((line) => Buffer.byteLength(line, 'utf8')));
}

function averageLineBytes(value: string): number {
  const lines = value.split(/\r?\n/);
  return Buffer.byteLength(value, 'utf8') / lines.length;
}

test('desktop OAuth result page escapes interpolated text fields', () => {
  expect(source).toMatch(/function escapeHtml\(value: string\): string/);
  expect(source).toMatch(/replace\('__PAGE_TITLE__', escapeHtml\(input\.pageTitle\)\)/);
  expect(source).toMatch(/replace\('__HEADING__', escapeHtml\(input\.heading\)\)/);
  expect(source).toMatch(/replace\('__MESSAGE_PRIMARY__', escapeHtml\(input\.messagePrimary\)\)/);
});

test('desktop OAuth result page normalizes auto-close timer before script injection', () => {
  expect(source).toMatch(/function normalizeAutoCloseMs\(value: unknown\): number/);
  expect(source).toMatch(/const autoCloseMs = normalizeAutoCloseMs\(input\.autoCloseMs\)/);
  expect(source).toMatch(/setTimeout\(function\(\)\{window\.close\(\);\}, \$\{autoCloseMs\}\);/);
});

test('desktop OAuth result page keeps success visible for at least three seconds', () => {
  const page = renderDesktopOAuthResultPage({ status: 'success', autoCloseMs: 0 });
  expect(page).toContain('setTimeout(function(){window.close();}, 3000);');
});

test('kit dist asset copy keeps the native OAuth result template publishable', () => {
  expect(copyDistAssetsScript).toContain("'.html'");
});
