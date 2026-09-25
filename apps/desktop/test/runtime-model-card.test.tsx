import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ModelCardMarkdown, modelCardBody, modelCardUrl } from '../src/shell/renderer/features/runtime-config/runtime-config-model-card';
import { InstallPlanPanel, ModelInstallAction } from '../src/shell/renderer/features/runtime-config/runtime-config-page-recommend';
import type { NimiRuntimeLocalInstallPlanDescriptor } from '@nimiplatform/sdk/runtime';

(globalThis as { React?: typeof React }).React = React;
const baseUrl = 'https://huggingface.co/org/model/resolve/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';

test('the header owns the install action while the panel keeps plan details and re-review after a failed attempt', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {} });
  const plan = {
    planId: 'previously-reviewed', modelId: 'org/model', repo: 'org/model', revision: 'revision',
    entry: 'model.gguf', files: ['model.gguf'], warnings: [], installAvailable: true,
  } as unknown as NimiRuntimeLocalInstallPlanDescriptor;
  const buttonsOf = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .map((match) => ({ attributes: match[1]!, label: match[2]!.replace(/<[^>]*>/g, '') }));

  const headerHtml = renderToStaticMarkup(<I18nextProvider i18n={i18n}><ModelInstallAction
    installed={false} installable plan={plan} busy={false} runtimeWritesDisabled={false}
    onReview={() => {}} onInstall={() => {}} onOpenLocalAssets={() => {}}
  /></I18nextProvider>);
  assert.ok(buttonsOf(headerHtml).some((button) => button.label === 'Download and install' && !button.attributes.includes('disabled=""')));

  const panelHtml = renderToStaticMarkup(<I18nextProvider i18n={i18n}><InstallPlanPanel
    installed={false} installable plan={plan} error="Install plan expired" busy={false} onReview={() => {}}
  /></I18nextProvider>);
  assert.ok(buttonsOf(panelHtml).some((button) => button.label === 'Review install' && !button.attributes.includes('disabled=""')));
  assert.match(panelHtml, /Install plan expired/);
});

test('the header install entry stays visible before review and the panel stays hidden until there is detail', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {} });
  const headerHtml = renderToStaticMarkup(<I18nextProvider i18n={i18n}><ModelInstallAction
    installed={false} installable plan={null} busy={false} runtimeWritesDisabled={false}
    onReview={() => {}} onInstall={() => {}} onOpenLocalAssets={() => {}}
  /></I18nextProvider>);
  assert.match(headerHtml, /Review install/);
  const panelHtml = renderToStaticMarkup(<I18nextProvider i18n={i18n}><InstallPlanPanel
    installed={false} installable plan={null} error="" busy={false} onReview={() => {}}
  /></I18nextProvider>);
  assert.equal(panelHtml, '');
});

test('an installed model offers the downloaded inventory from the header instead of the panel', async () => {
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {} });
  const headerHtml = renderToStaticMarkup(<I18nextProvider i18n={i18n}><ModelInstallAction
    installed installable plan={null} busy={false} runtimeWritesDisabled={false}
    onReview={() => {}} onInstall={() => {}} onOpenLocalAssets={() => {}}
  /></I18nextProvider>);
  assert.match(headerHtml, /Open Downloaded/);
  const panelHtml = renderToStaticMarkup(<I18nextProvider i18n={i18n}><InstallPlanPanel
    installed installable plan={null} error="" busy={false} onReview={() => {}}
  /></I18nextProvider>);
  assert.equal(panelHtml, '');
});

test('model card preserves document content while hiding metadata and resolving repository assets', () => {
  const markdown = '---\nlicense: apache-2.0\n---\n# Model\n\n![Diagram](./assets/model.png)\n\n[Instructions](docs/usage.md)\n\n| Model | Score |\n| --- | --- |\n| A | 42 |\n\n<details><summary>Example</summary><p>Content</p><img src="./chart.png" /></details>\n\n```python\nprint("hello")\n```';
  const html = renderToStaticMarkup(<ModelCardMarkdown markdown={markdown} baseUrl={baseUrl} />);
  assert.ok(!html.includes('license: apache'));
  assert.ok(html.includes('<h1 id="user-content-model">Model</h1>'));
  assert.ok(html.includes(baseUrl + 'assets/model.png'));
  assert.ok(html.includes(baseUrl + 'chart.png'));
  assert.ok(html.includes('/blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/docs/usage.md'));
  assert.ok(html.includes('<table'));
  assert.ok(html.includes('<details>'));
  assert.ok(html.includes('<summary>Example</summary>'));
  assert.ok(html.includes('language-python'));
  assert.equal(modelCardBody('---\r\nlicense: mit\r\n---\r\nIntro'), 'Intro');
});

test('model card sanitizes executable repository HTML and resolves anchors', () => {
  const html = renderToStaticMarkup(<ModelCardMarkdown markdown={'<script>alert(1)</script>\n\n<img src="./chart.png" onerror="alert(1)" />\n\n[Unsafe](javascript:alert%281%29)'} baseUrl={baseUrl} />);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('onerror'));
  assert.ok(!html.includes('javascript:'));
  assert.equal(modelCardUrl('#model', baseUrl, false), '#user-content-model');
  assert.equal(modelCardUrl('https://huggingface.co/org/model/blob/main/chart.png', baseUrl, true), 'https://huggingface.co/org/model/resolve/main/chart.png');
});


test('HF tables immediately after a list render as tables without changing code examples', () => {
  const table = '| Model | Score |\n| --- | --- |\n| A | 42 |';
  const markdown = '- View the notebooks.\n' + table;
  const html = renderToStaticMarkup(<ModelCardMarkdown markdown={markdown} baseUrl={baseUrl} />);
  assert.ok(html.includes('<table'));
  assert.ok(html.includes('</ul>'));
  const fenced = '```markdown\n' + markdown + '\n```';
  assert.equal(modelCardBody(fenced), fenced);
});

test('market filters and user ordering preserve exact candidates and source order', async () => {
  const { filterModelMarketRows } = await import('../src/shell/renderer/features/runtime-config/runtime-config-page-recommend');
  const rows = [
    { offerRef: 'offer-z', title: 'Zulu', author: 'One', license: 'MIT', downloads: 50, totalSizeBytes: 300 },
    { offerRef: 'offer-a', title: 'Alpha', author: 'Two', license: 'MIT', downloads: 100, totalSizeBytes: 200 },
    { offerRef: 'offer-b', title: 'Beta', author: 'One', license: 'Apache-2.0', downloads: 10 },
  ];
  assert.deepEqual(filterModelMarketRows(rows, 'author:One', 'license:MIT', 'default'), [rows[0]]);
  assert.deepEqual(filterModelMarketRows(rows, 'all', 'all', 'downloads').map((row) => row.offerRef), ['offer-a', 'offer-z', 'offer-b']);
  assert.deepEqual(filterModelMarketRows(rows, 'all', 'all', 'size').map((row) => row.offerRef), ['offer-a', 'offer-z', 'offer-b']);
  assert.deepEqual(rows.map((row) => row.offerRef), ['offer-z', 'offer-a', 'offer-b']);
});

test('market logos credit a quantization to its base model maker and keep a monogram for unknown makers', async () => {
  const { ModelMakerLogo, modelMakerOrg } = await import('../src/shell/renderer/features/runtime-config/runtime-config-model-market-detail');
  const quantizedTags = ['gguf', 'base_model:Qwen/Qwen3-Coder-30B-A3B-Instruct', 'base_model:quantized:Qwen/Qwen3-Coder-30B-A3B-Instruct'];
  assert.equal(modelMakerOrg('unsloth', quantizedTags), 'Qwen');
  assert.equal(modelMakerOrg('RunDiffusion', ['base_model:finetune:stabilityai/stable-diffusion-xl-base-1.0']), 'RunDiffusion');
  assert.equal(modelMakerOrg(' ornith-ai ', []), 'ornith-ai');
  assert.equal(modelMakerOrg(undefined), '');

  const logo = renderToStaticMarkup(<ModelMakerLogo author="unsloth" tags={quantizedTags} />);
  assert.match(logo, /title="Qwen"/);
  assert.match(logo, /data-model-maker-logo="qwen-color"/);
  assert.match(logo, /<svg /);
  const monogram = renderToStaticMarkup(<ModelMakerLogo author="ornith-ai" tags={[]} />);
  assert.doesNotMatch(monogram, /data-model-maker-logo|<svg/);
  assert.match(monogram, />OA<\/span>/);
  assert.equal(renderToStaticMarkup(<ModelMakerLogo />), '');
});
