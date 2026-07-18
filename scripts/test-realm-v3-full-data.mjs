#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
  FullDataContractError,
  FULL_DATA_STAGES,
  runFullDataStage,
} from './lib/realm-v3-full-data-runner.mjs';

function usage() {
  return [
    'Usage:',
    '  node scripts/test-realm-v3-full-data.mjs --stage <stage> --evidence-dir <abs> [options]',
    '',
    `Stages: ${FULL_DATA_STAGES.join(', ')}`,
    '',
    'Options:',
    '  --nimi-root <abs>                 Defaults to the repository root.',
    '  --source-mode <live|captured>      Final defaults to live; development defaults to captured.',
    '  --realm-evidence <abs>            Required only for captured development replay.',
    '  --runtime-data-root <abs>         Required; frozen disposable runtime target.',
    '  --evidence-dir <abs>              Must be below Nimi .local or .nimi/local.',
    '  --mode <development|final>        Defaults to development.',
    '  --nc6-evidence <abs>              Required final NC6 PASS artifact; content is validated and frozen.',
    '  --live-environment-attestation <abs>  Required live environment PASS artifact.',
    '  --live-cleanup-receipt <abs>      Second final-close phase; admits the external zero-residue receipt.',
    '  --resume                          Reuse only validated PASS partitions.',
    '  --worker <executable>             Required every stage; identity is frozen.',
    '  --worker-arg <arg>                Repeatable worker argument; no shell.',
    '  --worker-child <abs>              Actual child executable after the wrapper -- separator.',
    '  --worker-input <abs>              Repeatable transitive worker file frozen by path and content.',
    '  --census-worker <executable>      Required for every live-source invocation.',
    '  --census-worker-arg <arg>         Repeatable census worker argument; no shell.',
    '  --census-worker-child <abs>       Actual census child executable after the wrapper -- separator.',
    '  --census-worker-input <abs>       Repeatable transitive census worker file.',
    '',
    'Captured replay is structural/compiler evidence only. It never counts as',
    'current Realm authorization. A final close requires a fresh read-only nimi_dev',
    'census and 471 current live receipts. The verified live wrapper injects only',
    'scoped custody after child identity admission; evidence forbids raw secrets.',
  ].join('\n');
}

function parseArgs(argv) {
  const result = {
    workerArgs: [],
    workerInputPaths: [],
    censusWorkerArgs: [],
    censusWorkerInputPaths: [],
    mode: 'development',
    resume: false,
  };
  const valueOptions = new Map([
    ['--stage', 'stage'],
    ['--nimi-root', 'nimiRoot'],
    ['--realm-evidence', 'realmEvidence'],
    ['--runtime-data-root', 'runtimeDataRoot'],
    ['--evidence-dir', 'evidenceDir'],
    ['--mode', 'mode'],
    ['--source-mode', 'sourceMode'],
    ['--nc6-evidence', 'upstreamEvidencePath'],
    ['--live-environment-attestation', 'liveEnvironmentAttestationPath'],
    ['--live-cleanup-receipt', 'liveCleanupReceiptPath'],
    ['--worker', 'worker'],
    ['--worker-child', 'workerChildExecutable'],
    ['--census-worker', 'censusWorker'],
    ['--census-worker-child', 'censusWorkerChildExecutable'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    if (token === '--resume') {
      result.resume = true;
      continue;
    }
    if (token === '--worker-arg') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--worker-arg requires a value');
      result.workerArgs.push(value);
      index += 1;
      continue;
    }
    if (token === '--worker-input') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--worker-input requires a value');
      result.workerInputPaths.push(value);
      index += 1;
      continue;
    }
    if (token === '--census-worker-arg') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--census-worker-arg requires a value');
      result.censusWorkerArgs.push(value);
      index += 1;
      continue;
    }
    if (token === '--census-worker-input') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--census-worker-input requires a value');
      result.censusWorkerInputPaths.push(value);
      index += 1;
      continue;
    }
    const property = valueOptions.get(token);
    if (!property) throw new Error(`unknown argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${token} requires a value`);
    result[property] = value;
    index += 1;
  }
  return result;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const defaultRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  options.nimiRoot = path.resolve(options.nimiRoot || defaultRoot);
  for (const field of ['stage', 'evidenceDir', 'runtimeDataRoot']) {
    if (!options[field]) {
      process.stderr.write(`missing required option: ${field}\n\n${usage()}\n`);
      process.exitCode = 2;
      return;
    }
  }
  options.sourceMode ||= options.mode === 'final' ? 'live' : 'captured';
  if (options.sourceMode === 'captured' && !options.realmEvidence) {
    process.stderr.write(`captured source mode requires --realm-evidence\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.sourceMode === 'live' && !options.censusWorker) {
    process.stderr.write(`live source mode requires --census-worker\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (options.sourceMode === 'live' && !options.liveEnvironmentAttestationPath) {
    process.stderr.write(`live source mode requires --live-environment-attestation\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (
    options.sourceMode === 'live' &&
    (!options.workerChildExecutable || !options.censusWorkerChildExecutable)
  ) {
    process.stderr.write(`live source mode requires --worker-child and --census-worker-child\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  if (!options.worker) {
    process.stderr.write(`full-data run requires --worker on every stage\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    const result = await runFullDataStage(options);
    process.stdout.write(
      `${JSON.stringify({
        stage: options.stage,
        status: result.status || 'PASS',
        evidenceClass: result.evidenceClass || result.runLock?.evidenceClass,
        inputDigest: result.inputDigest || result.runLock?.inputDigest,
        denominator: result.denominator?.total || result.denominator || result.sourceDenominator,
      })}\n`,
    );
  } catch (error) {
    const code = error instanceof FullDataContractError ? error.code : 'unexpected_failure';
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

await main();
