#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const zhiyuRoot = path.join(repoRoot, '.nimi', 'spec', 'zhiyu');
const kernelRoot = path.join(zhiyuRoot, 'kernel');
const outDir = path.join(kernelRoot, 'generated');
const checkMode = process.argv.includes('--check');

async function main() {
  let entries = [];
  try {
    entries = await fs.readdir(outDir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const generatedMarkdown = entries.filter((entry) => entry.endsWith('.md'));
  if (generatedMarkdown.length > 0) {
    process.stderr.write(`zhiyu kernel derived views must not be written to disk: ${generatedMarkdown.join(', ')}\n`);
    process.exit(1);
  }

  if (checkMode) {
    process.stdout.write('zhiyu kernel derived views renderable (0 views, no files written)\n');
    return;
  }

  process.stdout.write('<!-- nimi-derived-view: stdout:zhiyu/kernel/index -->\n');
  process.stdout.write('# Zhiyu Derived Views\n\n_No derived markdown views are defined for zhiyu._\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
