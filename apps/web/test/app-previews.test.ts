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

test('ShiJing 命镜 is method-routed: the 八字子平法 route mounts hero, 排盘, 大运, 流年, events, and the AI reading', () => {
  const content = shijingPreviewContent;
  const m = content.mingjing;
  assert.deepEqual(content.methodProfiles.map((profile) => profile.id), ['bazi_ziping_v1', 'ziwei_sanhe_v1', 'qizheng_siyu_guolao_v1']);
  const html = renderToStaticMarkup(createElement(DemoShijingPreview, { content, initialTab: 'mingjing' }));
  assert.ok(html.includes('class="shijing-shell" data-active-tab="mingjing"'));
  assert.ok(html.includes('class="shijing-tab shijing-mingjing"'));
  assert.ok(html.includes('data-mingjing-route="bazi_ziping_v1"'));
  // 命局总览 hero: archetype title, day master, 用神 chips, current 大运.
  assert.ok(html.includes('class="shijing-mj-hero" data-strength="weak"'));
  assert.ok(html.includes(m.bazi.hero.title));
  assert.ok(html.includes(m.bazi.hero.dayMaster));
  assert.ok(html.includes(m.bazi.hero.persona));
  assert.ok(html.includes(m.bazi.hero.current?.pillar ?? '__none__'));
  // 八字排盘: four pillar cards with the day master badge, 五行分布 bars, collapsed expert table.
  assert.equal(html.match(/class="shijing-paipan__pillar-card"/g)?.length, 4);
  assert.ok(html.includes(m.bazi.paipan.dayBadge));
  assert.ok(html.includes(m.bazi.paipan.structureBadge));
  assert.equal(html.match(/class="shijing-mingjing-five__bar"/g)?.length, 5);
  assert.ok(html.includes(m.bazi.paipan.five.summary));
  assert.ok(!html.includes('class="shijing-paipan__table"'));
  // 大运: timeline segment per period, "你在这里" marker, current row expanded, 90+ periods folded away.
  assert.equal(html.match(/class="shijing-dayun__seg"/g)?.length, m.bazi.dayun.periods.length);
  assert.ok(html.includes(m.bazi.dayun.currentLabel));
  assert.ok(html.includes('class="shijing-dayun__row" data-nature="watch" data-favor="忌" data-current="" data-expanded=""'));
  assert.ok(html.includes(m.bazi.dayun.distantTitle));
  // 流年 windows, seeded events with resonance chips, AI reading output.
  assert.equal(html.match(/class="shijing-liunian__card"/g)?.length, m.bazi.liunian.windows.length);
  assert.ok(html.includes(m.bazi.liunian.windows[0]?.badge ?? '__none__'));
  for (const event of m.bazi.events.items) assert.ok(html.includes(event.body), event.body);
  assert.ok(html.includes(m.bazi.reading.output.summary));
  assert.ok(html.includes(m.bazi.rectifyEntry));
  // The other routes stay unmounted.
  assert.ok(!html.includes('data-mingjing-route="ziwei_sanhe_v1"'));
  assert.ok(!html.includes('data-mingjing-route="qizheng_siyu_guolao_v1"'));
});

test('ShiJing 命镜 switches to the 紫微 and 七政四余 routes with the method profile', () => {
  const content = shijingPreviewContent;
  const m = content.mingjing;

  const ziwei = renderToStaticMarkup(createElement(DemoShijingPreview, { content, initialTab: 'mingjing', initialMethodProfile: 'ziwei_sanhe_v1' }));
  assert.ok(ziwei.includes('data-mingjing-route="ziwei_sanhe_v1"'));
  assert.ok(ziwei.includes(`<option value="ziwei_sanhe_v1" selected="">`));
  assert.ok(!ziwei.includes('data-mingjing-route="bazi_ziping_v1"'));
  assert.equal(ziwei.match(/class="shijing-ziwei-palace"/g)?.length, 12);
  for (const branch of ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']) {
    assert.ok(ziwei.includes(`data-branch="${branch}"`), `palace ${branch}`);
  }
  // Soul palace is selected by default and the detail aside shows it; stars carry brightness + 四化.
  assert.ok(ziwei.includes('data-branch="子" data-selected="" data-soul=""'));
  assert.ok(ziwei.includes(m.ziwei.copy.palaceDetailEyebrow));
  assert.ok(ziwei.includes(m.ziwei.copy.soulRole));
  assert.ok(ziwei.includes('data-mutagen="禄"'));
  assert.ok(ziwei.includes(m.ziwei.basis.fiveElementsClass));
  assert.ok(ziwei.includes(m.ziwei.reading.summary));

  const qizheng = renderToStaticMarkup(createElement(DemoShijingPreview, { content, initialTab: 'mingjing', initialMethodProfile: 'qizheng_siyu_guolao_v1' }));
  assert.ok(qizheng.includes('data-mingjing-route="qizheng_siyu_guolao_v1"'));
  assert.ok(qizheng.includes(m.qizheng.hero.title));
  assert.ok(qizheng.includes(m.qizheng.hero.oneLiner));
  assert.ok(qizheng.includes('class="shijing-qz-wheel__svg"'));
  assert.equal(qizheng.match(/class="shijing-qz-star"/g)?.length, 11);
  assert.equal(qizheng.match(/class="shijing-qz-pattern"/g)?.length, m.qizheng.patterns.length);
  assert.ok(qizheng.includes(m.qizheng.copy.viewPlain));
  assert.ok(qizheng.includes(m.qizheng.reading.summary));
  // Data view stays unmounted until toggled.
  assert.ok(!qizheng.includes('class="shijing-qz-luogong"'));
});

test('ShiJing 问镜 mounts the app history rail, welcome hero, and the composer with the context focus bar', () => {
  const content = shijingPreviewContent;
  const a = content.ask;
  const html = renderToStaticMarkup(createElement(DemoShijingPreview, { content, initialTab: 'shijing' }));
  assert.ok(html.includes('class="shijing-tab shijing-shijing shijing-ask"'));
  assert.ok(html.includes('class="shijing-ask__layout"'));
  // Rail: new-question button (drafting), search + filter button, grouped sessions with time labels.
  assert.ok(html.includes('class="shijing-ask__new-question" aria-label="' + a.newQuestionAria + '" aria-current="true"'));
  assert.ok(html.includes('class="shijing-ask__search-row"'));
  assert.ok(html.includes('class="shijing-ask__filter-button"'));
  for (const label of Object.values(a.groups)) assert.ok(html.includes(`<p class="shijing-ask__session-group-label">${label}</p>`), label);
  for (const entry of a.history) {
    assert.ok(html.includes(`<span class="shijing-ask__session-q">${entry.question}</span>`), entry.question);
    assert.ok(html.includes(`<span class="shijing-ask__session-time">${entry.date}</span>`), entry.date);
  }
  // Welcome mode: hero with the mint dot, frosted composer card, context focus bar in the toolbar.
  assert.ok(html.includes('class="shijing-ask__main" data-chat-active="false"'));
  assert.ok(html.includes('class="shijing-ask__welcome"'));
  assert.ok(html.includes('class="shijing-ask__title-dot"'));
  assert.ok(html.includes('class="shijing-ask__composer" data-chat-composer="false"'));
  assert.ok(html.includes(a.composerTitle));
  assert.ok(html.includes('class="shijing-ctx"'));
  for (const concern of a.concerns) assert.ok(html.includes(`<li class="shijing-ctx__chip">#${concern}</li>`), concern);
  assert.ok(html.includes(a.contextManage));
  assert.ok(html.includes('class="shijing-generating-button shijing-ask__submit"'));
  assert.ok(html.includes(a.generate));
  // No thread until a session is opened.
  assert.ok(!html.includes('class="shijing-ask__thread"'));
  assert.ok(!html.includes(a.answer.title));
});

test('ShiJing 合镜 mounts the app first-run intake hero (no relationship person yet)', () => {
  const content = shijingPreviewContent;
  const h = content.hejing;
  const html = renderToStaticMarkup(createElement(DemoShijingPreview, { content, initialTab: 'hejing' }));
  assert.ok(html.includes('class="shijing-hejing" data-mirror-kind="hejing"'));
  assert.ok(html.includes('class="shijing-intake-hero" data-mirror-kind="hejing"'));
  assert.ok(html.includes(h.heroImage));
  assert.ok(html.includes(h.eyebrow));
  assert.ok(html.includes(`${h.titleLead}<br/>${h.titleEmphasis}`));
  assert.ok(html.includes(h.body));
  assert.ok(html.includes(h.primaryAction));
  assert.ok(html.includes(h.stepsHint));
  assert.ok(html.includes(h.footer));
  // The first-run hero replaces the mirror page header and any reading content.
  assert.ok(!html.includes('shijing-mirror-header'));
  assert.ok(!html.includes('sjd-glass'));
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
