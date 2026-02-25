#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const options = {
    tsconfig: 'tsconfig.build.json',
    outDir: 'dist',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--tsconfig') {
      const value = String(argv[index + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value after --tsconfig');
      }
      options.tsconfig = value;
      index += 1;
      continue;
    }
    if (token === '--out-dir') {
      const value = String(argv[index + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value after --out-dir');
      }
      options.outDir = value;
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/build-typescript-package.mjs [--tsconfig <path>] [--out-dir <path>]',
          '',
          'Defaults:',
          '  --tsconfig tsconfig.build.json',
          '  --out-dir dist',
          '',
        ].join('\n'),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function walkFiles(rootDir, output) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, output);
      continue;
    }
    if (entry.isFile()) {
      output.push(absolutePath);
    }
  }
}

function shouldRewriteSpecifier(specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return false;
  }
  if (path.extname(specifier)) {
    return false;
  }
  return true;
}

function appendPathSuffix(specifier, suffix) {
  if (suffix.startsWith('/')) {
    return `${specifier}${suffix}`;
  }
  if (specifier.endsWith('/')) {
    return `${specifier}${suffix}`;
  }
  return `${specifier}${suffix}`;
}

function resolveRuntimeSpecifier(filePath, specifier) {
  if (!shouldRewriteSpecifier(specifier)) {
    return specifier;
  }

  const importerDir = path.dirname(filePath);
  const absoluteBase = path.resolve(importerDir, specifier);
  const fileCandidates = ['.js', '.mjs', '.cjs'];
  for (const extension of fileCandidates) {
    if (fs.existsSync(`${absoluteBase}${extension}`)) {
      return appendPathSuffix(specifier, extension);
    }
  }

  const indexCandidates = ['/index.js', '/index.mjs', '/index.cjs'];
  for (const suffix of indexCandidates) {
    if (fs.existsSync(`${absoluteBase}${suffix}`)) {
      return appendPathSuffix(specifier, suffix);
    }
  }

  return specifier;
}

function rewriteImportSpecifiers(filePath, content) {
  let changed = false;
  const patterns = [
    /(\bfrom\s*['"])([^'"]+)(['"])/g,
    /(\bimport\s*['"])([^'"]+)(['"])/g,
    /(\bimport\(\s*['"])([^'"]+)(['"]\s*\))/g,
  ];

  let output = content;
  for (const pattern of patterns) {
    output = output.replace(pattern, (full, prefix, specifier, suffix) => {
      const resolved = resolveRuntimeSpecifier(filePath, specifier);
      if (resolved === specifier) {
        return full;
      }
      changed = true;
      return `${prefix}${resolved}${suffix}`;
    });
  }

  return {
    changed,
    output,
  };
}

function rewriteDistImports(outDirAbsolute) {
  if (!fs.existsSync(outDirAbsolute)) {
    throw new Error(`build output directory does not exist: ${outDirAbsolute}`);
  }

  const files = [];
  walkFiles(outDirAbsolute, files);
  const targetExtensions = new Set(['.js', '.mjs', '.cjs', '.d.ts', '.d.mts', '.d.cts']);
  let rewritten = 0;

  for (const filePath of files) {
    const normalized = filePath.replace(/\\/g, '/');
    const extension = normalized.endsWith('.d.ts')
      ? '.d.ts'
      : normalized.endsWith('.d.mts')
        ? '.d.mts'
        : normalized.endsWith('.d.cts')
          ? '.d.cts'
          : path.extname(filePath);
    if (!targetExtensions.has(extension)) {
      continue;
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const { changed, output } = rewriteImportSpecifiers(filePath, source);
    if (!changed) {
      continue;
    }
    fs.writeFileSync(filePath, output);
    rewritten += 1;
  }

  return rewritten;
}

function runTsc(cwd, tsconfigPath) {
  const result = spawnSync('pnpm', ['exec', 'tsc', '-p', tsconfigPath], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`tsc failed for ${tsconfigPath}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageRoot = process.cwd();
  const tsconfigAbsolute = path.resolve(packageRoot, options.tsconfig);
  const outDirAbsolute = path.resolve(packageRoot, options.outDir);

  if (!fs.existsSync(tsconfigAbsolute)) {
    throw new Error(`tsconfig not found: ${tsconfigAbsolute}`);
  }

  fs.rmSync(outDirAbsolute, { recursive: true, force: true });
  runTsc(packageRoot, tsconfigAbsolute);
  const rewritten = rewriteDistImports(outDirAbsolute);

  process.stdout.write(
    `[build-typescript-package] built ${path.relative(packageRoot, outDirAbsolute)} (rewrote ${rewritten} file(s))\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[build-typescript-package] failed: ${message}\n`);
  process.exit(1);
}
