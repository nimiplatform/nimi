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

test('desktop OAuth result page keeps both templates compact and self-contained', () => {
  expect(template).toBe(shellTemplate);
  expect(template).toContain('__LOGO_DATA_URI__');
  expect(template).toContain('<img class="logo" src="__LOGO_DATA_URI__" alt="Nimi" aria-label="Nimi" />');
  expect(template).not.toContain('nimiLogoGradient');
  expect(template).not.toContain('<rect x="10" y="10" width="120" height="120"');
  expect(template).toContain('aria-label="Nimi"');
  expect(Buffer.byteLength(template, 'utf8')).toBeLessThan(60 * 1024);
  expect(maxLineBytes(template)).toBeLessThan(12_000);
  expect(averageLineBytes(template)).toBeLessThan(900);
});

test('desktop OAuth result page renders the current PNG Nimi logo asset', () => {
  expect(sha256(kitOAuthLogoPng)).toBe(sha256(currentDesktopLogoPng));

  const page = renderDesktopOAuthResultPage({ status: 'success', autoCloseMs: 3000 });
  expect(page).not.toContain('__LOGO_DATA_URI__');
  expect(page).not.toContain('nimiLogoGradient');

  const dataUri = extractLogoDataUri(page);
  const decoded = Buffer.from(dataUri.replace('data:image/png;base64,', ''), 'base64');
  expect(sha256(decoded)).toBe(sha256(currentDesktopLogoPng));
});

test('kit dist asset copy keeps the native OAuth result template publishable', () => {
  expect(copyDistAssetsScript).toContain("'.html'");
});
