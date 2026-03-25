import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const webStylesSource = readFileSync(
  new URL('../src/web-styles.css', import.meta.url),
  'utf8',
);

test('web styles scan desktop renderer and consumed nimi-kit source trees', () => {
  const requiredSources = [
    '@source "../../../kit/ui/src/**/*.{ts,tsx}";',
    '@source "../../../kit/auth/src/**/*.{ts,tsx}";',
    '@source "../../../kit/features/chat/src/**/*.{ts,tsx}";',
    '@source "../../../kit/features/commerce/src/**/*.{ts,tsx}";',
    '@source "../../../kit/features/generation/src/**/*.{ts,tsx}";',
    '@source "../../../kit/features/model-picker/src/**/*.{ts,tsx}";',
    '@source "../../desktop/src/shell/renderer/**/*.{ts,tsx}";',
    '@source "./**/*.{ts,tsx}";',
  ];

  for (const sourceLine of requiredSources) {
    assert.ok(
      webStylesSource.includes(sourceLine),
      `expected web-styles.css to include ${sourceLine}`,
    );
  }
});
