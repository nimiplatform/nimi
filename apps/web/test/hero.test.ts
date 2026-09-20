import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroSection } from '../src/landing/components/hero-section.js';
import { HeroDemoView } from '../src/landing/components/hero-demo.js';
import { AppsSection } from '../src/landing/components/apps-section.js';
import { DemoAppsSurface } from '../src/landing/components/demo-apps.js';
import { DemoZhiyuPreview } from '../src/landing/components/demo-zhiyu-preview.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { resolveLandingLinks } from '../src/landing/config/landing-links.js';

test('hero renders the slogan with the demo preview on the same screen in both locales', async () => {
  const links = resolveLandingLinks();
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    const html = renderToStaticMarkup(createElement(HeroSection, { content: content.hero, links }));

    assert.ok(html.includes(`aria-label="${content.hero.slogan}"`));
    // Flat editorial headline: one dark ink, no per-character gradient.
    assert.ok(!html.includes('color:#38d6a3'));
    assert.ok(html.includes('text-ink'));

    // The sub-slogan renders line by line, followed by the lighter note.
    for (const line of content.hero.subSlogan.split('\n')) {
      assert.ok(html.includes(line));
    }
    assert.ok(html.includes(content.hero.subSloganNote));

    // One primary download CTA plus a quiet secondary link that opens the
    // docs folder on GitHub in a new tab.
    assert.ok(html.includes(`href="${links.downloadUrl}"`));
    assert.ok(html.includes(content.hero.downloadCta));
    assert.ok(html.includes(`href="${links.docsSourceUrl}" target="_blank" rel="noreferrer"`));
    assert.ok(html.includes(content.hero.docsCta));
    assert.ok(!html.includes('href="#apps"'));
    // Product presentation: the window uses the shared frame chrome with its
    // brand halo, and the two actions carry distinct weights.
    assert.ok(html.includes('hero-demo-frame'));
    assert.ok(html.includes('hero-glow'));
    assert.ok(html.includes('hero-cta-primary'));
    assert.ok(html.includes('hero-cta-secondary'));

    // Title and demo share the first screen: one hero section, no separate
    // demo section below it.
    assert.ok(html.includes('id="hero"'));
    assert.ok(!html.includes('id="demo"'));

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

test('the morph override pins the hero demo to the apps surface', async () => {
  const content = await loadLandingContent('zh');
  const demo = content.hero.demo;
  const html = renderToStaticMarkup(createElement(HeroDemoView, { demo, surfaceOverride: 'apps' }));

  // While the morph runs, the zooming hero window already shows apps content.
  assert.ok(html.includes(demo.apps.searchPlaceholder));
  assert.ok(html.includes('织羽 Zhiyu'));
  assert.ok(!html.includes(demo.chat.greeting));
});

test('apps section is a demo window under a centered section header', async () => {
  const content = await loadLandingContent('zh');
  const html = renderToStaticMarkup(
    createElement(AppsSection, { content: content.apps, demo: content.hero.demo }),
  );

  assert.ok(html.includes('id="apps"'));
  // The morph target wrapper the hero window zooms into.
  assert.ok(html.includes('data-apps-morph'));
  // Section header above the window, then the Suspense fallback's static frame.
  assert.ok(html.includes('data-apps-copy'));
  assert.ok(html.includes(content.apps.title));
  assert.ok(html.includes(content.apps.subtitle));
  assert.ok(html.includes(content.hero.demo.apps.title));
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

  const zhiyu = demo.appPreview.zhiyu;
  const zhiyuHtml = renderToStaticMarkup(createElement(DemoZhiyuPreview, { content: zhiyu }));
  // The preview is the Zhiyu shell composition: same regions, class names,
  // and data attributes as apps/zhiyu's agent-chat surface, on kit surfaces.
  assert.ok(zhiyuHtml.includes('data-demo-zhiyu-root="true"'));
  assert.ok(zhiyuHtml.includes('class="zhiyu-agent-chat"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-region="presence"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-region="conversation"'));
  assert.ok(zhiyuHtml.includes('data-canonical-transcript-root'));
  assert.ok(zhiyuHtml.includes('data-canonical-composer-root'));
  assert.ok(zhiyuHtml.includes(`placeholder="${zhiyu.copy.composerPlaceholder}"`));
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.sendLabel}"`));
  assert.ok(zhiyuHtml.includes(`title="${zhiyu.copy.attachLabel}"`));
  // Composer tools mirror the app: avatar, proactive mode, and the Agent
  // Center toggle that opens the kit panel.
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-tool="avatar"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-tool="proactive"'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-composer-agent-center-state="closed"'));
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.agentCenterLabel}"`));
  // The rail labels the current partner and the selectable ones the way the
  // app's presence rail does.
  const [first, ...rest] = zhiyu.partners;
  assert.ok(first);
  assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.currentPartnerAriaPrefix}${first.name}"`));
  for (const partner of rest) {
    assert.ok(zhiyuHtml.includes(`aria-label="${zhiyu.copy.selectPartnerAriaPrefix}${partner.name}"`));
  }
  // The first partner's transcript is seeded; the Agent Center stays closed
  // until the visitor opens it.
  assert.ok(zhiyuHtml.includes(first.messages[0]?.text ?? '__none__'));
  assert.ok(zhiyuHtml.includes('data-zhiyu-side-panel-state="closed"'));
  assert.ok(!zhiyuHtml.includes('data-zhiyu-region="agent-panel"'));
});
