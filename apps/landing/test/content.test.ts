import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDING_CONTENT } from '../src/content/landing-content.js';

test('content includes protocol primitives and core stack in both locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = LANDING_CONTENT[locale];
    assert.equal(content.stack.items.length, 3);
    assert.equal(content.protocol.items.length, 6);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.quickstart.sdkSnippet.includes('@nimiplatform/sdk'));
  }
});
