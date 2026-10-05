import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { NimiMachineLoadout, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import { DownloadSetupModels } from '../src/shell/renderer/features/runtime-config/download-setup-models.js';
import type { RuntimeSetupTask } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';
import zh from '../src/shell/renderer/locales/zh/46-runtimeConfig.json' with { type: 'json' };

(globalThis as { React?: typeof React }).React = React;
const i18n = i18next.createInstance();
await i18n.init({ lng: 'zh', resources: { zh: { translation: { runtimeConfig: zh } } }, initImmediate: false });
const task: RuntimeSetupTask = {
  taskId: 'setup', capabilityContract: 'text.generate', source: { kind: 'runtime', accountId: 'account' },
  candidateLoadoutId: 'original', candidateRevisionBaseline: 'r1',
  status: 'done', nextAction: 'return-to-source',
  refs: { installPlanIds: [], transferIds: [], dependencyJobIds: [] },
  createdAt: '2026-09-28T07:40:33Z', updatedAt: '2026-09-28T07:40:45Z',
};
const loadout = {
  loadoutId: 'original', revision: 'r1',
  modelAxes: [{ slotId: 'main.gguf', modelAssetId: 'asset-gemma' }],
} as NimiMachineLoadout;
const asset = {
  modelAssetId: 'asset-gemma', contentId: 'content-gemma', displayName: 'gemma-4-e2b-it (Q8_0)', entry: 'gemma.gguf',
} as NimiRuntimeModelAssetRecord;
function render(overrides: Partial<React.ComponentProps<typeof DownloadSetupModels>> = {}) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}><DownloadSetupModels
    task={task} loadouts={[loadout]} assets={[asset]} catalog={[]} loading={false} unavailable={false} {...overrides}
  /></I18nextProvider>);
}

test('completed setup shows the original model without any download and distinguishes reuse', () => {
  const html = render({ loadouts: [{ ...loadout, loadoutId: 'current', modelAxes: [] }, loadout] });
  assert.match(html, /Gemma 4 2B · Q8/);
  assert.match(html, /使用已安装模型/);
});

test('downloaded and stopped setups do not claim that no download was needed', () => {
  assert.doesNotMatch(render({ task: { ...task, refs: { ...task.refs, installPlanIds: ['plan'] } } }), /使用已安装模型/);
  assert.doesNotMatch(render({ task: { ...task, status: 'stopped' } }), /使用已安装模型/);
});

test('missing or modified historical configurations never borrow today’s model', () => {
  for (const loadouts of [[], [{ ...loadout, revision: 'r2' }], [{ ...loadout, loadoutId: 'current' }]]) {
    const html = render({ loadouts });
    assert.match(html, /无法确认这次配置的模型/);
    assert.doesNotMatch(html, /Gemma|使用已安装模型/);
  }
});

test('loading and read failures explain missing model information without claiming reuse', () => {
  assert.match(render({ loading: true }), /正在读取配置模型/);
  assert.doesNotMatch(render({ loading: true }), /使用已安装模型/);
  const html = render({ unavailable: true });
  assert.match(html, /暂时无法读取配置模型/);
  assert.doesNotMatch(html, /使用已安装模型/);
});

test('cloud setup shows its target without requiring local inventory', () => {
  const html = render({ task: { ...task, draft: { route: 'cloud', cloudTargetLabel: 'Chosen cloud model' } }, unavailable: true });
  assert.match(html, /Chosen cloud model/);
  assert.match(html, /无需下载本机模型/);
  assert.doesNotMatch(html, /Gemma|使用已安装模型/);
});

test('multi-model configuration preserves companion models', () => {
  const html = render({
    loadouts: [{ ...loadout, modelAxes: [...loadout.modelAxes, { ...loadout.modelAxes[0]!, slotId: 'companion.vae', modelAssetId: 'vae' }] }],
    assets: [asset, { ...asset, modelAssetId: 'vae', contentId: 'vae-content', displayName: 'Image VAE', entry: 'vae.safetensors' }],
  });
  assert.match(html, /Gemma 4 2B · Q8/);
  assert.match(html, /Image VAE/);
});

test('group members identify the capability and its own status beside their models', () => {
  for (const [capabilityContract, label] of [
    ['text.generate', zh.capabilityLabels.textGenerate],
    ['image.generate', zh.capabilityLabels.imageGenerate],
  ]) {
    for (const status of ['preparing', 'done'] as const) {
      const html = render({ showCapability: true, task: { ...task, capabilityContract: capabilityContract!, status } });
      assert.ok(html.includes(`${label} · ${zh.setupTask.status[status]}`));
      assert.match(html, /Gemma 4 2B · Q8/);
    }
  }
});
