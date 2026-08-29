import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ZhiyuResourcePackStatusNotice } from '../src/resource-pack/ZhiyuResourcePackStatusNotice.tsx';

test('D-098 pending notices distinguish precommit from committed render pending', () => {
  const precommit = render('apply-in-flight', 'selection-unchanged-candidate-not-applied');
  assert.match(precommit, /正在应用 · 尚未生效/u);
  assert.match(precommit, /尚未写入/u);
  assert.doesNotMatch(precommit, /已保存/u);

  const postcommit = render('render-pending', 'selection-saved-not-effective');
  assert.match(postcommit, /已保存 · 正在载入体验/u);
  assert.match(postcommit, /尚未渲染/u);
  assert.doesNotMatch(postcommit, /尚未写入/u);
});

test('Preview and selected fallback remain explicitly non-active', () => {
  assert.match(render('preview', null), /正在预览 · 尚未应用/u);
  const fallback = render('fallback', null);
  assert.match(fallback, /无法显示/u);
  assert.match(fallback, /默认体验/u);
});

test('ambiguous mutation outcome never claims that canonical selection is unchanged', () => {
  const apply = render('apply-in-flight', 'apply-outcome-unknown');
  assert.match(apply, /应用结果待确认/u);
  assert.match(apply, /无法确认/u);
  assert.doesNotMatch(apply, /尚未写入/u);
  assert.doesNotMatch(apply, /已保存/u);

  const clear = render('selected', 'clear-outcome-unknown');
  assert.match(clear, /清除结果待确认/u);
  assert.match(clear, /是否已经清除/u);
  assert.doesNotMatch(clear, /应用结果/u);
});

function render(phase, pendingTruth) {
  return renderToStaticMarkup(React.createElement(ZhiyuResourcePackStatusNotice, {
    state: {
      generation: 1,
      phase,
      agentHandle: null,
      selectionRevision: null,
      selectedResourceRef: phase === 'render-pending' || phase === 'fallback' ? 'pack:B' : null,
      effectiveResourceRef: phase === 'apply-in-flight' || phase === 'render-pending' ? 'pack:A' : null,
      effectiveSource: phase === 'preview' ? 'preview' : phase === 'fallback' ? 'default' : 'last-safe',
      scopedCssText: null,
      reviewFileName: phase === 'preview' ? 'B.nimipack' : null,
      pendingTruth,
      mismatchReason: phase === 'fallback' ? 'render failed' : null,
      error: null,
    },
  }));
}
