import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

const SECTION_KEYS = [
  'hero',
  'apps',
  'worlds',
  'capabilities',
  'create',
  'continuity',
  'developers',
  'getStarted',
] as const;

test('content exposes the full user journey in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);

    for (const key of SECTION_KEYS) {
      assert.ok(content[key], `${locale}.${key} is missing`);
    }

    assert.ok(content.hero.slogan.length > 0);
    assert.ok(content.hero.sloganAccent.length > 0);
    assert.ok(content.hero.slogan.endsWith(content.hero.sloganAccent));
    assert.ok(content.hero.subSlogan.length > 0);
    assert.ok(content.hero.downloadCta.length > 0);
    assert.ok(content.hero.docsCta.length > 0);
    assert.ok(content.hero.demo.nav.chat.length > 0);
    assert.ok(content.hero.demo.nav.explore.length > 0);
    assert.ok(content.hero.demo.nav.apps.length > 0);
    assert.ok(content.hero.demo.nav.runtime.length > 0);
    assert.ok(content.hero.demo.nav.settings.length > 0);
    assert.ok(content.hero.demo.chat.greeting.length > 0);
    assert.ok(content.hero.demo.chat.sendLabel.length > 0);
    assert.ok(content.hero.demo.chat.scriptedReply.length > 0);
    assert.ok(content.hero.demo.chat.agents.length >= 2);
    assert.ok(content.hero.demo.chat.agents.every((agent) => agent.messages.length >= 1));
    assert.ok(content.hero.demo.chat.agents.some((agent) => agent.id === content.hero.demo.chat.defaultTargetId));
    assert.ok(content.hero.demo.explore.sections.length >= 2);
    assert.ok(content.hero.demo.apps.items.length >= 3);
    assert.ok(content.hero.demo.settings.groups.length >= 2);

    // The apps screen is the demo window under a centered section header.
    assert.equal(
      content.apps.title,
      locale === 'zh'
        ? '从工作到兴趣，探索不同的 AI 应用。'
        : 'From work to interests, explore different AI apps.',
    );
    assert.ok(content.apps.subtitle.length > 0);

    assert.ok(content.worlds.title.length > 0);
    assert.ok(content.capabilities.tasks.length >= 4);
    assert.ok(content.create.steps.length >= 3);
    assert.ok(content.continuity.supports.length >= 2);
    assert.ok(content.developers.points.length >= 3);
    assert.ok(content.getStarted.primaryCta.length > 0);
    assert.ok(content.footer.line1.length > 0);
    assert.ok(content.localeOptions.en.length > 0 && content.localeOptions.zh.length > 0);
  }
});

test('landing copy stays capability-first without provider names or deferred capabilities', async () => {
  const banned = [
    /OpenAI/i,
    /Anthropic/i,
    /Claude/i,
    /Gemini/i,
    /DeepSeek/i,
    /Mistral/i,
    /Qwen/i,
    /Ollama/i,
    /vLLM/i,
    /Cohere/i,
    /Bedrock/i,
    /world\.generate/i,
    /世界生成/,
  ];

  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const serialized = JSON.stringify(content);
    for (const pattern of banned) {
      assert.doesNotMatch(serialized, pattern, `${locale} contains ${pattern}`);
    }
  }
});

test('landing copy keeps the cost and open-source boundaries honest', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const serialized = JSON.stringify(content);

    assert.match(serialized, locale === 'zh' ? /Nimi 本身免费/ : /Nimi itself is free/);
    assert.match(
      serialized,
      locale === 'zh' ? /第三方 App 是否收费由发布者决定/ : /third-party app charges is up to its publisher/,
    );
    assert.doesNotMatch(serialized, /从头到尾，全部开源|everything is open source/i);
    assert.doesNotMatch(serialized, /完整源码|complete source code/i);
  }
});

test('navigation and menu labels support keyboard-accessible section routing', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    assert.ok(content.nav.apps.length > 0);
    assert.ok(content.nav.worlds.length > 0);
    assert.ok(content.nav.create.length > 0);
    assert.ok(content.nav.developers.length > 0);
    assert.ok(content.nav.docs.length > 0);
    assert.ok(content.nav.menu.length > 0);
    assert.ok(content.nav.openMenu.length > 0);
    assert.ok(content.nav.closeMenu.length > 0);
  }
});
