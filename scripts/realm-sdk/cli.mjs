import path from 'node:path';
import { DEFAULT_SPEC_RELATIVE_PATH } from './constants.mjs';

export function parseArgs(argv) {
  const options = {
    input: '',
    skipClean: false,
    skipVersionBump: false,
    setVersion: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || arg === '--') {
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--skip-clean') {
      options.skipClean = true;
      continue;
    }
    if (arg === '--skip-version-bump') {
      options.skipVersionBump = true;
      continue;
    }
    if (arg === '--set-version') {
      const value = String(argv[i + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value after --set-version');
      }
      options.setVersion = value;
      i += 1;
      continue;
    }
    if (arg === '--input' || arg === '-i') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--input requires a value');
      }
      options.input = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function printHelp() {
  process.stdout.write(
    [
      'Usage:',
      '  pnpm generate:realm-sdk [options]',
      '',
      'Options:',
      '  -i, --input <path>  OpenAPI yaml path (default: .cache/realm-openapi/api-nimi.yaml).',
      '  --skip-clean        Skip cleanup before code generation.',
      '  --skip-version-bump Skip automatic patch bump for @nimiplatform/sdk.',
      '  --set-version <v>   Set @nimiplatform/sdk package version explicitly.',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

export function resolveInputPath(repoRoot, inputFromArgs) {
  const rawInput = inputFromArgs || DEFAULT_SPEC_RELATIVE_PATH;
  return path.isAbsolute(rawInput) ? rawInput : path.join(repoRoot, rawInput);
}
