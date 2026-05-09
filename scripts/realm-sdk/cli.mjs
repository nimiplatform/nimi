import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SPEC_MANIFEST_RELATIVE_PATH } from './constants.mjs';

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
      '  -i, --input <path>  OpenAPI yaml path (default: config/realm-openapi-source.json source_path).',
      '  --skip-clean        Skip cleanup before code generation.',
      '  --skip-version-bump Skip automatic patch bump for @nimiplatform/sdk.',
      '  --set-version <v>   Set @nimiplatform/sdk package version explicitly.',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function isCacheOpenApiPath(repoRoot, candidatePath) {
  const relativePath = path.relative(repoRoot, candidatePath).split(path.sep).join('/');
  return relativePath === '.cache/realm-openapi/api-nimi.yaml'
    || relativePath.startsWith('.cache/realm-openapi/');
}

function resolveManifestInputPath(repoRoot) {
  const manifestPath = path.join(repoRoot, DEFAULT_SPEC_MANIFEST_RELATIVE_PATH);
  if (!existsSync(manifestPath)) {
    throw new Error(`Realm OpenAPI source manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.contract !== 'nimi.realm-openapi-source.v1') {
    throw new Error(`Invalid Realm OpenAPI source manifest contract: ${manifestPath}`);
  }
  if (manifest.source_kind !== 'backend_filtered_openapi_contract') {
    throw new Error(`Invalid Realm OpenAPI source kind in manifest: ${manifestPath}`);
  }
  if (!manifest.source_path || typeof manifest.source_path !== 'string') {
    throw new Error(`Realm OpenAPI source manifest missing source_path: ${manifestPath}`);
  }
  if (manifest.source_path.includes('<') || manifest.source_path.includes('PLACEHOLDER')) {
    throw new Error(`Realm OpenAPI source manifest has placeholder source_path: ${manifestPath}`);
  }
  if (!Array.isArray(manifest.authority_refs) || manifest.authority_refs.length === 0) {
    throw new Error(`Realm OpenAPI source manifest missing authority_refs: ${manifestPath}`);
  }
  for (const authorityRef of manifest.authority_refs) {
    if (
      typeof authorityRef !== 'string'
      || !authorityRef.startsWith('.nimi/spec/')
      || authorityRef.includes('<')
      || !existsSync(path.join(repoRoot, authorityRef))
    ) {
      throw new Error(`Realm OpenAPI source manifest has invalid authority ref: ${authorityRef}`);
    }
  }

  return path.isAbsolute(manifest.source_path)
    ? manifest.source_path
    : path.resolve(repoRoot, manifest.source_path);
}

export function resolveInputPath(repoRoot, inputFromArgs) {
  const rawInput = inputFromArgs || '';
  const resolvedInput = rawInput
    ? (path.isAbsolute(rawInput) ? rawInput : path.resolve(repoRoot, rawInput))
    : resolveManifestInputPath(repoRoot);
  if (isCacheOpenApiPath(repoRoot, resolvedInput)) {
    throw new Error('Refusing to use .cache/realm-openapi as Realm OpenAPI source truth; use the admitted source manifest or an explicit canonical source path');
  }
  return resolvedInput;
}
