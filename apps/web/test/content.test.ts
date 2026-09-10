import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('content keeps the consumer hero and SDK paths complete in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    assert.ok(content.hero.title.length > 0);
    assert.ok(content.hero.titleAccent.length > 0);
    assert.match(content.hero.primaryCta, /download|下载/i);
    assert.ok(content.hero.secondaryCta.length > 0);
    assert.ok(content.hero.proofPoints.every((point) => point.length > 0));
    assert.match(content.hero.availability, /Nimi Home/);
    assert.match(content.hero.availability, /not available to install|暂未提供安装包/);
    assert.match(content.hero.availability, /developer preview|开发者/);
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

test('homepage lifecycle disclosures and developer FAQ agree on current distribution', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const notes = content.apps.notes.join('\n');
    assert.match(notes, /Registry/);
    assert.match(notes, /immutable local-package import|不可变本地包导入/);
    assert.match(notes, /Developer Mode/);
    assert.match(notes, /Windows x86_64/);
    assert.match(notes, /remain unavailable|仍待实现/);
    const developerFaq = content.faq.items.find((item) => /developer|开发者/i.test(item.question));
    assert.ok(developerFaq);
    assert.match(developerFaq.answer, /Developer Mode/);
    assert.match(developerFaq.answer, /pilot|试点/);
    assert.match(developerFaq.answer, /Windows x86_64/);
    assert.match(developerFaq.answer, /human admission|人工准入/);
    assert.match(developerFaq.answer, /remain unavailable|仍不可用/);
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

test('homepage leads with consumer experiences and keeps download honesty', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);

    assert.equal(content.experiences.cards.length, 3);
    assert.deepEqual(content.experiences.cards.map((card) => card.id), ['conversation', 'memory', 'proactive-companion']);
    assert.ok(content.experiences.cards.every((card) => (
      card.title.length > 0
      && card.description.length > 0
      && card.scenario.length > 0
      && card.points.length >= 3
    )));

    assert.ok(content.nav.experiences.length > 0);
    assert.ok(content.nav.docs.length > 0);
    assert.ok(content.nav.download.length > 0);

    const downloadFaq = content.faq.items.find((item) => (
      item.question === (locale === 'zh' ? '今天能下载 Nimi 吗？' : 'Can I download Nimi today?')
    ));
    assert.ok(downloadFaq);
    assert.match(
      downloadFaq.answer,
      locale === 'zh' ? /没有已发布的 Nimi 稳定版/ : /No stable Nimi release or installer is currently published/,
    );
    assert.match(downloadFaq.answer, /v0\.2\.2-preview\.1/);
  }
});
