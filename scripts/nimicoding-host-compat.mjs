#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertCompatiblePackageVersion,
  evaluateDoctorCompatibility,
  evaluateSyncCompatibility,
  inspectHostHardcut,
  loadHostHardcutManifest,
} from './lib/nimicoding-host-hardcut.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.join(projectRoot, 'node_modules', '@nimiplatform', 'nimi-coding');
const packageJsonPath = path.join(packageRoot, 'package.json');
const packageBinPath = path.join(packageRoot, 'bin', 'nimicoding.mjs');
const rawArgs = process.argv.slice(2);
const jsonOutput = rawArgs.includes('--json');
const positionalArgs = rawArgs.filter((arg) => arg !== '--json' && arg !== '--');
const [command, blockedCommand, ...extraArgs] = positionalArgs;

function fail(message, failures = []) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ ok: false, command, message, failures }, null, 2)}\n`);
  } else {
    process.stderr.write(`${message}\n`);
    for (const failure of failures) {
      process.stderr.write(`- ${failure}\n`);
    }
  }
  process.exitCode = 1;
}

function runPackageJson(args) {
  const child = spawnSync(process.execPath, [packageBinPath, ...args, '--json'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NIMICODING_LANG: 'en',
      NO_COLOR: '1',
    },
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (child.error) {
    throw new Error(`failed to execute installed nimi-coding CLI: ${child.error.message}`);
  }
  if (child.signal) {
    throw new Error(`installed nimi-coding CLI terminated by signal ${child.signal}`);
  }
  if (child.status !== 0 && child.status !== 1) {
    const detail = (child.stderr || child.stdout || '').trim();
    throw new Error(`installed nimi-coding CLI exited ${child.status}${detail ? `: ${detail}` : ''}`);
  }
  let report;
  try {
    report = JSON.parse(child.stdout);
  } catch (error) {
    throw new Error(`installed nimi-coding CLI returned invalid JSON: ${error.message}`);
  }
  if (typeof report.ok !== 'boolean' || (child.status === 0) !== report.ok) {
    throw new Error('installed nimi-coding CLI exit status does not match the report ok field');
  }
  return { status: child.status, report };
}

function emitPass(result) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const syncCount = result.sync?.tolerated.length ?? 0;
  const doctorCount = result.doctor?.toleratedCheckIds.length ?? 0;
  process.stdout.write(
    `nimicoding host ${result.command}: PASS (package ${result.packageVersion}; ${syncCount} declared seed exceptions; ${doctorCount} declared doctor exceptions)\n`,
  );
}

if (extraArgs.length > 0 || (command === 'block' && !blockedCommand) || (command !== 'block' && blockedCommand)) {
  fail(`invalid arguments for nimicoding host compatibility command: ${positionalArgs.join(' ') || 'missing'}`);
} else if (command === 'block') {
  fail(
    `nimicoding package command ${blockedCommand ?? 'unknown'} is blocked by the Nimi host workflow hardcut; use Codex App for task workflow and the retained host validators for governance`,
  );
} else if (command !== 'sync-check' && command !== 'doctor') {
  fail(`unsupported nimicoding host compatibility command: ${command ?? 'missing'}`);
} else {
  try {
    const manifest = await loadHostHardcutManifest(projectRoot);
    const hostReport = await inspectHostHardcut(projectRoot, manifest);
    if (!hostReport.ok) {
      fail('nimicoding host compatibility preflight failed', hostReport.failures);
    } else {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      assertCompatiblePackageVersion(packageJson, manifest);

      const syncRun = runPackageJson(['sync', '--check']);
      const sync = evaluateSyncCompatibility(syncRun.report, manifest);
      if (!sync.ok) {
        fail('nimicoding host seed compatibility failed', sync.failures);
      } else if (command === 'sync-check') {
        emitPass({
          ok: true,
          command,
          packageVersion: packageJson.version,
          sync,
        });
      } else {
        const doctorRun = runPackageJson(['doctor']);
        const doctor = evaluateDoctorCompatibility(doctorRun.report, manifest, projectRoot);
        if (!doctor.ok) {
          fail('nimicoding host doctor compatibility failed', doctor.failures);
        } else {
          emitPass({
            ok: true,
            command,
            packageVersion: packageJson.version,
            sync,
            doctor,
          });
        }
      }
    }
  } catch (error) {
    fail('nimicoding host compatibility failed', [error.message]);
  }
}
