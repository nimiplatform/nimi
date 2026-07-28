import { expect, test } from 'vitest';
import { renderDesktopOAuthResultPage } from '../src/logic/native-oauth-result-page.js';

function renderedAutoCloseMs(value: unknown): number {
  const page = renderDesktopOAuthResultPage({
    status: 'success',
    autoCloseMs: value as number,
  });
  const match = page.match(/setTimeout\(function\(\)\{window\.close\(\);\}, (\d+)\);/u);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

test('desktop OAuth result page renders the fixed completion disclosure without template residue', () => {
  const page = renderDesktopOAuthResultPage({ status: 'success' });
  expect(page).toContain('<title>OAuth Complete - Nimi</title>');
  expect(page).toContain('<h1>Authentication Complete!</h1>');
  expect(page).toContain('<p>You have successfully signed in to Nimi.</p>');
  expect(page).not.toMatch(/__[A-Z][A-Z0-9_]+__/u);
});

test('desktop OAuth result page normalizes the public auto-close value into bounded output', () => {
  for (const [value, expected] of [
    [undefined, 3000],
    [Number.NaN, 3000],
    [Number.POSITIVE_INFINITY, 3000],
    [-1, 3000],
    [0, 3000],
    [3456.6, 3457],
    [30_001, 30_000],
  ] as const) {
    expect(renderedAutoCloseMs(value)).toBe(expected);
  }
});

test('desktop OAuth result page rejects script-shaped auto-close input from rendered output', () => {
  const injection = '0);globalThis.compromised=true;//';
  const page = renderDesktopOAuthResultPage({
    status: 'success',
    autoCloseMs: injection as unknown as number,
  });
  expect(renderedAutoCloseMs(injection)).toBe(3000);
  expect(page).not.toContain(injection);
  expect(page).not.toContain('globalThis.compromised');
});

test('desktop OAuth error result does not schedule automatic window close', () => {
  const page = renderDesktopOAuthResultPage({ status: 'error', autoCloseMs: 5_000 });
  expect(page).toContain('<title>OAuth Failed - Nimi</title>');
  expect(page).not.toContain('setTimeout(');
});
