import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

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
const currentLogoDataUri = `data:image/png;base64,${fs.readFileSync(
  path.join(import.meta.dirname, '../../../apps/desktop/src/shell/renderer/assets/logo.png'),
).toString('base64')}`;

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

test('desktop OAuth result page uses the current PNG Nimi logo in both templates', () => {
  expect(template).toBe(shellTemplate);
  expect(template.includes(`<img class="logo" src="${currentLogoDataUri}" alt="Nimi" />`)).toBe(true);
  expect(template).not.toContain('<svg class="logo" viewBox="184 313 380 380"');
  expect(template).not.toContain('fill="#1E377A"');
  expect(template).not.toContain('fill="#1F9BAB"');
});
