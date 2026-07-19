#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = Buffer.concat([result.stdout, result.stderr]).toString('utf8').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const privateRealmRepo = ['nimi', 'realm'].join('-');
const privateBackendRepo = ['nimi', 'backend'].join('-');
const privateBackendLocator = ['realm', 'backend'].join('-') + '://';
const parentRealmLocator = 'parent://' + privateRealmRepo;
const homeRealmPath = '~/' + privateRealmRepo;
const parentBackendPath = '../' + privateBackendRepo;
const semanticSourceAuthority = ['Realm', 'source', 'authority'].join(' ');
const sourceAuthorityWorkspace = ['source', 'authority', 'workspace'].join(' ');
const parentRepo = ['parent', 'repo'].join(' ');
const parentRootSync = ['parent', 'root', 'sync'].join(' ');
const parentWorkspaceRoot = ['parent', 'workspace', 'root'].join(' ');
const nestedCheckoutLayout = ['nested', 'checkout', 'layout'].join(' ');
const sourceRootEnv = ['NIMI', 'REALM', 'SOURCE', 'ROOT'].join('_');
const realmSourceLocator = ['realm', 'source'].join('-') + '://';
const realmSourceCheckLocator = ['realm', 'source', 'check'].join('-') + '://';
const syncNimiOpenSpec = ['sync', 'nimi', 'open', 'spec'].join('-') + '.ts';
const sourceRootNimiProjection = ['sourceRoot', "'nimi'", "REALM_SPEC_ROOT"].join(', ');

const forbidden = [
  privateRealmRepo,
  privateBackendRepo,
  privateBackendLocator,
  parentRealmLocator,
  homeRealmPath,
  parentBackendPath,
  semanticSourceAuthority,
  sourceAuthorityWorkspace,
  parentRepo,
  parentRootSync,
  parentWorkspaceRoot,
  nestedCheckoutLayout,
  sourceRootEnv,
  realmSourceLocator,
  realmSourceCheckLocator,
  syncNimiOpenSpec,
  sourceRootNimiProjection,
].map((value) => ({ value, pattern: new RegExp(escapeRegExp(value), 'u') }));

const ignoredPrefixes = [
  'archive/',
  '_external/',
  'node_modules/',
];

const tracked = runGit(['ls-files', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
  .filter((filePath) => fs.existsSync(filePath))
  .filter((filePath) => !ignoredPrefixes.some((prefix) => filePath.startsWith(prefix)));

const findings = [];
for (const filePath of tracked) {
  const content = fs.readFileSync(filePath);
  if (content.includes(0)) continue;
  const text = content.toString('utf8');
  for (const { value, pattern } of forbidden) {
    const lines = text.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index])) {
        findings.push(`${filePath}:${index + 1}: forbidden private topology reference ${value}`);
      }
    }
  }
}

if (findings.length > 0) {
  process.stderr.write([
    'Private repository topology references are forbidden in the public Nimi repository.',
    'Keep Realm spec projections, but do not expose private repo names, topology guesses, or backend locators.',
    ...findings,
    '',
  ].join('\n'));
  process.exit(1);
}

process.stdout.write('private repo topology guard passed\n');
