import assert from 'node:assert/strict';
import test from 'node:test';

import { toSafeBackgroundImage } from '../src/shell/renderer/features/explore/explore-background-image';

test('top agent cards sanitize banner URLs before interpolating them into background images', () => {
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: {
      location: {
        href: 'https://app.nimi.example/explore',
      },
    },
    configurable: true,
  });
  try {
    assert.equal(toSafeBackgroundImage('javascript:alert(1)'), null);
    assert.equal(toSafeBackgroundImage('data:text/html,boom'), null);
    assert.equal(
      toSafeBackgroundImage('https://cdn.nimi.example/banner.png'),
      'url("https://cdn.nimi.example/banner.png")',
    );
  } finally {
    Object.defineProperty(globalThis, 'window', {
      value: previousWindow,
      configurable: true,
    });
  }
});
