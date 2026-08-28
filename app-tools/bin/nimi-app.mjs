#!/usr/bin/env node

import process from 'node:process';
import {
  APP_SCAFFOLD_FEATURE_IDS,
  createApp,
  doctorAppScaffold,
  initAppScaffold,
  resolveAppCreateInput,
  resolveAppCreatePlan,
  runDevShell,
  updateAppScaffold,
} from '../lib/index.mjs';
import { APP_SCAFFOLD_MODULE_REGISTRY } from '../lib/app-scaffold-capabilities.mjs';
import { createInterface } from 'node:readline/promises';

function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  const values = {
    dir: '', profile: '', appId: '', title: '', packageName: '', author: '',
    features: undefined, shell: '', cdpPort: undefined, noCdp: false, conformance: '', json: false,
  };
  const seen = new Set();
  const readValue = (index, flag, key, preserve = false) => {
    if (seen.has(key)) throw new Error(`Duplicate option: ${flag}`);
    const next = rest[index + 1];
    if (next === undefined || String(next).startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    const value = preserve ? String(next) : String(next).trim();
    if (!value) throw new Error(`${flag} requires a non-empty value`);
    seen.add(key);
    values[key] = value;
    return index + 1;
  };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--') {
      continue;
    }
    if (rest[index] === '--dir') {
      index = readValue(index, '--dir', 'dir');
      continue;
    }
    if (rest[index] === '--profile') {
      index = readValue(index, '--profile', 'profile');
      continue;
    }
    if (rest[index] === '--app-id') {
      index = readValue(index, '--app-id', 'appId', true);
      continue;
    }
    if (rest[index] === '--title') {
      index = readValue(index, '--title', 'title', true);
      continue;
    }
    if (rest[index] === '--package-name') {
      index = readValue(index, '--package-name', 'packageName', true);
      continue;
    }
    if (rest[index] === '--author') {
      index = readValue(index, '--author', 'author', true);
      continue;
    }
    if (rest[index] === '--features') {
      index = readValue(index, '--features', 'features');
      continue;
    }
    if (rest[index] === '--shell') {
      index = readValue(index, '--shell', 'shell');
      continue;
    }
    if (rest[index] === '--cdp-port') {
      index = readValue(index, '--cdp-port', 'cdpPort');
      continue;
    }
    if (rest[index] === '--no-cdp') {
      if (seen.has('noCdp')) throw new Error('Duplicate option: --no-cdp');
      seen.add('noCdp');
      values.noCdp = true;
      continue;
    }
    if (rest[index] === '--conformance') {
      index = readValue(index, '--conformance', 'conformance');
      continue;
    }
    if (rest[index] === '--json') {
      if (seen.has('json')) throw new Error('Duplicate option: --json');
      seen.add('json');
      values.json = true;
      continue;
    }
    throw new Error(`Unknown option: ${rest[index]}`);
  }
  return Object.freeze({
    command: String(command || '').trim(),
    ...values,
    providedOptions: Object.freeze([...seen]),
  });
}

function assertCommandOptions(command, providedOptions) {
  const allowed = {
    create: new Set(['dir', 'profile', 'appId', 'title', 'packageName', 'author', 'features', 'json']),
    init: new Set(['dir', 'json']),
    doctor: new Set(['dir', 'json', 'conformance']),
    update: new Set(['dir', 'json']),
    dev: new Set(['dir', 'shell', 'cdpPort', 'noCdp']),
  }[command];
  if (!allowed) return;
  const invalid = providedOptions.find((key) => !allowed.has(key));
  if (invalid) throw new Error(`Option --${invalid.replace(/[A-Z]/g, (value) => `-${value.toLowerCase()}`)} is not available for nimi-app ${command}`);
}

function printUsage() {
  const modules = Object.values(APP_SCAFFOLD_MODULE_REGISTRY)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const admitted = modules.filter((module) => module.kind === 'feature' && module.lifecycle === 'admitted');
  const candidates = modules.filter((module) => module.kind === 'feature' && module.lifecycle === 'candidate');
  const internal = modules.filter((module) => module.kind === 'internal');
  const featureList = (entries) => entries.length > 0
    ? entries.map((entry) => `${entry.id} (${entry.label})`).join(', ')
    : '(none)';
  const internalList = internal.length > 0
    ? internal.map((entry) => entry.id).join(', ')
    : '(none)';
  process.stdout.write(
    [
      'Nimi App scaffolding',
      '',
      'Usage:',
      '  nimi-app create [--dir path] [--profile standalone] [--features admitted-ids|all] [--app-id id] [--title title] [--package-name name] [--author person-or-team] [--json]',
      '  nimi-app init [--dir path] [--json]',
      '  nimi-app doctor [--dir path] [--conformance simulator] [--json]',
      '  nimi-app update [--dir path] [--json]',
      '  nimi-app dev [--dir path] [--shell electron] [--cdp-port 1024..65535 | --no-cdp]',
      '',
      'Current module registry:',
      `  Admitted features: ${featureList(admitted)}`,
      `  Candidate features (not public-selectable): ${featureList(candidates)}`,
      `  Internal modules (dependency-only): ${internalList}`,
      admitted.length > 0
        ? `  --features all expands in order to: ${admitted.map((entry) => entry.id).join(', ')}`
        : '  --features all is unavailable because no features are currently admitted.',
      '  Candidate and internal IDs fail closed when passed to the public CLI.',
      '',
      'Composition:',
      '  Base = identity-neutral Lab-derived workbench-core + empty module registry + target adapter.',
      '  Coarse inventory = studio-create (Create), studio-media (Media), studio-voice (Voice), kit-recipes (UI Recipes).',
      '  AI features resolve the internal ai-studio-core once; it cannot be selected directly.',
      '  Generated Apps exclude Lab-only Settings/account, App Access diagnostics, Realm/Agent probes, World Tour, and native/diagnostic surfaces.',
      '',
      'Third-party topology:',
      '  standalone: any empty target directory using public registry package versions only.',
      '  Nimi workspace paths, local tarballs, downgrades, and private validation topology are never public create modes.',
      '',
      'Ownership:',
      '  App-owned: workbench-core and selected module product code under src/capabilities/**.',
      '  Scaffold-managed: carrier, identity, manifest/native wiring, and generated composition glue.',
      '  doctor/update never overwrite app-owned product code.',
      '  Simulator conformance remains an explicit doctor mode for existing Simulator Apps; this scaffold does not generate one.',
      '',
      'Required order:',
      '  nimi-app create -> pnpm install -> pnpm run init -> pnpm run doctor -> pnpm run build -> pnpm dev',
      '  Run init, doctor, and update only after dependency installation.',
      '',
      'Development CDP:',
      '  Electron CDP defaults to an automatically selected loopback port.',
      '  --cdp-port overrides it; --no-cdp disables it.',
      '  NIMI_APP_DEV_CDP_PORT in the project .env provides a stable port below the CLI override.',
      '',
      'Acceptance status:',
      '  Generated build and Desktop-supervised launch remain NOT-VERIFIED until those real journeys run.',
      '  CLI/help or focused tests do not constitute implementation or release acceptance.',
      '',
    ].join('\n'),
  );
}

const CANCEL_TOKEN = ':cancel';

function defaultPackageName(appId) {
  return String(appId || 'my-nimi-app').replaceAll('.', '-');
}

async function collectCreateInput(cwd, initial) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const raw = { ...initial };
  const ask = async ({ key, label, fallback = '', optional = false }) => {
    for (;;) {
      const suffix = fallback ? ` [${fallback}]` : optional ? ' (optional)' : '';
      const answer = await prompt.question(`${label}${suffix} (or ${CANCEL_TOKEN}): `);
      if (answer.trim().toLowerCase() === CANCEL_TOKEN) throw new Error('Create cancelled by user');
      const value = answer === '' ? fallback : answer;
      const candidate = { ...raw, [key]: value };
      try {
        resolveAppCreateInput(cwd, candidate);
        raw[key] = value;
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`Validation error: ${message}\n`);
      }
    }
  };
  try {
    if (!raw.appId) await ask({ key: 'appId', label: 'App ID', fallback: 'my-nimi-app' });
    if (!raw.title) await ask({ key: 'title', label: 'Display Name', fallback: 'My Nimi App' });
    if (!raw.packageName) await ask({ key: 'packageName', label: 'Package name', fallback: defaultPackageName(raw.appId) });
    if (!initial.providedOptions.includes('author')) await ask({ key: 'author', label: 'Author (person or team)', optional: true });
    if (raw.features === undefined) {
      process.stdout.write(`Available features: ${APP_SCAFFOLD_FEATURE_IDS.join(', ') || '(none)'}\n`);
      await ask({ key: 'features', label: 'Features (comma-separated, blank for base only)', optional: true });
    }
    return raw;
  } finally {
    prompt.close();
  }
}

function printCreatePreview(preview, json = false) {
  if (!json) process.stdout.write('[nimi-app] resolved create preview:\n');
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
}

async function confirmCreate(preview) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    printCreatePreview(preview);
    for (;;) {
      const answer = (await prompt.question('Create this App? [y/N]: ')).trim().toLowerCase();
      if (answer === CANCEL_TOKEN || answer === 'n' || answer === 'no' || answer === '') {
        throw new Error('Create cancelled by user');
      }
      if (answer === 'y' || answer === 'yes') return;
      process.stdout.write('Please answer yes or no.\n');
    }
  } finally {
    prompt.close();
  }
}

let parsedArgs = null;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
  const {
    command,
    dir,
    profile,
    appId,
    title,
    packageName,
    author,
    features: parsedFeatures,
    shell,
    cdpPort,
    noCdp,
    conformance,
    json,
    providedOptions,
  } = parsedArgs;
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }
  assertCommandOptions(command, providedOptions);
  if (command !== 'dev' && (cdpPort !== undefined || noCdp)) {
    throw new Error('--cdp-port and --no-cdp are available only for nimi-app dev');
  }
  if (command === 'dev' && cdpPort !== undefined && noCdp) {
    throw new Error('--cdp-port and --no-cdp cannot be combined');
  }
  switch (command) {
    case 'create':
      {
        const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
        const rawInput = {
          dir,
          profile,
          appId,
          title,
          packageName,
          author,
          features: parsedFeatures,
          providedOptions,
        };
        const collected = interactive
          ? await collectCreateInput(process.cwd(), rawInput)
          : rawInput;
        const plan = resolveAppCreatePlan(process.cwd(), collected);
        if (interactive) {
          await confirmCreate(plan.preview);
        } else if (!json) {
          printCreatePreview(plan.preview);
        }
        const result = createApp(process.cwd(), {
          ...collected,
          plan,
          silent: json,
        });
        if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      }
      break;
    case 'init':
      initAppScaffold(process.cwd(), {
        dir,
        json,
      });
      break;
    case 'doctor':
      await doctorAppScaffold(process.cwd(), {
        dir,
        conformance,
        json,
      });
      break;
    case 'update':
      updateAppScaffold(process.cwd(), {
        dir,
        json,
      });
      break;
    case 'dev':
      await runDevShell(process.cwd(), {
        dir,
        shell: shell || 'electron',
        cdpPort,
        noCdp,
      });
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[nimi-app] failed: ${message}\n`);
  process.exit(1);
}
