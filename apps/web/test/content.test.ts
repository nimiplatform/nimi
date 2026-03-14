import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDING_CONTENT } from '../src/landing/content/landing-content.js';

test('content includes hero install paths, SDK tabs, and mods in both locales', () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = LANDING_CONTENT[locale];
    assert.ok(content.hero.tabs.length >= 3);
    assert.equal(content.hero.tabs[1]?.command, 'curl -fsSL https://install.nimi.xyz | sh');
    assert.equal(content.hero.tabs[2]?.command, 'npm install -g @nimiplatform/nimi');
    assert.ok(content.hero.tabs.every((tab) => !tab.command.includes('nimi serve')));
    assert.ok(content.sdk.tabs.length >= 3);
    assert.ok(content.sdk.tabs.every((tab) => tab.caption.length > 0));
    assert.ok(content.mods.items.length >= 6);
    assert.ok(content.desktop.features.length >= 4);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.modelCatalog.title.length > 0);
    assert.ok(content.modelCatalog.stats.models.length > 0);
    assert.ok(content.sdk.tabs.some((tab) => tab.snippet.includes('@nimiplatform/sdk')));
  }
});
