import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const zhiyuRoot = path.resolve(import.meta.dirname, '..', '..');
const repoRoot = path.resolve(zhiyuRoot, '..', '..');
const planEvidenceRoot = path.join(
  repoRoot,
  '.nimi/local/plan/2026-07-08-zhiyu-voice-emotion-full-auto-test/evidence/scenario-results',
);

export function scenarioRepeatCount() {
  const parsed = Number.parseInt(process.env.NIMI_ZHIYU_SCENARIO_REPEAT || '3', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function scenarioTestTimeoutMs() {
  return Math.max(300_000, scenarioRepeatCount() * 90_000);
}

export async function runRepeatedScenario(input) {
  const repeat = scenarioRepeatCount();
  const results = [];
  await mkdir(planEvidenceRoot, { recursive: true });
  for (let iteration = 1; iteration <= repeat; iteration += 1) {
    const startedAt = new Date().toISOString();
    try {
      const result = await input.runOnce({
        scenarioId: input.id,
        iteration,
        repeat,
      });
      results.push({
        id: input.id,
        group: input.group,
        iteration,
        status: 'passed',
        startedAt,
        finishedAt: new Date().toISOString(),
        ...result,
      });
    } catch (error) {
      results.push({
        id: input.id,
        group: input.group,
        iteration,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.stack || error.message : String(error),
      });
    }
  }
  const failures = results.filter((result) => result.status !== 'passed');
  const summary = {
    id: input.id,
    group: input.group,
    repeat,
    passCount: results.length - failures.length,
    failCount: failures.length,
    flakeRate: failures.length / Math.max(1, results.length),
    results,
  };
  await writeFile(
    path.join(planEvidenceRoot, `${input.group}-${input.id}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );
  assert.equal(failures.length, 0, `${input.group}-${input.id} scenario failures: ${JSON.stringify(failures, null, 2)}`);
  return summary;
}
