import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoShijingPreview } from '../src/landing/components/demo-shijing-preview.js';
import { DemoParentosPreview } from '../src/landing/components/demo-parentos-preview.js';
import { DemoStorybookPreview } from '../src/landing/components/demo-storybook-preview.js';
import { DEMO_PREVIEW_APP_IDS } from '../src/landing/components/demo-app-preview.js';
import { shijingPreviewContent } from '../src/landing/content/landing-content.shijing.js';
import { parentosPreviewContent } from '../src/landing/content/landing-content.parentos.js';
import { storybookPreviewContent } from '../src/landing/content/landing-content.storybook.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('both locales share the zh ShiJing, ParentOS, and Storybook preview content and list them as previewable apps', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const content = await loadLandingContent(locale);
    assert.equal(content.hero.demo.appPreview.shijing, shijingPreviewContent);
    assert.equal(content.hero.demo.appPreview.parentos, parentosPreviewContent);
    assert.equal(content.hero.demo.appPreview.storybook, storybookPreviewContent);
    for (const appId of DEMO_PREVIEW_APP_IDS) {
      assert.ok(content.hero.demo.apps.items.some((item) => item.id === appId), `${locale} lists ${appId}`);
    }
  }
});

test('ShiJing preview mounts the six-mirror shell on the app class names with 日镜 active', () => {
  const html = renderToStaticMarkup(createElement(DemoShijingPreview, { content: shijingPreviewContent }));
  assert.ok(html.includes('data-demo-shijing-root="true"'));
  assert.ok(html.includes('class="shijing-shell" data-active-tab="rijing"'));
  assert.ok(html.includes('class="shijing-topbar"'));
  assert.ok(html.includes(shijingPreviewContent.brandName));
  assert.ok(html.includes(shijingPreviewContent.brandTagline));
  // The contract-locked primary tab bar carries all six mirrors.
  for (const tab of shijingPreviewContent.tabs) {
    assert.ok(html.includes(`data-mirror-kind="${tab.id}"`));
    assert.ok(html.includes(tab.label));
  }
  assert.ok(html.includes('aria-current="page"'));
  // 日镜 modules: hero, projections, event input, actions, evidence.
  assert.ok(html.includes('shijing-rijing__hero'));
  assert.ok(html.includes(shijingPreviewContent.rijing.hero.headline));
  assert.ok(html.includes(shijingPreviewContent.rijing.projections.title));
  assert.ok(html.includes(shijingPreviewContent.rijing.eventInput.title));
  assert.ok(html.includes(shijingPreviewContent.rijing.actions.title));
  assert.ok(html.includes(shijingPreviewContent.rijing.refreshLabel));
  // Other mirrors stay unmounted until their tab is selected.
  assert.ok(!html.includes(shijingPreviewContent.yuejing.monthPanel.title));
  assert.ok(!html.includes(shijingPreviewContent.ask.composerTitle));
  assert.ok(html.includes(`value="${shijingPreviewContent.methodProfiles[0]?.id ?? ''}"`));
});

test('ShiJing 月镜 mounts the app hero, filter row, and weekday-aligned 30-day calendar', () => {
  const content = shijingPreviewContent;
  const html = renderToStaticMarkup(createElement(DemoShijingPreview, { content, initialTab: 'yuejing' }));
  assert.ok(html.includes('class="shijing-shell" data-active-tab="yuejing"'));
  assert.ok(html.includes('class="shijing-tab shijing-yuejing"'));
  // Header strip: title, freshness meta, and the two header actions.
  assert.ok(html.includes(content.yuejing.generatedAgo));
  assert.ok(html.includes(content.yuejing.importLabel));
  assert.ok(html.includes(content.yuejing.generateLabel));
  // Today hero: dominant tendency by severity (关系 观察 outranks 事业 助力), per-concern chips, detail button.
  assert.ok(html.includes('class="shijing-yuejing__hero" data-tendency="watch"'));
  assert.ok(html.includes(content.yuejing.todayBodyByTone.watch));
  for (const concern of content.yuejing.concerns) {
    assert.ok(html.includes(`<span class="shijing-yuejing__hero-row-label">${concern.name}</span>`), `hero row ${concern.name}`);
  }
  assert.ok(html.includes(content.yuejing.hero.detailButton));
  // Filter row + legend.
  assert.ok(html.includes('class="shijing-yuejing__filter-row"'));
  assert.ok(html.includes(content.yuejing.filter.manage));
  for (const label of Object.values(content.yuejing.tendencyLabels)) {
    assert.ok(html.includes(label), `legend ${label}`);
  }
  // Calendar: 30 day cells, today badge, seeded record mark, lunisolar markers.
  assert.equal(html.match(/class="shijing-yuejing__day" role="gridcell"/g)?.length, 30);
  assert.ok(html.includes('data-day-kind="today"'));
  assert.ok(html.includes(content.yuejing.calendar.todayBadge));
  assert.ok(html.includes('class="shijing-yuejing__day-edit-mark"'));
  assert.ok(html.includes('data-marker-kind="solar_term">秋分'));
  assert.ok(html.includes('data-marker-kind="festival">中秋节'));
  // 2026-09-20 is a Sunday and 2026-10-19 a Monday: six leading + six trailing blanks keep the grid weekday-aligned.
  assert.equal(html.match(/class="shijing-yuejing__blank"/g)?.length, 6 + 6);
  // Panels stay closed until opened (the details summary still names the guide).
  assert.ok(!html.includes('shijing-yuejing__month-panel'));
  assert.ok(!html.includes('class="shijing-yuejing__panel-backdrop"'));
});

test('ParentOS preview mounts the sidebar shell on the 首页 dashboard with the reminder rail', () => {
  const html = renderToStaticMarkup(createElement(DemoParentosPreview, { content: parentosPreviewContent }));
  assert.ok(html.includes('data-demo-parentos-root="true"'));
  assert.ok(html.includes('data-parentos-route="timeline"'));
  for (const label of Object.values(parentosPreviewContent.nav)) {
    assert.ok(html.includes(`aria-label="${label}"`), `nav ${label}`);
  }
  assert.ok(html.includes('/demo/parentos-icon.png'));
  assert.ok(html.includes(parentosPreviewContent.child.avatarSrc));
  assert.ok(html.includes(parentosPreviewContent.child.name));
  assert.ok(html.includes(parentosPreviewContent.child.nurtureMode));
  // Dashboard cards and the right rail.
  assert.ok(html.includes(parentosPreviewContent.home.quickLinksTitle));
  assert.ok(html.includes(parentosPreviewContent.home.growthSnapshotTitle));
  assert.ok(html.includes(parentosPreviewContent.home.sleepTitle));
  assert.ok(html.includes(parentosPreviewContent.home.monthlyReportTitle));
  assert.ok(html.includes(parentosPreviewContent.panel.title));
  assert.ok(html.includes(parentosPreviewContent.panel.reminders[0]?.title ?? '__none__'));
  assert.ok(html.includes(parentosPreviewContent.panel.overdueSummary));
  // Other routes stay unmounted.
  assert.ok(!html.includes(parentosPreviewContent.advisor.placeholder));
  assert.ok(!html.includes(parentosPreviewContent.journal.placeholder));
});

test('Storybook preview mounts the sidebar shell on the 发现故事 library with the authored bookshelf', () => {
  const content = storybookPreviewContent;
  const html = renderToStaticMarkup(createElement(DemoStorybookPreview, { content }));
  assert.ok(html.includes('data-demo-storybook-root="true"'));
  assert.ok(html.includes('data-storybook-screen="library"'));
  assert.ok(html.includes('class="sb-app"'));
  // Sidebar: brand, the two Play entries, Studio, settings link, connection.
  assert.ok(html.includes('aria-label="Storybook 书架"'));
  assert.ok(html.includes('class="is-active" data-testid="surface-play"'));
  assert.ok(html.includes('我的足迹'));
  assert.ok(html.includes('data-testid="surface-studio"'));
  assert.ok(html.includes('设置与 AI'));
  assert.ok(html.includes(content.settings.accountName));
  // Library page: eyebrow, heading, count, featured hero, book grid.
  assert.ok(html.includes('A LITTLE ESCAPE, A DIFFERENT YOU'));
  assert.ok(html.includes('下一页，由你决定。'));
  assert.ok(html.includes(`${content.stories.length.toString().padStart(2, '0')} <span>个等待发生的世界</span>`));
  const featured = content.stories[0];
  assert.ok(featured);
  assert.ok(html.includes(`background-image:url(${featured.cover})`));
  assert.ok(html.includes('从这里开始 · STORY NO. 01'));
  assert.ok(html.includes(`${featured.nodes.length} 个场景`));
  assert.ok(html.includes(`${featured.endings.length} 种结局`));
  for (const story of content.stories) {
    assert.ok(html.includes(`<h3>${story.title}</h3>`), story.title);
    assert.ok(html.includes(story.role));
  }
  assert.ok(html.includes('STORYBOOK ORIGINAL'));
  // Seeded runs surface as footprints on the library.
  assert.ok(html.includes('故事还在等你'));
  assert.ok(html.includes('继续故事'));
  // The reader, Studio, and settings stay unmounted.
  assert.ok(!html.includes('sb-reader-bar'));
  assert.ok(!html.includes('THE AUTHOR IN YOU'));
  assert.ok(!html.includes('MAKE ROOM FOR IMAGINATION'));
});

test('Storybook stories keep the app graph shape: every choice targets a node and every ending is reachable', () => {
  for (const story of storybookPreviewContent.stories) {
    const ids = new Set(story.nodes.map((node) => node.id));
    assert.equal(story.nodes[0]?.id, 'n1');
    for (const node of story.nodes) {
      assert.equal(node.choices.length === 0, Boolean(node.ending), `${story.id}/${node.id}`);
      for (const choice of node.choices) assert.ok(ids.has(choice.targetNodeId), `${story.id}/${node.id}/${choice.id}`);
    }
    const endingIds = story.nodes.filter((node) => node.ending).map((node) => node.id);
    assert.deepEqual(endingIds.sort(), story.endings.map((ending) => ending.id).sort());
    for (const seeded of storybookPreviewContent.runs.filter((run) => run.storyId === story.id)) {
      let nodeId = 'n1';
      for (const choiceId of seeded.path) {
        const choice = story.nodes.find((node) => node.id === nodeId)?.choices.find((candidate) => candidate.id === choiceId);
        assert.ok(choice, `${seeded.id} path ${choiceId}`);
        nodeId = choice.targetNodeId;
      }
    }
  }
});
