#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const examplesDir = resolve(repoRoot, 'examples/sdk');
const files = readdirSync(examplesDir)
  .filter((entry) => entry.endsWith('.ts'))
  .sort();

const failures = [];
let validated = 0;

for (const fileName of files) {
  const filePath = resolve(examplesDir, fileName);
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(/Run:\s*npx tsx\s+([^\s*]+)/);

  if (!match) {
    failures.push(`${fileName}: missing 'Run: npx tsx ...' comment`);
    continue;
  }

  const commandPath = match[1];
  const absoluteCommandPath = resolve(repoRoot, commandPath);

  if (!commandPath.startsWith('examples/sdk/')) {
    failures.push(`${fileName}: run path must start with examples/sdk/ (found ${commandPath})`);
    continue;
  }

  if (!existsSync(absoluteCommandPath)) {
    failures.push(`${fileName}: run path does not exist (${commandPath})`);
    continue;
  }

  validated += 1;
}

if (failures.length > 0) {
  process.stderr.write('check-example-run-comments failed:\n');
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`check-example-run-comments passed: validated ${validated} files.\n`);
}
