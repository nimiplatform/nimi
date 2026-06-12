#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assess } from './assess';
import { loadAdapterCapabilityLedger } from './ledger';
import { loadFrameworkApiCapabilityMap } from './map';
import { renderTextReport } from './report';
import {
  scanSource,
  type NimiDoctorDynamicImport,
  type NimiDoctorScanHit,
  type NimiDoctorUnboundCall,
  type NimiDoctorUnknownApi,
} from './scanner';

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', '.git', '.next', 'coverage']);

interface CliOptions {
  readonly targetDir: string;
  readonly json: boolean;
  readonly mapPath: string;
  readonly ledgerPath: string;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let targetDir: string | undefined;
  let json = false;
  let mapPath: string | undefined;
  let ledgerPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--map') {
      mapPath = argv[(index += 1)];
      if (!mapPath || mapPath.startsWith('-')) {
        throw new Error('--map requires a path value');
      }
    } else if (arg === '--ledger') {
      ledgerPath = argv[(index += 1)];
      if (!ledgerPath || ledgerPath.startsWith('-')) {
        throw new Error('--ledger requires a path value');
      }
    } else if (!arg.startsWith('-') && !targetDir) {
      targetDir = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!targetDir) {
    throw new Error(
      'usage: nimi-sdk-doctor <target-dir> [--json] [--map <path>] [--ledger <path>]\n'
      + 'exit codes: 0 = assessment produced; 1 = invocation/scan error; 2 = map/ledger config drift (do not trust the report)',
    );
  }
  const resolvedTarget = path.resolve(targetDir);
  const specRoot = findSpecRoot();
  const resolvedMap = mapPath
    ? path.resolve(mapPath)
    : specRoot && path.join(specRoot, 'sdks/kernel/tables/framework-api-capability-map.yaml');
  const resolvedLedger = ledgerPath
    ? path.resolve(ledgerPath)
    : specRoot && path.join(specRoot, 'sdks/kernel/tables/typescript-adapter-capability-ledger.yaml');
  if (!resolvedMap || !existsSync(resolvedMap)) {
    throw new Error(
      'framework-api-capability-map.yaml not found; run inside the nimi repo or pass --map <path>',
    );
  }
  if (!resolvedLedger || !existsSync(resolvedLedger)) {
    throw new Error(
      'typescript-adapter-capability-ledger.yaml not found; run inside the nimi repo or pass --ledger <path>',
    );
  }
  return { targetDir: resolvedTarget, json, mapPath: resolvedMap, ledgerPath: resolvedLedger };
}

function findSpecRoot(): string | undefined {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 10; depth += 1) {
    const candidate = path.join(current, '.nimi/spec');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

function* walkScannableFiles(root: string): Generator<string> {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) {
        yield* walkScannableFiles(path.join(root, entry.name));
      }
      continue;
    }
    if (SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(root, entry.name);
    }
  }
}

export function runNimiSdkDoctor(options: CliOptions): { readonly exitCode: number; readonly output: string } {
  const frameworks = loadFrameworkApiCapabilityMap(readFileSync(options.mapPath, 'utf8'));
  const ledger = loadAdapterCapabilityLedger(readFileSync(options.ledgerPath, 'utf8'));

  if (!statSync(options.targetDir).isDirectory()) {
    throw new Error(`target is not a directory: ${options.targetDir}`);
  }

  const hits: NimiDoctorScanHit[] = [];
  const unknownApis: NimiDoctorUnknownApi[] = [];
  const unboundCalls: NimiDoctorUnboundCall[] = [];
  const dynamicImports: NimiDoctorDynamicImport[] = [];
  const detectedPending = new Set<string>();
  for (const file of walkScannableFiles(options.targetDir)) {
    const result = scanSource({
      fileName: path.relative(options.targetDir, file),
      sourceText: readFileSync(file, 'utf8'),
      frameworks,
    });
    hits.push(...result.hits);
    unknownApis.push(...result.unknownApis);
    unboundCalls.push(...result.unboundCalls);
    dynamicImports.push(...result.dynamicImports);
    for (const pending of result.detectedPendingFrameworks) {
      detectedPending.add(pending);
    }
  }

  const assessment = assess({
    frameworks,
    ledger,
    hits,
    unknownApis,
    unboundCalls,
    dynamicImports,
    detectedPendingFrameworks: [...detectedPending],
  });

  const output = options.json ? JSON.stringify(assessment, null, 2) : renderTextReport(assessment);
  const exitCode = assessment.configErrors.length > 0 ? 2 : 0;
  return { exitCode, output };
}

const isDirectInvocation = (() => {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (isDirectInvocation) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { exitCode, output } = runNimiSdkDoctor(options);
    console.log(output);
    process.exit(exitCode);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
