#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const OPENAPI_TYPESCRIPT_CODEGEN_VERSION = '0.30.0';
const DEFAULT_SPEC_RELATIVE_PATH = path.join('.cache', 'realm-openapi', 'api-nimi.yaml');
const REALM_SRC_RELATIVE_PATH = path.join('sdk', 'packages', 'realm', 'src');
const REALM_PACKAGE_JSON_RELATIVE_PATH = path.join('sdk', 'packages', 'realm', 'package.json');
const CLEAN_TARGETS = ['core', 'models', 'services', 'schemas', 'index.ts'];

function parseArgs(argv) {
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

function printHelp() {
  process.stdout.write(
    [
      'Usage:',
      '  pnpm generate:realm-sdk [options]',
      '',
      'Options:',
      '  -i, --input <path>  OpenAPI yaml path (default: .cache/realm-openapi/api-nimi.yaml).',
      '  --skip-clean        Skip cleanup before code generation.',
      '  --skip-version-bump Skip automatic patch bump for @nimiplatform/sdk-realm.',
      '  --set-version <v>   Set @nimiplatform/sdk-realm package version explicitly.',
    ].join('\n'),
  );
  process.stdout.write('\n');
}

function runCommand(repoRoot, label, args) {
  const command = ['pnpm', ...args].join(' ');
  process.stdout.write(`\n[generate:realm-sdk] ${label}\n$ ${command}\n`);
  const result = spawnSync('pnpm', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    const status = result.status ?? -1;
    throw new Error(`${label} failed (exit code ${status})`);
  }
}

function hasLocalOpenApiBinary(repoRoot) {
  const result = spawnSync('pnpm', ['exec', 'openapi', '--version'], {
    cwd: repoRoot,
    stdio: 'pipe',
    env: process.env,
    encoding: 'utf8',
  });
  return result.status === 0;
}

function resolveInputPath(repoRoot, inputFromArgs) {
  const rawInput = inputFromArgs || DEFAULT_SPEC_RELATIVE_PATH;
  return path.isAbsolute(rawInput) ? rawInput : path.join(repoRoot, rawInput);
}

function cleanRealmSources(repoRoot) {
  const realmSrcPath = path.join(repoRoot, REALM_SRC_RELATIVE_PATH);
  if (!existsSync(realmSrcPath)) {
    throw new Error(`Realm SDK source directory not found: ${realmSrcPath}`);
  }
  for (const target of CLEAN_TARGETS) {
    rmSync(path.join(realmSrcPath, target), { recursive: true, force: true });
  }
}

function semverMatch(version) {
  return /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
}

function bumpPatch(version) {
  const matched = semverMatch(version);
  if (!matched) {
    throw new Error(
      `Unsupported version format: ${version}. Expected semver like 0.1.0 or 0.1.0-beta.1`,
    );
  }
  const major = Number.parseInt(matched[1], 10);
  const minor = Number.parseInt(matched[2], 10);
  const patch = Number.parseInt(matched[3], 10) + 1;
  return `${major}.${minor}.${patch}`;
}

function readRealmPackageJson(repoRoot) {
  const packagePath = path.join(repoRoot, REALM_PACKAGE_JSON_RELATIVE_PATH);
  const content = readFileSync(packagePath, 'utf8');
  return {
    packagePath,
    parsed: JSON.parse(content),
  };
}

function writeRealmPackageJson(packagePath, parsed) {
  writeFileSync(packagePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

function ensureValidSemver(version) {
  if (!semverMatch(version)) {
    throw new Error(
      `Invalid --set-version value: ${version}. Expected semver like 0.1.1 or 0.1.1-beta.1`,
    );
  }
}

function listFilesRecursively(rootDir) {
  if (!existsSync(rootDir)) {
    return [];
  }

  const output = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        output.push(entryPath);
      }
    }
  }

  output.sort((left, right) => left.localeCompare(right));
  return output;
}

function computeDirectoryHash(rootDir) {
  if (!existsSync(rootDir)) {
    return 'MISSING';
  }
  if (!statSync(rootDir).isDirectory()) {
    throw new Error(`Path is not a directory: ${rootDir}`);
  }

  const hasher = createHash('sha256');
  const files = listFilesRecursively(rootDir);

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const content = readFileSync(filePath);
    hasher.update(relativePath);
    hasher.update('\0');
    hasher.update(content);
    hasher.update('\0');
  }

  return hasher.digest('hex');
}

function maybeUpdateRealmVersion(repoRoot, options, generatedChanged) {
  const { packagePath, parsed } = readRealmPackageJson(repoRoot);
  const currentVersion = String(parsed.version || '').trim();
  if (!currentVersion) {
    throw new Error(`${REALM_PACKAGE_JSON_RELATIVE_PATH} is missing version field`);
  }

  if (options.setVersion) {
    ensureValidSemver(options.setVersion);
    if (options.setVersion !== currentVersion) {
      parsed.version = options.setVersion;
      writeRealmPackageJson(packagePath, parsed);
      process.stdout.write(
        `[generate:realm-sdk] set @nimiplatform/sdk-realm version: ${currentVersion} -> ${options.setVersion}\n`,
      );
    } else {
      process.stdout.write(
        `[generate:realm-sdk] @nimiplatform/sdk-realm version unchanged: ${currentVersion}\n`,
      );
    }
    return;
  }

  if (options.skipVersionBump) {
    process.stdout.write('[generate:realm-sdk] skip version bump by --skip-version-bump\n');
    return;
  }

  if (!generatedChanged) {
    process.stdout.write('[generate:realm-sdk] generated SDK unchanged, skip version bump\n');
    return;
  }

  const nextVersion = bumpPatch(currentVersion);
  parsed.version = nextVersion;
  writeRealmPackageJson(packagePath, parsed);
  process.stdout.write(
    `[generate:realm-sdk] bumped @nimiplatform/sdk-realm version: ${currentVersion} -> ${nextVersion}\n`,
  );
}

function runCodegen(repoRoot, inputPath) {
  const outputPath = path.join(repoRoot, REALM_SRC_RELATIVE_PATH);

  if (hasLocalOpenApiBinary(repoRoot)) {
    runCommand(repoRoot, 'OpenAPI codegen (local openapi binary)', [
      'exec',
      'openapi',
      '--input',
      inputPath,
      '--output',
      outputPath,
      '--client',
      'fetch',
    ]);
    return;
  }

  runCommand(repoRoot, 'OpenAPI codegen (pnpm dlx fallback)', [
    'dlx',
    `openapi-typescript-codegen@${OPENAPI_TYPESCRIPT_CODEGEN_VERSION}`,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--client',
    'fetch',
  ]);
}

function collectServiceFiles(servicesDir) {
  if (!existsSync(servicesDir) || !statSync(servicesDir).isDirectory()) {
    throw new Error(`Generated services directory not found: ${servicesDir}`);
  }
  return readdirSync(servicesDir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => path.join(servicesDir, entry))
    .sort((left, right) => left.localeCompare(right));
}

function parseMethodSignatureParamNames(signatureSource) {
  return Array.from(signatureSource.matchAll(/(?:^|,)\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)).map(
    (match) => match[1],
  );
}

function parsePathObjectKeys(pathObjectSource) {
  return Array.from(pathObjectSource.matchAll(/['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:/g)).map(
    (match) => match[1],
  );
}

function validateGeneratedServices(repoRoot) {
  const servicesDir = path.join(repoRoot, REALM_SRC_RELATIVE_PATH, 'services');
  const serviceFiles = collectServiceFiles(servicesDir);
  const violations = [];
  const adminLeaks = [];

  for (const filePath of serviceFiles) {
    const fileName = path.basename(filePath);
    const content = readFileSync(filePath, 'utf8');

    if (/url:\s*['"]\/api\/admin(?:\/|['"])/i.test(content) || /^export class Admin\w+/m.test(content)) {
      adminLeaks.push(fileName);
    }

    const methodRegex =
      /public\s+static\s+([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*?)\):\s*CancelablePromise<[\s\S]*?>\s*\{\s*return\s+__request\(OpenAPI,\s*\{([\s\S]*?)\}\);\s*\}/g;
    for (const match of content.matchAll(methodRegex)) {
      const methodName = match[1];
      const signatureSource = match[2];
      const requestOptionsSource = match[3];
      const url = requestOptionsSource.match(/url:\s*['"]([^'"]+)['"]/)?.[1] || '';
      const placeholders = Array.from(url.matchAll(/\{([^}]+)\}/g)).map((item) => item[1]);
      if (placeholders.length === 0) {
        continue;
      }

      const pathObjectSource =
        requestOptionsSource.match(/path:\s*\{([\s\S]*?)\}\s*(?:,|$)/)?.[1] || '';
      if (!pathObjectSource) {
        violations.push(`${fileName}#${methodName}: url has placeholders but request.path is missing`);
        continue;
      }

      const pathKeys = parsePathObjectKeys(pathObjectSource);
      const missingPathBindings = placeholders.filter((placeholder) => !pathKeys.includes(placeholder));
      if (missingPathBindings.length > 0) {
        violations.push(
          `${fileName}#${methodName}: missing request.path bindings for ${missingPathBindings.join(', ')}`,
        );
      }

      const signatureParamNames = parseMethodSignatureParamNames(signatureSource);
      const missingSignatureArgs = pathKeys.filter((key) => !signatureParamNames.includes(key));
      if (missingSignatureArgs.length > 0) {
        violations.push(
          `${fileName}#${methodName}: missing method args for path params ${missingSignatureArgs.join(', ')}`,
        );
      }
    }
  }

  if (adminLeaks.length > 0) {
    throw new Error(
      `Generated realm SDK still contains admin endpoints/classes:\n${adminLeaks
        .map((item) => `- ${item}`)
        .join('\n')}`,
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `Generated realm SDK services have invalid path parameter bindings:\n${violations
        .map((item) => `- ${item}`)
        .join('\n')}`,
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDir, '..');
  const inputPath = resolveInputPath(repoRoot, options.input);
  const realmSrcPath = path.join(repoRoot, REALM_SRC_RELATIVE_PATH);

  if (!existsSync(inputPath)) {
    throw new Error(`OpenAPI spec not found: ${inputPath}`);
  }

  const beforeHash = computeDirectoryHash(realmSrcPath);

  if (!options.skipClean) {
    process.stdout.write('[generate:realm-sdk] Cleaning current generated realm SDK sources\n');
    cleanRealmSources(repoRoot);
  }

  runCodegen(repoRoot, inputPath);
  validateGeneratedServices(repoRoot);
  const afterHash = computeDirectoryHash(realmSrcPath);
  const generatedChanged = beforeHash !== afterHash;
  process.stdout.write(`[generate:realm-sdk] generated changed: ${generatedChanged}\n`);
  maybeUpdateRealmVersion(repoRoot, options, generatedChanged);
  process.stdout.write('\n[generate:realm-sdk] Completed successfully.\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[generate:realm-sdk] Failed: ${message}\n`);
  process.exit(1);
}
