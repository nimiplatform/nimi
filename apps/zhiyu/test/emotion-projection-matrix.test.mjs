import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
let conversationBuildDir = null;
let viewBuildDir = null;

const EMOTION_LABELS = {
  happy: '开心',
  sad: '低落',
  shy: '害羞',
  angry: '生气',
  surprised: '惊讶',
  confused: '困惑',
  excited: '兴奋',
  worried: '担心',
  embarrassed: '窘迫',
  neutral: '平静',
  'ext:apologetic': '歉意',
  'ext:proud': '自豪',
  'ext:lonely': '孤单',
  'ext:grateful': '感激',
};
const EMOTION_CASES = Object.keys(EMOTION_LABELS);
const NON_NEUTRAL_EMOTIONS = EMOTION_CASES.filter((emotionId) => emotionId !== 'neutral');
const INTENSITY_LABELS = {
  weak: '轻微',
  moderate: '明显',
  strong: '强烈',
};

test.after(async () => {
  await Promise.all([
    conversationBuildDir ? rm(conversationBuildDir, { recursive: true, force: true }) : Promise.resolve(),
    viewBuildDir ? rm(viewBuildDir, { recursive: true, force: true }) : Promise.resolve(),
  ]);
});

test('D-02/D-L1 renders weak/moderate/strong intensity through the props-only CompanionEmotionStatus view', async () => {
  const { CompanionEmotionStatus } = await importHomeSurfaceSections();
  const conversation = await importConversationStateModule();

  for (const emotionId of NON_NEUTRAL_EMOTIONS) {
    for (const intensity of Object.keys(INTENSITY_LABELS)) {
      const companion = projectEmotion(conversation, emotionId, intensity);
      const html = renderCompanionEmotionStatus(CompanionEmotionStatus, companion);
      const text = visibleText(html);
      const expectedLabel = `${INTENSITY_LABELS[intensity]}${EMOTION_LABELS[emotionId]}`;

      assert.ok(html.includes(`data-zhiyu-companion-current-emotion-id="${emotionId}"`), `D-02 ${emotionId}/${intensity} id data`);
      assert.ok(html.includes(`data-zhiyu-companion-current-emotion-intensity="${intensity}"`), `D-02 ${emotionId}/${intensity} intensity data`);
      assert.ok(html.includes(`data-zhiyu-companion-current-emotion-label="${expectedLabel}"`), `D-02 ${emotionId}/${intensity} label data`);
      assert.match(text, new RegExp(expectedLabel, 'u'), `D-02 ${emotionId}/${intensity} visible label`);
      assert.equal(text.includes(emotionId), false, `D-02 ${emotionId}/${intensity} raw id not user-facing text`);
    }
  }
});

test('D-02/D-L1 renders the default no-intensity state without strength wording', async () => {
  const { CompanionEmotionStatus } = await importHomeSurfaceSections();
  const conversation = await importConversationStateModule();
  const companion = projectEmotion(conversation, 'happy');
  const html = renderCompanionEmotionStatus(CompanionEmotionStatus, companion);
  const text = visibleText(html);

  assert.ok(html.includes('data-zhiyu-companion-current-emotion-id="happy"'), 'D-02 default id data');
  assert.ok(html.includes('data-zhiyu-companion-current-emotion-intensity="not_projected"'), 'D-02 default intensity data');
  assert.ok(html.includes('data-zhiyu-companion-current-emotion-label="开心"'), 'D-02 default label data');
  assert.match(text, /开心/u, 'D-02 default visible label');
  assert.doesNotMatch(text, /轻微|明显|强烈/u, 'D-02 default has no intensity label');
});

test('D-05/D-L1 renders unknown emotion violations without exposing the raw invalid value', async () => {
  const { CompanionEmotionStatus } = await importHomeSurfaceSections();
  const conversation = await importConversationStateModule();
  const companion = projectEmotion(conversation, 'focused');
  const html = renderCompanionEmotionStatus(CompanionEmotionStatus, companion);
  const text = visibleText(html);

  assert.equal(companion.currentEmotionId, null, 'D-05 invalid id not projected');
  assert.equal(companion.currentEmotionCue, null, 'D-05 invalid cue not projected');
  assert.equal(companion.emotionViolation?.rawValue, 'focused', 'D-05 diagnostic raw value');
  assert.equal(companion.emotionViolation?.reasonCode, 'runtime-agent-emotion-id-not-admitted', 'D-05 reason');
  assert.ok(html.includes('data-zhiyu-companion-current-emotion-id="not_projected"'), 'D-05 rendered id data');
  assert.ok(html.includes('data-zhiyu-companion-emotion-violation="true"'), 'D-05 rendered violation data');
  assert.ok(html.includes('data-zhiyu-companion-emotion-violation-reason="runtime-agent-emotion-id-not-admitted"'), 'D-05 rendered reason data');
  assert.match(text, /情绪未识别/u, 'D-05 visible violation label');
  assert.equal(text.includes('focused'), false, 'D-05 raw invalid value not user-facing text');
  assert.equal(html.includes('focused'), false, 'D-05 raw invalid value not rendered in markup');
});

test('D-L1 reducer covers admitted neutral and neutral intensity rejection', async () => {
  const conversation = await importConversationStateModule();
  const neutral = projectEmotion(conversation, 'neutral');
  assert.equal(neutral.currentEmotionId, 'neutral', 'D-L1 neutral id');
  assert.equal(neutral.currentEmotionCue, 'neutral', 'D-L1 neutral cue');
  assert.equal(neutral.currentEmotionIntensity, null, 'D-L1 neutral default intensity');
  assert.equal(neutral.emotionViolation, null, 'D-L1 neutral no violation');

  const violation = projectEmotion(conversation, 'neutral', 'strong');
  assert.equal(violation.currentEmotionId, null, 'D-L1 neutral x intensity not projected');
  assert.equal(violation.currentEmotionCue, null, 'D-L1 neutral x intensity cue not projected');
  assert.equal(violation.emotionViolation?.reasonCode, 'runtime-agent-neutral-emotion-intensity-not-admitted', 'D-L1 neutral x intensity reason');
});

function renderCompanionEmotionStatus(CompanionEmotionStatus, companion) {
  return renderToStaticMarkup(React.createElement(CompanionEmotionStatus, { companion }));
}

function visibleText(html) {
  return html
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function projectEmotion(module, emotionId, intensity) {
  return module.projectZhiyuCompanionFromRuntimeAgentEvent({
    current: blockedCompanion(),
    event: {
      eventName: 'runtime.agent.presentation.activity_requested',
      localAgentRef: 'local-agent:opaque',
      conversationAnchorId: 'conversation-anchor:opaque',
      detail: {
        activityName: emotionId,
        category: 'emotion',
        intensity,
        source: 'apml',
      },
    },
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:opaque',
    observedAt: '2026-07-08T04:00:00.000Z',
  });
}

async function importConversationStateModule() {
  const outputPath = path.join(await buildConversationStateModule(), 'agent-conversation-state.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function importHomeSurfaceSections() {
  const outputPath = path.join(await buildHomeSurfaceSections(), 'home-surface-sections.mjs');
  return import(pathToFileURL(outputPath).href);
}

async function buildConversationStateModule() {
  if (conversationBuildDir) return conversationBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  conversationBuildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-emotion-reducer-matrix-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/agent-chat/agent-conversation-state.ts')],
    outfile: path.join(conversationBuildDir, 'agent-conversation-state.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    sourcemap: false,
    logLevel: 'silent',
    alias: {
      '@nimiplatform/kit/features/avatar/headless': path.join(repoRoot, 'kit/features/avatar/src/headless.ts'),
    },
  });
  return conversationBuildDir;
}

async function buildHomeSurfaceSections() {
  if (viewBuildDir) return viewBuildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  viewBuildDir = mkdtempSync(path.join(tmpdir(), 'nimi-zhiyu-emotion-view-matrix-'));
  await build({
    entryPoints: [path.join(root, 'src/shell/app/home-surface-sections.tsx')],
    outfile: path.join(viewBuildDir, 'home-surface-sections.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: false,
    logLevel: 'silent',
    alias: {
      '@nimiplatform/kit/features/avatar/headless': path.join(repoRoot, 'kit/features/avatar/src/headless.ts'),
      '@nimiplatform/kit/ui': path.join(repoRoot, 'kit/ui/src/index.ts'),
    },
  });
  return viewBuildDir;
}

function blockedCompanion() {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: 'not-probed',
    actionHint: 'probe_runtime_agent_state_projection',
    source: 'renderer',
    message: 'Runtime Agent companion state has not been probed.',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    observedAt: null,
    stateUpdatedAt: null,
    executionState: null,
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    currentEmotion: null,
    currentEmotionId: null,
    currentEmotionCue: null,
    currentEmotionIntensity: null,
    emotionViolation: null,
    participationMode: 'not_projected',
    participationSource: null,
    projectedFields: [],
    unsupportedExplainabilityFields: [],
    proactiveInterruptibility: {
      transport: 'electron-ipc',
      ready: false,
      deliveryReady: false,
      state: 'blocked',
      reasonCode: 'not-probed',
      actionHint: 'probe_runtime_agent_proactive_interruptibility',
      source: 'renderer',
      message: 'Runtime Agent proactive interruptibility has not been probed.',
      ownerUserId: null,
      runtimeSourceRef: null,
      localAgentRef: null,
      observedAt: null,
      projectionId: null,
      projectionKind: null,
      mode: null,
      optInState: null,
      deliveryChannel: null,
      quietHoursState: null,
      frequencyCapState: null,
      suggestedReasonCode: null,
      lastDeliveredReasonCode: null,
      lastSuppressedReasonCode: null,
      lastSuppressionReason: null,
      sourceHookId: null,
      sourceCadenceId: null,
      auditRefs: [],
      unsupportedFields: ['proactive_interruptibility'],
    },
  };
}
