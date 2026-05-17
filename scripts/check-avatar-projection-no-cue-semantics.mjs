#!/usr/bin/env node
// Guard for Avatar projection backpressure wave-0.
//
// Enforces that current work is evidence/audit only: no Avatar-local cue
// scheduler, no priority/terminal/interrupt ownership, and no voice/lipsync
// smoothing path.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOPIC_ID = '2026-05-16-avatar-projection-stability-queue';
const TOPIC_ROOT_CANDIDATES = [
  `.nimi/topics/ongoing/${TOPIC_ID}`,
  `.nimi/topics/proposal/${TOPIC_ID}`,
];
const DESIGN = resolveTopicDoc('design.md');
const DOCTRINE = resolveTopicDoc('implementation-doctrine.md');
const THROTTLED_EMIT = 'apps/avatar/src/shell/renderer/app-shell/throttled-emit.ts';
const EMBODIMENT_STAGE = 'apps/avatar/src/shell/renderer/embodiment-stage/embodiment-stage.tsx';
const WAVE1_CONTRACT = '.nimi/spec/avatar/kernel/projection-backpressure-smoothing-contract.md';
const PROJECTION_SMOOTHING = 'apps/avatar/src/shell/renderer/nas/projection-smoothing.ts';
const PROJECTION_SMOOTHING_TEST = 'apps/avatar/src/shell/renderer/nas/projection-smoothing.test.ts';
const AVATAR_CARRIER = 'apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts';
const RENDERER_ROOT = path.join(ROOT, 'apps', 'avatar', 'src', 'shell', 'renderer');

let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`[avatar-projection-no-cue-semantics] FAIL ${message}`);
}

function resolveTopicDoc(fileName) {
  for (const candidate of TOPIC_ROOT_CANDIDATES) {
    const relPath = path.join(candidate, fileName);
    if (existsSync(path.join(ROOT, relPath))) {
      return relPath;
    }
  }
  return path.join(TOPIC_ROOT_CANDIDATES[0], fileName);
}

function read(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf8');
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function requireIncludes(relPath, needles) {
  const text = read(relPath);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      fail(`${relPath} must include ${needle}`);
    }
  }
  return text;
}

function requireExcludes(relPath, needles) {
  const text = read(relPath);
  for (const needle of needles) {
    if (text.includes(needle)) {
      fail(`${relPath} must not include ${needle}`);
    }
  }
  return text;
}

requireIncludes(DESIGN, [
  'K-AGCORE-051',
  'Wave-0 Current Evidence Snapshot',
  'createThrottledEmit<BackendHitRegion>',
  'not Runtime cue scheduling',
  'voice/lipsync modules',
]);

requireIncludes(DOCTRINE, ['pnpm check:avatar-projection-no-cue-semantics']);

requireIncludes(THROTTLED_EMIT, [
  'THROTTLED_EMIT_DEFAULT_MIN_INTERVAL_MS = 100',
  'onHitRegionChange',
  'LATEST queued value wins',
]);
requireExcludes(THROTTLED_EMIT, [
  'lipsync',
  'voice',
  'activity',
  'terminal',
]);

requireIncludes(EMBODIMENT_STAGE, [
  'createThrottledEmit<BackendHitRegion>',
  'onHitRegionChange',
]);
requireExcludes(EMBODIMENT_STAGE, [
  'createThrottledEmit<AgentDataBundle>',
  'createThrottledEmit<RuntimeAgentConsumeEvent>',
  'createThrottledEmit<AvatarVoice',
]);

requireIncludes(WAVE1_CONTRACT, [
  'K-AGCORE-051',
  'setSignal',
  'addSignal',
  'getSignal',
  'triggerMotion',
  'setExpression',
  'voice/lipsync modules are not part of the smoothing implementation',
]);

requireIncludes(PROJECTION_SMOOTHING, [
  'PROJECTION_SIGNAL_SMOOTHING_MAX_PENDING_SIGNALS',
  'setSignal(signalId, value, weight = 1)',
  'addSignal(signalId, delta)',
  'getSignal(signalId)',
  'flushBefore',
  'triggerMotion(motionId, opts)',
  'setExpression(expressionId)',
  'runDefaultActivity(activityId, options)',
]);
requireExcludes(PROJECTION_SMOOTHING, [
  'RuntimeAgentConsumeEvent',
  'lipsync',
  'voice',
  'terminal',
  'interrupt',
]);

requireIncludes(PROJECTION_SMOOTHING_TEST, [
  'coalesces repeated setSignal writes',
  'accumulates addSignal writes',
  'flushes pending signals before non-signal projection calls',
  'bounds pending signal memory',
]);

requireIncludes(AVATAR_CARRIER, [
  'createSmoothedProjection',
  'projectionSmoothing?.dispose()',
  'runtimeCueProjection',
]);

const suspiciousFiles = walk(RENDERER_ROOT)
  .map((file) => path.relative(ROOT, file))
  .filter((file) => /projection[-_]?backpressure|cue[-_]?queue|cue[-_]?scheduler|priority[-_]?queue/u.test(file));

if (suspiciousFiles.length > 0) {
  fail(`unexpected queue/scheduler/backpressure implementation files: ${suspiciousFiles.join(', ')}`);
}

if (failures > 0) {
  console.error(`[avatar-projection-no-cue-semantics] ${failures} failure(s)`);
  process.exit(1);
}

console.log('[avatar-projection-no-cue-semantics] PASS');
