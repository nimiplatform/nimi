import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroSection } from '../src/landing/components/hero-section.js';
import { HeroDemoView } from '../src/landing/components/hero-demo.js';
import { DemoAppsSurface } from '../src/landing/components/demo-apps.js';
import { DemoZhiyuPreview } from '../src/landing/components/demo-zhiyu-preview.js';
import { landingLinkDefaults, resolveLocalizedLinks } from '../src/landing/config/landing-links.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('hero renders the slogan, download actions, and a size-stable demo fallback in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const links = resolveLocalizedLinks(landingLinkDefaults, locale);
    const html = renderToStaticMarkup(createElement(HeroSection, { content: content.hero, links }));

    assert.match(html, /aria-label="MAKE AI TRULY YOURS"/);
    assert.ok(html.includes('color:#38d6a3'));
    assert.ok(html.includes(content.hero.subSlogan));

    assert.match(html, /href="\/download\?lang=(en|zh)"/);
    assert.ok(html.includes(content.hero.docsCta));
    assert.ok(html.includes(content.hero.availableNote));

    // The interactive demo loads as its own chunk: static markup carries the
    // size-stable fallback frame, and other surfaces stay hidden until selected.
    assert.ok(html.includes(content.hero.demo.chat.greeting));
    assert.ok(!html.includes(content.hero.demo.settings.groups[0]?.label ?? '__none__'));
  }
});

test('desktop preview composes kit chat components with localized copy in both locales', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const demo = content.hero.demo;
    const html = renderToStaticMarkup(createElement(HeroDemoView, { demo }));

    // Kit transcript empty state with the localized greeting and a real composer.
    assert.ok(html.includes('data-canonical-transcript-root'));
    assert.ok(html.includes(demo.chat.greeting));
    assert.ok(html.includes(`placeholder="${demo.chat.inputPlaceholder}"`));
    assert.ok(html.includes(`aria-label="${demo.chat.sendLabel}"`));

    // Rail and narrow switcher expose all five preview surfaces.
    assert.ok(html.includes(demo.nav.chat));
    assert.ok(html.includes(demo.nav.explore));
    assert.ok(html.includes(demo.nav.apps));
    assert.ok(html.includes(demo.nav.runtime));
    assert.ok(html.includes(demo.nav.settings));

    // Every agent is a selectable conversation target.
    for (const agent of demo.chat.agents) {
      assert.ok(html.includes(`aria-label="${agent.name}"`));
    }

    // Settings and runtime content stay hidden until their surfaces are selected.
    assert.ok(!html.includes(demo.settings.groups[0]?.label ?? '__none__'));
    assert.ok(!html.includes(demo.runtime.groups[0]?.label ?? '__none__'));
    // The apps library stays hidden until its surface is selected.
    assert.ok(!html.includes('织羽 Zhiyu'));

    if (locale === 'zh') {
      // No kit default English copy leaks into the Chinese demo.
      assert.ok(!html.includes('This Moment'));
      assert.ok(!html.includes('Start the first turn'));
      assert.ok(!html.includes('aria-label="Send"'));
    }
  }
});

test('apps surface renders the two-pane library and the zhiyu preview mounts kit chat components', async () => {
  const content = await loadLandingContent('zh');
  const demo = content.hero.demo;

  const appsHtml = renderToStaticMarkup(createElement(DemoAppsSurface, { apps: demo.apps, preview: demo.appPreview }));
  assert.ok(appsHtml.includes(demo.apps.searchPlaceholder));
  assert.ok(appsHtml.includes(`${demo.apps.items.length}${demo.apps.countSuffix}`));
  assert.ok(appsHtml.includes('织羽 Zhiyu'));
  assert.ok(appsHtml.includes(demo.apps.launchLabel));
  // Row selection alone must not open the preview modal.
  assert.ok(!appsHtml.includes('data-testid="demo-app-preview"'));

  const zhiyuHtml = renderToStaticMarkup(createElement(DemoZhiyuPreview, { content: demo.appPreview.zhiyu }));
  assert.ok(zhiyuHtml.includes('data-canonical-transcript-root'));
  assert.ok(zhiyuHtml.includes(demo.appPreview.zhiyu.composerPlaceholder));
  assert.ok(zhiyuHtml.includes(`aria-label="${demo.appPreview.zhiyu.sendLabel}"`));
  for (const partner of demo.appPreview.zhiyu.partners) {
    assert.ok(zhiyuHtml.includes(`aria-label="${partner.name}"`));
  }
});
