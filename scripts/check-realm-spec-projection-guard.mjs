#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = process.cwd();
const REALM_SPEC_ROOT = path.join(REPO_ROOT, '.nimi', 'spec', 'realm');
const ALLOWED_FILES = new Set(['AGENTS.md', 'README.md', 'external-realm.md']);
const REQUIRED_POINTER_SNIPPETS = new Map([
  ['README.md', ['<nimi-realm>', '.nimi/spec/sdks/kernel/realm-api-consumer-contract.md']],
  ['external-realm.md', ['<nimi-realm>', 'Nimi must not define, fork, or mirror Realm server/domain authority']],
  ['AGENTS.md', ['This subtree is not Realm product authority', '<nimi-realm>']],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function rel(filePath) {
  return toPosix(path.relative(REPO_ROOT, filePath));
}

function listFilesRecursively(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const output = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFilesRecursively(absolutePath));
      continue;
    }
    if (entry.isFile()) output.push(absolutePath);
  }
  return output;
}

function main() {
  const issues = [];
  if (!fs.existsSync(REALM_SPEC_ROOT)) {
    issues.push(`${rel(REALM_SPEC_ROOT)} must exist as an external Realm pointer directory`);
  }

  const files = listFilesRecursively(REALM_SPEC_ROOT);
  const relativeFiles = files.map((filePath) => toPosix(path.relative(REALM_SPEC_ROOT, filePath))).sort();
  for (const filePath of relativeFiles) {
    if (!ALLOWED_FILES.has(filePath)) {
      issues.push(`${rel(path.join(REALM_SPEC_ROOT, filePath))} is forbidden; nested Realm authority mirrors are not admitted`);
    }
  }

  for (const filePath of ALLOWED_FILES) {
    const absolutePath = path.join(REALM_SPEC_ROOT, filePath);
    if (!fs.existsSync(absolutePath)) {
      issues.push(`${rel(absolutePath)} is required for the external Realm pointer`);
      continue;
    }
    const text = fs.readFileSync(absolutePath, 'utf8');
    for (const snippet of REQUIRED_POINTER_SNIPPETS.get(filePath) ?? []) {
      if (!text.includes(snippet)) {
        issues.push(`${rel(absolutePath)} must include pointer snippet: ${snippet}`);
      }
    }
  }

  if (issues.length > 0) {
    process.stderr.write(
      [
        'Realm spec projection guard failed.',
        '',
        'Nimi is a Realm API consumer and must not mirror Realm authority under .nimi/spec/realm/**.',
        '',
        ...issues.map((issue) => `- ${issue}`),
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  process.stdout.write('realm external pointer guard passed\n');
}

main();
