import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runFullChainCoreTrial } from './cross-app-driver.mjs';
import {
  runCommandExtendedJourneyTrial,
  runProductSummaryExtendedJourneyTrial,
} from './extended-driver.mjs';
import { repoRoot } from './registry.mjs';
import { assertSourceState } from './source-state.mjs';
import { createIsolatedJourneyRoot, removeIsolatedTrialRoot } from './trial-root.mjs';

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

export async function buildProductPrerequisites(journeys, evidenceRoot) {
  const needsDesktop = journeys.some((journey) => journey.environment.requires_desktop);
  const needsZhiyu = journeys.some((journey) => journey.environment.requires_zhiyu);
  const commands = [
    ...(needsDesktop ? [
      ['pnpm', ['--filter', '@nimiplatform/desktop', 'build:renderer']],
      ['pnpm', ['--filter', '@nimiplatform/desktop', 'build:electron']],
    ] : []),
    ...(needsZhiyu ? [
      ['pnpm', ['--filter', '@nimiplatform/zhiyu', 'build']],
      ['pnpm', ['--filter', '@nimiplatform/zhiyu', 'build:electron']],
    ] : []),
  ];
  if (commands.length === 0) return;
  const outputDir = path.join(evidenceRoot, 'prerequisites');
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [index, [command, args]] of commands.entries()) {
    const result = await runProcess(command, args);
    const log = path.join(outputDir, `${String(index + 1).padStart(2, '0')}-${args.at(-1)}.log`);
    fs.writeFileSync(log, `${result.stdout}\n${result.stderr}`);
    if (result.code !== 0 || result.signal) {
      throw new Error(`Journey prerequisite failed (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`);
    }
  }
}

function gateSchedule(architecture, gate) {
  if (gate === 'core') return [{ journeyId: 'full-chain-core', repeats: 1 }];
  if (gate === 'core-stability') return [{ journeyId: 'full-chain-core', repeats: 3 }];
  if (gate === 'extended') return architecture.policy.gates.extended.journeys.map((row) => ({
    journeyId: row.journey_id,
    repeats: row.repeats,
  }));
  throw new Error(`unsupported Journey gate ${gate}`);
}

export async function runJourneyGate({ architecture, evidenceRoot, gate, sourceState }) {
  const schedule = gateSchedule(architecture, gate);
  const journeyById = new Map(architecture.journeys.journeys.map((journey) => [journey.journey_id, journey]));
  const scheduledJourneys = schedule.map((row) => journeyById.get(row.journeyId));
  if (scheduledJourneys.some((journey) => !journey)) throw new Error(`${gate} references an unknown Journey`);
  await buildProductPrerequisites(scheduledJourneys, evidenceRoot);
  assertSourceState(sourceState, repoRoot);
  const records = [];
  for (const item of schedule) {
    const journey = journeyById.get(item.journeyId);
    for (let repeatIndex = 1; repeatIndex <= item.repeats; repeatIndex += 1) {
      const trial = createIsolatedJourneyRoot({
        journeyId: journey.journey_id,
        tier: journey.applicable_layer,
        batch: gate,
        repeatIndex,
      });
      const outputDir = path.join(evidenceRoot, 'journeys', journey.journey_id, `repeat-${repeatIndex}`);
      let completed = false;
      try {
        const persisted = journey.journey_id === 'full-chain-core'
          ? await runFullChainCoreTrial({ architecture, journey, trial, sourceState, outputDir })
          : await runExtendedJourneyTrial({ architecture, journey, trial, sourceState, outputDir });
        records.push({
          kind: 'journey',
          id: journey.journey_id,
          repeatIndex,
          resultPath: path.relative(evidenceRoot, persisted.resultPath),
          durationMs: persisted.result.durationMs,
          outcome: persisted.result.outcome,
        });
        completed = true;
      } finally {
        if (completed) removeIsolatedTrialRoot(trial);
        else process.stderr.write(`LocalAgent Journey diagnostic root retained: ${trial.paths.root}\n`);
      }
      assertSourceState(sourceState, repoRoot);
    }
  }
  return records;
}

async function runExtendedJourneyTrial(input) {
  if (['pre-materialization-offline', 'turn-media-recovery', 'native-macos-input'].includes(input.journey.journey_id)) {
    return runProductSummaryExtendedJourneyTrial(input);
  }
  return runCommandExtendedJourneyTrial(input);
}
