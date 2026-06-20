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

test('desktop OAuth result page uses the native inline SVG logo in both templates', () => {
  expect(template).toBe(shellTemplate);
  expect(template).toContain('<svg class="logo" viewBox="184 313 380 380"');
  expect(template).toContain('fill="#1E377A"');
  expect(template).toContain('fill="#1F9BAB"');
  expect(template).not.toMatch(/data:image\/png;base64/);
});
