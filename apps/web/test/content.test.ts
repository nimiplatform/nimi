import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('content includes hero source-start paths and SDK tabs in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    assert.ok(content.hero.tabs.length >= 3);
    assert.equal(
      content.hero.tabs.find((tab) => tab.id === 'start')?.command,
      'pnpm install && pnpm build:runtime',
    );
    assert.equal(
      content.hero.tabs.find((tab) => tab.id === 'runtime')?.command,
      './dist/nimi doctor',
    );
    assert.ok(
      content.hero.tabs
        .filter((tab) => ['platform', 'sdk'].includes(tab.id))
        .every((tab) => tab.command.startsWith(locale === 'zh' ? 'docs.nimi.ai/zh/' : 'docs.nimi.ai/')),
    );
    assert.ok(content.hero.tabs.every((tab) => !tab.command.includes('install.nimi.ai')));
    assert.ok(content.hero.tabs.every((tab) => !tab.command.includes('@nimiplatform/nimi')));
    assert.ok(content.hero.tabs.every((tab) => !tab.command.includes('nimi serve')));
    assert.ok(content.sdk.tabs.length >= 3);
    assert.ok(content.sdk.tabs.every((tab) => tab.label.length > 0));
    assert.ok(content.sdk.tabs.every((tab) => tab.description.length > 0));
    assert.ok(content.sdk.tabs.every((tab) => tab.docsPath.startsWith('sdk/')));
    assert.ok(content.desktop.features.length >= 4);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.modelCatalog.title.length > 0);
    assert.ok(content.modelCatalog.overview.modalitiesDescription.length > 0);
    assert.ok(content.sdk.tabs.some((tab) => tab.docsPath === 'sdk/ai-config-surface'));
  }
});

test('SDK landing content separates hero highlights from the full capability matrix', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const sdk = content.sdk as typeof content.sdk & {
      heroHighlights?: ReadonlyArray<{ title: string; description: string }>;
      runtimeBadges?: ReadonlyArray<string>;
      capabilityMatrix?: ReadonlyArray<{ title: string; description: string; docsPath: string }>;
    };

    assert.equal(sdk.heroHighlights?.length, 3);
    assert.ok(sdk.heroHighlights.every((item) => item.title.length > 0 && item.description.length > 0));
    assert.ok(sdk.runtimeBadges?.includes('Type-safe SDK'));
    assert.ok(sdk.runtimeBadges?.includes('Runtime-backed'));
    assert.ok(sdk.runtimeBadges?.includes('Local-first'));
    assert.ok(sdk.runtimeBadges?.includes('Agent Context'));
    assert.equal(sdk.capabilityMatrix?.length, content.sdk.tabs.length);
    assert.deepEqual(
      sdk.capabilityMatrix?.map((item) => item.docsPath),
      content.sdk.tabs.map((tab) => tab.docsPath),
    );
  }
});
