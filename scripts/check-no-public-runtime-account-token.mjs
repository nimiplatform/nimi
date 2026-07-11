#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const productRoots = [
  'proto/runtime/v1/account.proto',
  'runtime/gen/runtime/v1',
  'runtime/internal/services/account',
  'runtime/internal/grpcserver',
  'sdks/typescript/core-generated',
  'sdks/typescript/runtime',
  'sdks/go/coregenerated',
  'sdks/python/core_generated',
  'sdks/rust/core_generated',
  'kit',
  'apps',
];
const publicTokenPattern = /(?:\b(?:GetAccessToken|RefreshAccountSession)(?:Request|Response)?\b|\/nimi\.runtime\.v1\.RuntimeAccountService\/(?:GetAccessToken|RefreshAccountSession))/u;
const rawTokenProjectionPattern = /\b(?:createRealmWithRuntimeAccountToken|RuntimeAccountRealmRuntime|RuntimeAccountRealmFetch|getRuntimeAccountAccessToken|readRuntimeAccountAccessToken|installRuntimeNodeGrpcLocalFirstPartyAuthority|readRuntimeNodeGrpcLocalFirstPartyAuthority|NimiLocalFirstPartyAgentPresentationClient|createNimiLocalFirstPartyAgentPresentationClient)\b/u;
const retiredBearerProjectionPaths = [
  'sdks/typescript/runtime/local-first-party-agent-presentation.ts',
  'sdks/typescript/runtime/node-grpc-authority.ts',
];

function collectFiles(relative) {
  const absolute = path.join(repoRoot, relative);
  const entry = fs.statSync(absolute);
  if (entry.isFile()) return [absolute];
  const files = [];
  for (const child of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (child.name === 'node_modules' || child.name === 'target' || child.name === 'dist') continue;
    const childRelative = path.join(relative, child.name);
    if (child.isDirectory()) {
      files.push(...collectFiles(childRelative));
      continue;
    }
    if (
      child.isFile()
      && !child.name.includes('.test.')
      && /\.(?:go|proto|ts|tsx|js|mjs|rs|py)$/u.test(child.name)
    ) {
      files.push(path.join(repoRoot, childRelative));
    }
  }
  return files;
}

function violations() {
  const found = [];
  for (const relative of retiredBearerProjectionPaths) {
    if (fs.existsSync(path.join(repoRoot, relative))) {
      found.push(relative);
    }
  }
  for (const root of productRoots) {
    for (const absolute of collectFiles(root)) {
      const source = fs.readFileSync(absolute, 'utf8');
      if (!publicTokenPattern.test(source) && !rawTokenProjectionPattern.test(source)) continue;
      const relative = path.relative(repoRoot, absolute).replaceAll('\\', '/');
      found.push(relative);
    }
  }
  return [...new Set(found)].sort();
}

const found = violations();
if (found.length > 0) {
  process.stderr.write('public Runtime account-token surface remains:\n');
  for (const relative of found) process.stderr.write(`  - ${relative}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('no public Runtime account-token surface: OK\n');
}
