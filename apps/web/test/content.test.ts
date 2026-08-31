import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('content keeps the consumer hero and SDK paths complete in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const expectedHero = locale === 'zh'
      ? {
          title: '让 AI 真正',
          titleAccent: '属于你。',
          primaryCta: '获取 Nimi',
          secondaryCta: '看看 Nimi 能做什么',
          proofPoints: ['开源', '本地优先', '自由选择 AI'],
        }
      : {
          title: 'Make AI',
          titleAccent: 'truly yours.',
          primaryCta: 'Get Nimi',
          secondaryCta: 'See what Nimi can do',
          proofPoints: ['Open source', 'Local-first', 'Choose your AI'],
        };
    assert.equal(content.hero.title, expectedHero.title);
    assert.equal(content.hero.titleAccent, expectedHero.titleAccent);
    assert.equal(content.hero.primaryCta, expectedHero.primaryCta);
    assert.equal(content.hero.secondaryCta, expectedHero.secondaryCta);
    assert.deepEqual(content.hero.proofPoints, expectedHero.proofPoints);
    assert.ok(content.hero.subtitle.length > 0);
    assert.ok(!JSON.stringify(content.hero).includes('pnpm install'));
    assert.ok(!JSON.stringify(content.hero).includes('nimi doctor'));
    assert.ok(content.sdk.tabs.length >= 3);
    assert.ok(content.sdk.tabs.every((tab) => tab.label.length > 0));
    assert.ok(content.sdk.tabs.every((tab) => tab.description.length > 0));
    assert.ok(content.sdk.tabs.every((tab) => tab.docsPath.startsWith('sdk/')));
    assert.ok(content.desktop.features.length >= 4);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.modelCatalog.title.length > 0);
    assert.ok(content.modelCatalog.overview.modalitiesDescription.length > 0);
    assert.ok(content.sdk.tabs.some((tab) => tab.docsPath === 'sdk/ai-config-surface'));
    assert.equal(content.security.statuses.length, 2);
    assert.ok(content.security.links.some((link) => link.href === '/download'));
    assert.ok(content.security.links.some((link) => link.href === '/code-signing'));
    assert.ok(content.security.links.some((link) => link.href === 'mailto:security@nimi.ai'));
  }
});

test('English homepage exposes fail-closed signing and separate preview status', async () => {
  const content = await loadLandingContent('en');
  assert.ok(content.hero.eyebrow.includes('Open-source'));
  assert.ok(content.desktop.availability.items.includes(
    'Windows release pending production code-signing approval',
  ));
  assert.ok(content.desktop.availability.items.includes(
    'Unsigned previews use explicit non-promotable vX.Y.Z-preview.N tags',
  ));
  assert.ok(content.apps.notes.some((item) => item.includes('ordinary install with download progress')));
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
