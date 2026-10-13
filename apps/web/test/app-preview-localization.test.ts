import {
  createPreviewTranslate,
  type PreviewMessageKey,
} from '../src/landing/i18n/preview-messages.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadLandingContent } from '../src/landing/content/landing-content.js';
import { AppPreviewLocaleProvider } from '../src/landing/i18n/app-preview-locale.js';
import { appPreviewMessagesEn } from '../src/landing/content/app-preview-messages.en.js';
import { appPreviewMessagesZh } from '../src/landing/content/app-preview-messages.zh.js';

const previews = [
  ['zhiyu', 'DemoZhiyuPreview', 'zhiyu'],
  ['shijing', 'DemoShijingPreview', 'shijing'],
  ['parentos', 'DemoParentosPreview', 'parentos'],
  ['storybook', 'DemoStorybookPreview', 'storybook'],
  ['odd-bureau', 'DemoOddBureauPreview', 'oddBureau'],
  ['jev-search', 'DemoJevSearchPreview', 'jevSearch'],
  ['jev-ultrafast', 'DemoJevUltrafastPreview', 'jevUltrafast'],
  ['moneyprinter', 'DemoMoneyPrinterPreview', 'moneyPrinter'],
  ['openwhispr', 'DemoOpenwhisprPreview', 'openwhispr'],
  ['videolingo', 'DemoVideoLingoPreview', 'videoLingo'],
  ['voicestudio', 'DemoVoiceStudioPreview', 'voiceStudio'],
  ['inscape', 'DemoInscapePreview', 'remainingApps.inscape'],
  ['overtone', 'DemoOvertonePreview', 'remainingApps.overtone'],
  ['polyagent', 'DemoPolyagentPreview', 'remainingApps.polyagent'],
  ['realm-persona', 'DemoRealmPersonaPreview', 'remainingApps.persona'],
  ['realm-world', 'DemoRealmWorldPreview', 'remainingApps.world'],
  ['deeptutor', 'DemoDeepTutorPreview', 'remainingApps.deeptutor'],
  ['openmontage', 'DemoOpenMontagePreview', 'remainingApps.openmontage'],
  ['sillytavern', 'DemoSillyTavernPreview', 'remainingApps.sillytavern'],
  ['vane', 'DemoVanePreview', 'remainingApps.vane'],
  ['drawio', 'DemoDrawioPreview', 'remainingApps.drawio'],
  ['open-notebook', 'DemoOpenNotebookPreview', 'remainingApps.notebook'],
  ['presenton', 'DemoPresentonPreview', 'remainingApps.presenton'],
] as const;

test('all 23 previews render English UI and authored examples when the outer locale is English', async () => {
  const content = (await loadLandingContent('en')).hero.demo.appPreview;
  for (const [file, name, key] of previews) {
    const module = (await import(`../src/landing/components/demo-${file}-preview.js`)) as Record<
      string,
      ComponentType<{ content: unknown }>
    >;
    const data = key
      .split('.')
      .reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], content);
    const html = renderToStaticMarkup(
      createElement(AppPreviewLocaleProvider, {
        locale: 'en',
        messages: content.messages,
        children: createElement(module[name]!, { content: data }),
      }),
    );
    let text = html.replace(/<[^>]*>/gu, '');
    // A bilingual media task keeps its sample target language even in English UI.
    if (file === 'videolingo') {
      for (const cue of content.videoLingo.subtitles) text = text.replaceAll(cue.target, '');
    }
    assert.equal(
      /[\u3400-\u9fff]/u.test(text),
      false,
      `${file}: ${text.match(/.{0,35}[\u3400-\u9fff].{0,60}/u)?.[0]}`,
    );
  }
});

test('both locales have the same stable semantic keys and interpolation parameters', () => {
  const enKeys = Object.keys(appPreviewMessagesEn).sort();
  assert.deepEqual(enKeys, Object.keys(appPreviewMessagesZh).sort());
  const parameters = (text: string) =>
    [...new Set([...text.matchAll(/\{([a-zA-Z]\w*)\}/gu)].map((match) => match[1]))].sort();
  for (const key of enKeys as PreviewMessageKey[]) {
    assert.match(key, /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+$/u);
    assert.deepEqual(
      parameters(appPreviewMessagesEn[key]),
      parameters(appPreviewMessagesZh[key]),
      key,
    );
  }
});

test('message lookup fails on unknown keys and keeps visitor-supplied values verbatim', () => {
  const t = createPreviewTranslate(appPreviewMessagesZh);
  assert.throws(() => t('没有这个 key' as PreviewMessageKey), /Missing App preview message/);
  assert.throws(() => t('toString' as PreviewMessageKey), /Missing App preview message/);
  assert.equal(t('parentos.nav.timeline'), '首页');
  const changed = createPreviewTranslate({
    ...appPreviewMessagesZh,
    'parentos.nav.timeline': '新的首页文案',
  });
  assert.equal(changed('parentos.nav.timeline'), '新的首页文案');
  assert.equal(createPreviewTranslate(appPreviewMessagesEn)('parentos.nav.timeline'), 'Home');
  assert.equal(
    t('presenton.slides.slide', { number: 2, title: 'Paper 工作台 {number}' }),
    '幻灯片 2：Paper 工作台 {number}',
  );
  assert.throws(() => t('presenton.slides.slide', { number: 2 }), /Missing App preview parameter/);
  assert.equal(
    createPreviewTranslate(appPreviewMessagesEn)('oddBureau.strikeGame.askTo', {
      name: 'Book',
      task: 'write the story',
    }),
    'Ask Book to write the story',
  );
});

test('English-first product examples have Chinese copy under the outer Chinese locale', async () => {
  const content = (await loadLandingContent('zh')).hero.demo.appPreview;
  assert.equal(content.jevSearch.tagline, '选择搜索来源，整理相关结果。');
  assert.match(content.remainingApps.deeptutor.notice, /静态产品预览/u);
  assert.match(content.remainingApps.presenton.notice, /幻灯片/u);
});

test('VideoLingo keeps English source and Chinese translation cues in both interface languages', async () => {
  for (const locale of ['en', 'zh'] as const) {
    const { subtitles } = (await loadLandingContent(locale)).hero.demo.appPreview.videoLingo;
    assert.equal(subtitles[0].source, 'Leave a little room in your weekend.');
    assert.equal(subtitles[0].target, '给你的周末留一点空白。');
  }
});

test('ShiJing preserves palace joins and semantic chart grades across interface locales', async () => {
  const zh = (await loadLandingContent('zh')).hero.demo.appPreview.shijing.mingjing.ziwei;
  const en = (await loadLandingContent('en')).hero.demo.appPreview.shijing.mingjing.ziwei;
  assert.deepEqual(
    en.palaces.map((palace) => palace.name),
    zh.palaces.map((palace) => palace.name),
  );
  assert.ok(en.palaces.every((palace) => en.palaceDomains[palace.name]));
  assert.deepEqual(
    en.palaces.flatMap((palace) => palace.major.map((star) => star.mutagen)),
    zh.palaces.flatMap((palace) => palace.major.map((star) => star.mutagen)),
  );
});
