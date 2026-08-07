#!/usr/bin/env node

import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEV_WORKSPACE_SURFACES,
  canonicalSurfaceBuildCommand,
  classifyWorkspaceSurfacePath,
  inspectWorkspaceSurfaceFreshness,
  resolveCanonicalSurfaceBuildPlan,
  writeWorkspaceSurfaceStamp,
} from './lib/dev-workspace-surfaces.mjs';
import { spawnCommand } from './lib/command-runner.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const once = process.argv.slice(2).includes('--once');
const debounceMs = 350;
const changedSurfaces = new Set();
const watchers = [];
let debounceTimer;
let building = false;
let closed = false;
let initialized = false;
let ready = false;
let activeChild;

function observe(surface, root) {
  const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
    if (closed || !filename) return;
    const changedPath = path.resolve(root, String(filename));
    const classified = classifyWorkspaceSurfacePath(repoRoot, changedPath);
    if (classified !== surface) return;
    changedSurfaces.add(surface);
    if (initialized) scheduleBuild();
  });
  watchers.push(watcher);
}

function scheduleBuild() {
  if (closed || building || !initialized) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void drainBuildQueue(), debounceMs);
}

async function queueStaleSurfaces() {
  const freshness = await inspectWorkspaceSurfaceFreshness(repoRoot);
  for (const [surface, state] of Object.entries(freshness.states)) {
    if (state.diagnostic) changedSurfaces.add(surface);
  }
  if (changedSurfaces.size === 0) {
    process.stdout.write('[dev:prepare:watch] SDK and Kit canonical outputs are already fresh\n');
  }
}

async function drainBuildQueue() {
  if (closed || building || changedSurfaces.size === 0) return;
  building = true;
  const plan = resolveCanonicalSurfaceBuildPlan(changedSurfaces);
  changedSurfaces.clear();
  const startedAt = Date.now();
  process.stdout.write(`[dev:prepare:watch] canonical build started: ${plan.join(' -> ')}\n`);
  try {
    for (const surface of plan) {
      await runCanonicalBuild(surface);
    }
    const durationMs = Date.now() - startedAt;
    await writeWorkspaceSurfaceStamp(repoRoot, plan, durationMs);
    process.stdout.write(`[dev:prepare:watch] canonical build completed in ${durationMs}ms\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[dev:prepare:watch] canonical build failed: ${message}\n`);
    if (once || !ready) {
      process.exitCode = 1;
      shutdown('SIGTERM');
    }
  } finally {
    building = false;
    if (once) closed = true;
    else if (changedSurfaces.size > 0) scheduleBuild();
  }
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
    activeChild.once('error', reject);
    activeChild.once('exit', (code, signal) => {
      activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${surface} canonical build exited with ${code ?? signal ?? 'unknown'}`));
    });
  });
}

function shutdown(signal) {
  if (closed) return;
  closed = true;
  clearTimeout(debounceTimer);
  for (const watcher of watchers) watcher.close();
  if (activeChild && !activeChild.killed) activeChild.kill(signal);
  if (process.connected) process.disconnect();
}

if (!once) {
  for (const [surface, definition] of Object.entries(DEV_WORKSPACE_SURFACES)) {
    observe(surface, path.resolve(repoRoot, definition.root));
  }
  process.stdout.write('[dev:prepare:watch] watching SDK and Kit sources; outputs use canonical builds only\n');
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('disconnect', () => shutdown('SIGTERM'));
await queueStaleSurfaces();
initialized = true;
await drainBuildQueue();
if (!closed) {
  ready = true;
  if (typeof process.send === 'function') {
    process.send({ schemaVersion: 1, type: 'nimi-dev-workspace-surfaces-ready' });
  }
}
