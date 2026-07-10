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
    assert.ok(content.modelCatalog.stats.models.length > 0);
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
    assert.ok(sdk.runtimeBadges?.includes('Runtime Ready'));
    assert.ok(sdk.runtimeBadges?.includes('Local-first'));
    assert.ok(sdk.runtimeBadges?.includes('Agent Context'));
    assert.equal(sdk.capabilityMatrix?.length, content.sdk.tabs.length);
    assert.deepEqual(
      sdk.capabilityMatrix?.map((item) => item.docsPath),
      content.sdk.tabs.map((tab) => tab.docsPath),
    );
  }
});

test('landing content uses Apps vocabulary and does not expose retired Mod copy', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const serializedContent = JSON.stringify(content);

    assert.doesNotMatch(serializedContent, /\bMOD\b|\bMods\b|\bMod\b|mod-system|\bextension entry point\b|旧扩展入口/i);
    assert.ok(/app|应用/i.test(content.architecture.diagram.appLabel));
    assert.ok(
      content.desktop.features.some((feature) =>
        /app|应用/i.test(`${feature.title} ${feature.description}`),
      ),
    );
    assert.ok(content.faq.items.some((item) => /Nimi App|应用/.test(`${item.question} ${item.answer}`)));
  }
});

test('Apps section uses product-facing language instead of internal governance terms', async () => {
  const internalTerms =
    /registry|package truth|surface|projection|admission|adoption|admitted boundaries|ordinary-visible|runtime registration|package kind|trust tier|release descriptor|已准入|准入|投影|产品单元|公开可安装|不等于公开目录/i;

  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const appFaq = content.faq.items.find((item) => /Nimi App|应用/.test(item.question));
    const productFacingCopy = JSON.stringify({ apps: content.apps, appFaq });

    assert.doesNotMatch(productFacingCopy, internalTerms);
  }
});

test('landing copy avoids internal governance vocabulary in public-facing sections', async () => {
  const internalTerms =
    /\badmit(?:s|ted)?\b|\badmission\b|\bordinary-visible\b|\bregistry\b|\bprojection\b|\bruntime registration\b|\btrust tier\b|\brelease descriptor\b/i;
  const nonVisibleKeys = new Set(['command', 'docsPath', 'icon', 'id', 'marqueeProviderOrder', 'previewMediaId']);

  function collectVisibleStrings(value: unknown): string[] {
    if (typeof value === 'string') {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => collectVisibleStrings(item));
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        nonVisibleKeys.has(key) ? [] : collectVisibleStrings(child),
      );
    }
    return [];
  }

  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const publicCopy = collectVisibleStrings({
      hero: content.hero,
      architecture: content.architecture,
      modelCatalog: content.modelCatalog,
      sdk: content.sdk,
      desktop: content.desktop,
      apps: content.apps,
      faq: content.faq,
      security: content.security,
      openSource: content.openSource,
      footer: content.footer,
    }).join('\n');

    assert.doesNotMatch(publicCopy, internalTerms);
  }
});
