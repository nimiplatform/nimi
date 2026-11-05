import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoAppsSurface } from '../src/landing/components/demo-apps.js';
import { reduceContentCheckDemo, type ContentCheckDemo } from '../src/landing/content/content-check-demo.js';
import { demoChapters } from '../src/landing/content/demo-tour.js';
import { initialDemoSection, reduceDemoNavigation } from '../src/landing/content/demo-navigation.js';
import { loadLandingContent } from '../src/landing/content/landing-content.js';

test('the security entry displays declared access instead of model configuration or permission switches', async () => {
  const { hero: { demo } } = await loadLandingContent('zh');
  const html = renderToStaticMarkup(createElement(DemoAppsSurface, {
    apps: demo.apps, preview: demo.appPreview, initialAppId: 'nimi.parentos', initialAccess: true, onLaunch() {},
  }));
  assert.ok(html.includes('AI 能力调用'));
  assert.ok(html.includes('应用活动'));
  assert.ok(html.includes('已声明'));
  assert.ok(!html.includes('已配置'));
  assert.ok(!html.includes('role="switch"'));
});

test('a refusal preserves the draft until the visitor explicitly edits and resubmits', async () => {
  for (const locale of ['zh', 'en'] as const) {
    const { riskControl: copy } = await loadLandingContent(locale);
    const original = `${copy.draft}\n${copy.marker}`;
    let state: ContentCheckDemo = { draft: original, phase: 'draft' };
    state = reduceContentCheckDemo(state, { type: 'submit', marker: copy.marker });
    assert.deepEqual(state, { draft: original, phase: 'blocked' });
    assert.equal(reduceContentCheckDemo(state, { type: 'submit', marker: copy.marker }), state);
    assert.equal(reduceContentCheckDemo(state, { type: 'remove-example', marker: copy.marker }), state);
    state = reduceContentCheckDemo(state, { type: 'edit' });
    assert.equal(state.draft, original, 'Edit must not silently sanitize the draft');
    state = reduceContentCheckDemo(state, { type: 'submit', marker: copy.marker });
    assert.equal(state.phase, 'blocked', 'Unchanged draft is still refused');
    state = reduceContentCheckDemo(state, { type: 'edit' });
    state = reduceContentCheckDemo(state, { type: 'remove-example', marker: copy.marker });
    assert.deepEqual(state, { draft: copy.draft, phase: 'editing' }, 'Removal is not a send action');
    state = reduceContentCheckDemo(state, { type: 'submit', marker: copy.marker });
    assert.deepEqual(state, { draft: '', phase: 'submitted' });
  }
});

test('visitors can manually edit the illustrative draft without a real credential detector', () => {
  const state = reduceContentCheckDemo({ draft: 'example', phase: 'editing' }, { type: 'change', text: 'An ordinary revised draft' });
  assert.equal(state.draft, 'An ordinary revised draft');
  assert.equal(reduceContentCheckDemo(state, { type: 'submit', marker: '[masked example]' }).phase, 'submitted');
  const empty: ContentCheckDemo = { draft: '  ', phase: 'editing' };
  assert.equal(reduceContentCheckDemo(empty, { type: 'submit', marker: '[masked example]' }), empty);
});

test('removing the disclosed example preserves the visitor’s other whitespace and does not send', () => {
  const state: ContentCheckDemo = { draft: '  A deliberately indented draft.\n\n[masked example]\n  ', phase: 'editing' };
  assert.deepEqual(reduceContentCheckDemo(state, { type: 'remove-example', marker: '[masked example]' }), {
    draft: '  A deliberately indented draft.\n\n  ', phase: 'editing',
  });
});

test('security deep links and topic selection use access, custody and a manual draft', async () => {
  const index = initialDemoSection('#risk-control');
  const chapter = demoChapters[index - 2]!;
  assert.equal(chapter.manual, true);
  let nav = reduceDemoNavigation({ entries: [{ surface: 'home' }], position: 0 }, { type: 'enter-section', index });
  assert.deepEqual(nav.entries[nav.position], { surface: 'apps', target: 'nimi.parentos', view: 'access' });
  nav = reduceDemoNavigation(nav, { type: 'guide', step: 1 });
  assert.deepEqual(nav.entries[nav.position], { surface: 'cloud', target: 'credentials' });
  nav = reduceDemoNavigation(nav, { type: 'guide', step: 2 });
  assert.equal(nav.entries[nav.position]?.view, 'draft');
  nav = reduceDemoNavigation(nav, { type: 'explore' });
  assert.equal(nav.guide?.step, 2);
  assert.equal(nav.guide?.exploring, true);
  for (const locale of ['zh', 'en'] as const) {
    const copy = await loadLandingContent(locale);
    assert.equal(copy.riskControl.topics.length, chapter.stops.length);
    assert.equal(copy.riskControl.stops.length, chapter.stops.length);
    assert.ok(copy.riskControl.limit.includes('GitHub classic PAT'));
    assert.ok(copy.riskControl.sampleNote);
    assert.equal(copy.nav.create, locale === 'zh' ? '生态应用' : 'Ecosystem apps');
  }
});
