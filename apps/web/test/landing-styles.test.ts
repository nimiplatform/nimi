import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const landingStylesSource = readFileSync(
  new URL('../src/landing/styles.css', import.meta.url),
  'utf8',
);

test('landing anchors reserve sticky header space', () => {
  assert.match(landingStylesSource, /scroll-margin-top:\s*5rem/);
});

test('landing nav labels do not wrap across glyphs', () => {
  assert.match(landingStylesSource, /\.nav-anchor\s*{[^}]*white-space:\s*nowrap/s);
});
