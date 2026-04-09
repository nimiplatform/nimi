import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Scheduling Warning UI Consumption contract tests (K-SCHED-001 five-state).
 *
 * Verifies:
 * - SchedulingWarningBanner is exported and renders for all non-runnable states
 * - useSchedulingFeasibility hook consumes probeFeasibility from the formal surface
 * - ChatSettingsPanel integrates SchedulingWarningSection
 * - i18n keys exist for all five user-visible scheduling states
 * - No parallel truth: UI reads from AIConfigProbeResult.schedulingJudgement only
 */

const desktopDir = path.resolve(import.meta.dirname, '..');
const guardModulePath = 'src/shell/renderer/features/chat/chat-execution-scheduling-guard.ts';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(desktopDir, relativePath), 'utf8');
}

function readLocale(locale: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.join(desktopDir, `src/shell/renderer/locales/${locale}.json`),
    'utf8',
  );
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Source contract: SchedulingWarningBanner
// ---------------------------------------------------------------------------

test('SchedulingWarningBanner: exported from chat-settings-panel', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /export function SchedulingWarningBanner/);
});

test('SchedulingWarningBanner: receives judgement prop typed as AISchedulingJudgement', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /judgement:\s*AISchedulingJudgement/);
});

test('SchedulingWarningBanner: returns null for runnable state', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  // Must check for runnable and return null — no banner for healthy state
  assert.match(source, /state\s*===\s*'runnable'.*return null/s);
});

test('SchedulingWarningBanner: renders data-scheduling-state attribute for testability', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /data-scheduling-state=\{state\}/);
});

test('SchedulingWarningBanner: renders data-testid for test selection', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /data-testid="scheduling-warning-banner"/);
});

test('SchedulingWarningBanner: consumes detail from judgement, not hardcoded', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  // detail must be passed to the i18n function, not fabricated
  assert.match(source, /detail:\s*detail/);
  assert.match(source, /schedulingDetailKeyForJudgement/);
});

test('SchedulingWarningBanner: consumes occupancy when present', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /occupancy\s*\?/);
  assert.match(source, /occupancy\.globalUsed/);
  assert.match(source, /occupancy\.globalCap/);
  assert.match(source, /occupancy\.appUsed/);
  assert.match(source, /occupancy\.appCap/);
});

test('SchedulingWarningBanner: consumes resourceWarnings array', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /resourceWarnings\.length\s*>\s*0/);
  assert.match(source, /resourceWarnings\.map/);
});

// ---------------------------------------------------------------------------
// Source contract: visual differentiation per state
// ---------------------------------------------------------------------------

const EXPECTED_STATES = ['denied', 'queue_required', 'preemption_risk', 'slowdown_risk', 'unknown'] as const;

test('SchedulingWarningBanner: distinct styling defined for all non-runnable states', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  for (const state of EXPECTED_STATES) {
    assert.match(
      source,
      new RegExp(`${state}.*:\\s*\\{`),
      `Missing style definition for state '${state}'`,
    );
  }
});

test('SchedulingWarningBanner: denied uses error-level styling (red)', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /denied.*red/s);
});

test('SchedulingWarningBanner: queue_required uses info-level styling (blue)', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /queue_required.*blue/s);
});

test('SchedulingWarningBanner: preemption_risk and slowdown_risk use warning-level styling (amber)', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /preemption_risk.*amber/s);
  assert.match(source, /slowdown_risk.*amber/s);
});

// ---------------------------------------------------------------------------
// Source contract: useSchedulingFeasibility hook
// ---------------------------------------------------------------------------

test('useSchedulingFeasibility: exported from shared execution scheduling guard module', () => {
  const source = readSource(guardModulePath);
  assert.match(source, /export function useSchedulingFeasibility/);
});

test('useSchedulingFeasibility: calls probeFeasibility from the formal surface (D-AIPC-012 layer 3)', () => {
  const source = readSource(guardModulePath);
  assert.match(source, /surface\.aiConfig\.probeFeasibility\(scopeRef\)/);
});

test('useSchedulingFeasibility: reads schedulingJudgement from probe result, not custom truth', () => {
  const source = readSource(guardModulePath);
  assert.match(source, /result\.schedulingJudgement/);
  // Must NOT invent isQueued, isRisky, canRun, etc.
  assert.doesNotMatch(source, /isQueued|isRisky|canRun|isBlocked/);
});

test('useSchedulingFeasibility: reads scope reactively from app store, not getActiveScope snapshot', () => {
  const source = readSource(guardModulePath);
  // Must use the reactive Zustand selector, not the snapshot function
  assert.match(source, /useAppStore\(.*aiConfig\.scopeRef/);
  // getActiveScope must not be imported (comments don't count)
  assert.doesNotMatch(source, /import.*getActiveScope/);
});

test('useSchedulingFeasibility: query key includes surfaceId for full scope identity', () => {
  const source = readSource(guardModulePath);
  assert.match(source, /scopeRef\.surfaceId/);
});

test('ChatSettingsPanel: consumes the shared scheduling feasibility hook', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /useSchedulingFeasibility/);
  assert.match(source, /chat-execution-scheduling-guard/);
});

// ---------------------------------------------------------------------------
// Source contract: ChatSettingsPanel integration
// ---------------------------------------------------------------------------

test('ChatSettingsPanel: renders SchedulingWarningSection', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  assert.match(source, /<SchedulingWarningSection\s*\/>/);
});

test('SchedulingWarningSection: renders nothing for runnable or null judgement', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  // The section component should check for null and runnable
  assert.match(source, /judgement\.state\s*===\s*'runnable'/);
  assert.match(source, /!judgement/);
});

// ---------------------------------------------------------------------------
// i18n: all five user-visible states have title + detail keys in both locales
// ---------------------------------------------------------------------------

for (const locale of ['en', 'zh'] as const) {
  const localeData = readLocale(`${locale}`);
  const chatSection = localeData['Chat'] as Record<string, string> | undefined;

  test(`i18n [${locale}]: Chat section exists`, () => {
    assert.ok(chatSection, `Chat section missing in ${locale}.json`);
  });

  const requiredKeys = [
    'schedulingDeniedTitle',
    'schedulingDeniedDetail',
    'schedulingQueueRequiredTitle',
    'schedulingQueueRequiredDetail',
    'schedulingPreemptionRiskTitle',
    'schedulingPreemptionRiskDetail',
    'schedulingSlowdownRiskTitle',
    'schedulingSlowdownRiskDetail',
    'schedulingSlowdownRiskBusyDetail',
    'schedulingUnknownTitle',
    'schedulingUnknownDetail',
    'schedulingResourceWarning',
    'schedulingOccupancy',
  ];

  for (const key of requiredKeys) {
    test(`i18n [${locale}]: Chat.${key} exists and is non-empty`, () => {
      assert.ok(chatSection, `Chat section missing in ${locale}.json`);
      const value = chatSection[key];
      assert.ok(typeof value === 'string' && value.length > 0, `Missing or empty: Chat.${key} in ${locale}.json`);
    });
  }
}

// ---------------------------------------------------------------------------
// No parallel truth: no scheduling state inference outside host surface
// ---------------------------------------------------------------------------

test('no parallel scheduling truth: settings panel does not import scheduler peek directly', () => {
  const source = readSource('src/shell/renderer/features/chat/chat-settings-panel.tsx');
  // Must not bypass the surface and call scheduler.peek or peekSchedulingJudgement directly
  assert.doesNotMatch(source, /peekSchedulingJudgement/);
  assert.doesNotMatch(source, /scheduler\.peek/);
  assert.doesNotMatch(source, /createModRuntimeClient.*scheduler/);
});

test('no parallel scheduling truth: shared guard module reads scope and submit truth from formal surface methods only', () => {
  const source = readSource(guardModulePath);
  assert.match(source, /probeFeasibility/);
  assert.match(source, /probeSchedulingTarget/);
  assert.doesNotMatch(source, /scheduler\.peek/);
});
