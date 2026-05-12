import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('content includes hero install paths, SDK tabs, and mods in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    assert.ok(content.hero.tabs.length >= 3);
    assert.equal(
      content.hero.tabs.find((tab) => tab.id === 'install-shell')?.command,
      'curl -fsSL https://install.nimi.ai | sh',
    );
    assert.equal(
      content.hero.tabs.find((tab) => tab.id === 'install-npm')?.command,
      'npm install -g @nimiplatform/nimi',
    );
    assert.ok(
      content.hero.tabs
        .filter((tab) => ['platform', 'runtime', 'sdk'].includes(tab.id))
        .every((tab) => tab.command.startsWith(locale === 'zh' ? 'docs.nimi.ai/zh/' : 'docs.nimi.ai/')),
    );
    assert.ok(content.hero.tabs.every((tab) => !tab.command.includes('nimi serve')));
    assert.ok(content.sdk.tabs.length >= 3);
    assert.ok(content.sdk.tabs.every((tab) => tab.label.length > 0));
    assert.ok(content.sdk.tabs.every((tab) => tab.description.length > 0));
    assert.ok(content.sdk.tabs.every((tab) => tab.docsPath.startsWith('sdk/')));
    assert.ok(content.mods.items.length >= 3);
    assert.ok(content.desktop.features.length >= 4);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.modelCatalog.title.length > 0);
    assert.ok(content.modelCatalog.stats.models.length > 0);
    assert.ok(content.sdk.tabs.some((tab) => tab.docsPath === 'sdk/ai-config-surface'));
  }
});
