#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const avatarRoot = path.join(repoRoot, '.nimi', 'spec', 'avatar');
const kernelRoot = path.join(avatarRoot, 'kernel');
const outDir = path.join(kernelRoot, 'generated');
const checkMode = process.argv.includes('--check');

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  if (checkMode) {
    const entries = await fs.readdir(outDir);
    const generatedMarkdown = entries.filter((entry) => entry.endsWith('.md'));
    if (generatedMarkdown.length > 0) {
      process.stderr.write(`avatar kernel generated docs drift detected: unexpected files ${generatedMarkdown.join(', ')}\n`);
      process.exit(1);
    }
    process.stdout.write('avatar kernel generated docs are up-to-date (0 files)\n');
    return;
  }

  for (const entry of await fs.readdir(outDir)) {
    if (entry.endsWith('.md')) {
      await fs.unlink(path.join(outDir, entry));
    }
  }
  process.stdout.write('generated avatar kernel docs (0 files)\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
