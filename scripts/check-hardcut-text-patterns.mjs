#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CHECKS = {
  'no-openapi-base-assignment': {
    pattern: /OpenAPI\.BASE\s*=/,
    paths: ['sdks/typescript', 'apps', 'examples', 'scripts'],
    includeExtensions: new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']),
    message: 'OpenAPI.BASE assignment is forbidden; use Realm instance config',
  },
  'no-openapi-token-assignment': {
    pattern: /OpenAPI\.TOKEN\s*=/,
    paths: ['sdks/typescript', 'apps', 'examples', 'scripts'],
    includeExtensions: new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']),
    message: 'OpenAPI.TOKEN assignment is forbidden; use Realm instance config',
  },
  'no-openapi-singleton-import': {
    pattern: /import\s*\{[^}]*\bOpenAPI\b[^}]*\}\s*from\s*['"]@nimiplatform\/sdk\/realm['"]/,
    paths: ['sdks/typescript', 'apps', 'examples', 'scripts'],
    includeExtensions: new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']),
    message: 'OpenAPI singleton import from @nimiplatform/sdk/realm is forbidden; use Realm instance',
  },
  'no-nimid-doc-invocation': {
    pattern: /go run \.\/cmd\/nimid/,
    paths: ['docs', 'README.md', 'runtime/README.md'],
    message: 'legacy daemon invocation go run ./cmd/nimid is forbidden in docs; use go run ./cmd/nimi serve',
  },
  'no-nimid-source': {
    pattern: /cmd\/nimid|\bnimid\b/,
    paths: ['runtime', 'sdks', 'README.md', 'CHANGELOG.md'],
    excludeLinePatterns: [
      /check:no-nimid-source/,
      /check:no-nimid-doc-invocation/,
    ],
    message: 'legacy nimid entry/symbol is forbidden; use go run ./cmd/nimi serve',
  },
  'desktop-no-client-alias': {
    pattern: /@client(?:\/|$)/,
    paths: ['apps/desktop'],
    message: 'desktop private alias @client is forbidden',
  },
  'no-legacy-app-auth-cli': {
    pattern: /nimi grant|`grant \*`|\|grant\||case "grant"|grant failed/,
    paths: ['runtime', 'docs', 'runtime/README.md'],
    excludePathPatterns: [/runtime[\\/]cmd[\\/]nimi[\\/]usage_text_test\.go$/],
    excludeLinePatterns: [/check:no-legacy-app-auth-cli/],
    message: 'legacy CLI command grant is forbidden; use app-auth',
  },
};

const checkName = process.argv[2];
const check = CHECKS[checkName];
if (!check) {
  console.error(`unknown hardcut text pattern check: ${checkName ?? '(missing)'}`);
  console.error(`available checks: ${Object.keys(CHECKS).sort().join(', ')}`);
  process.exit(2);
}

const matches = [];
for (const target of check.paths) {
  collectMatches(path.resolve(repoRoot, target), check, matches);
}

if (matches.length > 0) {
  console.error(check.message);
  for (const match of matches) {
    console.error(`${path.relative(repoRoot, match.file)}:${match.lineNumber}:${match.line}`);
  }
  process.exit(1);
}

console.log(`${checkName} passed`);

function collectMatches(targetPath, check, matches) {
  if (!fs.existsSync(targetPath)) return;
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
      if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
      collectMatches(path.join(targetPath, entry.name), check, matches);
    }
    return;
  }
  if (!stat.isFile()) return;
  if (shouldSkipFile(targetPath, check)) return;

  let raw;
  try {
    raw = fs.readFileSync(targetPath, 'utf8');
  } catch {
    return;
  }

  const lines = raw.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!check.pattern.test(line)) continue;
    if ((check.excludeLinePatterns ?? []).some((pattern) => pattern.test(line))) continue;
    matches.push({
      file: targetPath,
      lineNumber: index + 1,
      line: line.trim(),
    });
  }
}

function shouldSkipDirectory(name) {
  return new Set([
    '.cache',
    '.git',
    '.next',
    'dist',
    'gen',
    'generated',
    'node_modules',
    'target',
  ]).has(name);
}

function shouldSkipFile(filePath, check) {
  const relativePath = path.relative(repoRoot, filePath);
  if ((check.excludePathPatterns ?? []).some((pattern) => pattern.test(relativePath))) {
    return true;
  }
  if (check.includeExtensions && !check.includeExtensions.has(path.extname(filePath))) {
    return true;
  }
  return false;
}
