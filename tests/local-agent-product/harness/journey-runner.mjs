import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { withSdkDistLock } from '../../../scripts/lib/sdk-dist-lock.mjs';
import { runDevKernelCoreTrial } from './dev-kernel-cross-app-driver.mjs';
import { repoRoot } from './registry.mjs';
import { resolvePortableProcessInvocation } from './process-command.mjs';
import { pruneRetainedTrialRootPayload } from './sandbox-hygiene.mjs';
import { createIsolatedJourneyRoot, removeIsolatedTrialRoot } from './trial-root.mjs';

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const invocation = resolvePortableProcessInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
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
  const devKernel = journeys.some((journey) => journey.journey_id === 'dev-kernel-core');
  const commands = [
    ...(needsDesktop ? [
      ['pnpm', ['--filter', '@nimiplatform/desktop', 'build:renderer']],
      ...(!devKernel ? [['pnpm', ['--filter', '@nimiplatform/desktop', 'build:electron']]] : []),
    ] : []),
    ...(needsZhiyu ? [
      ['pnpm', ['--filter', '@nimiplatform/zhiyu', 'build']],
      ['pnpm', ['--filter', '@nimiplatform/zhiyu', 'build:electron']],
    ] : []),
  ];
  if (commands.length === 0) return;
  await withSdkDistLock(`local-agent-product prerequisites: ${journeys.map((journey) => journey.journey_id).join(',')}`, async () => {
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
  });
}

function gateSchedule(architecture, gate, repeats) {
  const configuredGate = gate === 'core'
    ? architecture.policy.gates.core
    : gate === 'core-stability' ? architecture.policy.gates.core_stability : null;
  if (!configuredGate) throw new Error(`unsupported Journey gate ${gate}`);
  return configuredGate.journeys.map((row) => ({
    journeyId: typeof row === 'string' ? row : row.journey_id,
    repeats,
  }));
}

export async function runJourneyGate({ architecture, evidenceRoot, gate, repeats = 1, sourceState }) {
  const schedule = gateSchedule(architecture, gate, repeats);
  const journeyById = new Map(architecture.journeys.journeys.map((journey) => [journey.journey_id, journey]));
  const scheduledJourneys = schedule.map((row) => journeyById.get(row.journeyId));
  if (scheduledJourneys.some((journey) => !journey)) throw new Error(`${gate} references an unknown Journey`);
  await buildProductPrerequisites(scheduledJourneys, evidenceRoot);
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
        const persisted = await runDevKernelCoreTrial({ architecture, journey, trial, sourceState, outputDir });
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
        else {
          const pruned = pruneRetainedTrialRootPayload(trial);
          process.stderr.write(`LocalAgent Journey diagnostic root retained (runtime-data payload pruned: ${pruned.pruned.join(', ') || 'none'}): ${trial.paths.root}\n`);
          for (const failure of pruned.failed) process.stderr.write(`LocalAgent Journey retained-root prune failed for ${failure.target} (${failure.code})\n`);
        }
      }
    }
  }
  return records;
}
