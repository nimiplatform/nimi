#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { quietBuildDelayMs, stableBuildSurfaces } from './lib/dev-build-scheduler.mjs';
import {
  DEV_WORKSPACE_SURFACES,
  DEV_WORKSPACE_SURFACE_WATCH_TARGETS,
  canonicalSurfaceBuildCommand,
  classifyWorkspaceSurfacePath,
  inspectWorkspaceSurfaceFreshness,
  resolveCanonicalSurfaceBuildPlan,
  writeWorkspaceSurfaceStamp,
} from './lib/dev-workspace-surfaces.mjs';
import { spawnCommand } from './lib/command-runner.mjs';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const once = process.argv.slice(2).includes('--once');
const quietMs = 1_000;
const changedSurfaces = new Set();
const changedPaths = new Map();
const surfaceRevisions = Object.fromEntries(
  Object.keys(DEV_WORKSPACE_SURFACES).map((surface) => [surface, 0]),
);
const watchers = [];
let buildTimer;
let building = false;
let closed = false;
let initialized = false;
let ready = false;
let activeChild;
let lastChangeAt = 0;
let lastBuildCompletedAt = 0;

function markSurfaceChanged(surface, trigger, observedAt = Date.now()) {
  changedSurfaces.add(surface);
  surfaceRevisions[surface] = (surfaceRevisions[surface] ?? 0) + 1;
  if (!changedPaths.has(surface)) changedPaths.set(surface, new Set());
  changedPaths.get(surface).add(trigger);
  if (observedAt > 0) lastChangeAt = Math.max(lastChangeAt, observedAt);
}

function observe(surface, target) {
  const root = path.resolve(repoRoot, target.root);
  const watcher = watch(root, { recursive: target.recursive }, (_eventType, filename) => {
    if (closed || !filename) return;
    const changedPath = path.resolve(root, String(filename));
    const classified = classifyWorkspaceSurfacePath(repoRoot, changedPath);
    if (classified !== surface) return;
    markSurfaceChanged(surface, path.relative(repoRoot, changedPath));
    if (initialized && ready) scheduleBuild();
  });
  watchers.push(watcher);
}

function scheduleBuild() {
  if (closed || building || !initialized || !ready || changedSurfaces.size === 0) return;
  clearTimeout(buildTimer);
  const delayMs = quietBuildDelayMs({
    now: Date.now(),
    lastChangeAt,
    lastBuildCompletedAt,
    quietMs,
  });
  buildTimer = setTimeout(() => void drainReadyQueue(), delayMs);
}

async function queueStaleSurfaces({ announceFresh = false } = {}) {
  const freshness = await inspectWorkspaceSurfaceFreshness(repoRoot);
  for (const [surface, state] of Object.entries(freshness.states)) {
    if (state.diagnostic && !changedSurfaces.has(surface)) {
      markSurfaceChanged(surface, `[freshness:${state.diagnostic}]`, 0);
    }
  }
  if (announceFresh && changedSurfaces.size === 0) {
    process.stdout.write('[dev:prepare:watch] SDK and Kit canonical outputs are already fresh\n');
  }
  return freshness;
}

async function waitForQuiet() {
  for (;;) {
    const delayMs = quietBuildDelayMs({
      now: Date.now(),
      lastChangeAt,
      lastBuildCompletedAt,
      quietMs,
    });
    if (delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (closed) return;
  }
}

async function drainInitialQueue() {
  for (;;) {
    if (closed) return false;
    if (changedSurfaces.size === 0) {
      const freshness = await queueStaleSurfaces();
      if (freshness.fresh) return true;
    }
    await waitForQuiet();
    if (closed) return false;
    if (!await runNextBuild()) return false;
  }
}

async function drainReadyQueue() {
  buildTimer = undefined;
  if (closed || building || changedSurfaces.size === 0) return;
  await waitForQuiet();
  if (closed || building || changedSurfaces.size === 0) return;
  const succeeded = await runNextBuild();
  if (succeeded && changedSurfaces.size > 0) scheduleBuild();
}

async function runNextBuild() {
  if (closed || building || changedSurfaces.size === 0) return false;
  building = true;
  const plan = resolveCanonicalSurfaceBuildPlan(changedSurfaces);
  const revisionsBefore = { ...surfaceRevisions };
  const triggerSummary = describeTriggers(changedPaths);
  changedSurfaces.clear();
  changedPaths.clear();
  const startedAt = Date.now();
  process.stdout.write(
    `[dev:prepare:watch] canonical build started: ${plan.join(' -> ')}${triggerSummary}\n`,
  );
  try {
    await withSdkDistLock(`dev canonical build: ${plan.join(' -> ')}`, async () => {
      for (const surface of plan) await runCanonicalBuild(surface);
    });
    const durationMs = Date.now() - startedAt;
    const stableSurfaces = stableBuildSurfaces(plan, revisionsBefore, surfaceRevisions);
    if (stableSurfaces.length > 0) {
      await writeWorkspaceSurfaceStamp(repoRoot, stableSurfaces, durationMs);
    }
    const pending = plan.filter((surface) => !stableSurfaces.includes(surface));
    process.stdout.write(
      `[dev:prepare:watch] canonical build completed in ${durationMs}ms`
      + (pending.length > 0 ? `; pending newer input: ${pending.join(', ')}` : '')
      + '\n',
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[dev:prepare:watch] canonical build failed: ${message}\n`);
    if (once || !ready) {
      process.exitCode = 1;
      shutdown();
    }
    return false;
  } finally {
    building = false;
    lastBuildCompletedAt = Date.now();
  }
}

function describeTriggers(pathsBySurface) {
  const rows = [];
  let total = 0;
  for (const [surface, paths] of pathsBySurface) {
    for (const changedPath of paths) {
      total += 1;
      if (rows.length < 5) rows.push(`${surface}:${changedPath}`);
    }
  }
  if (total === 0) return '';
  return `; triggers (${total}): ${rows.join(', ')}${total > rows.length ? ', ...' : ''}`;
}

function runCanonicalBuild(surface) {
  const args = canonicalSurfaceBuildCommand(surface);
  return new Promise((resolve, reject) => {
    activeChild = spawnCommand(pnpmBin, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    activeChild.once('error', (error) => {
      activeChild = undefined;
      reject(error);
    });
    activeChild.once('exit', (code, signal) => {
      activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${surface} canonical build exited with ${code ?? signal ?? 'unknown'}`));
    });
  });
}

function shutdown() {
  if (closed) return;
  closed = true;
  clearTimeout(buildTimer);
  for (const watcher of watchers) watcher.close();
  terminateActiveChild();
  if (process.connected) process.disconnect();
}

function terminateActiveChild() {
  if (!activeChild?.pid || activeChild.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill.exe', ['/pid', String(activeChild.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  activeChild.kill('SIGTERM');
}

if (!once) {
  for (const surface of Object.keys(DEV_WORKSPACE_SURFACES)) {
    for (const target of DEV_WORKSPACE_SURFACE_WATCH_TARGETS[surface]) {
      observe(surface, target);
    }
  }
  process.stdout.write('[dev:prepare:watch] watching canonical SDK and Kit build inputs\n');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('disconnect', shutdown);
await queueStaleSurfaces({ announceFresh: true });
initialized = true;
const stable = await drainInitialQueue();
if (once) {
  closed = true;
} else if (stable && !closed) {
  ready = true;
  if (typeof process.send === 'function') {
    process.send({ schemaVersion: 1, type: 'nimi-dev-workspace-surfaces-ready' });
  }
}
