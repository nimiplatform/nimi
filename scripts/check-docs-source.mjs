#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkDocsSources, selectDocsReview } from './lib/docs-source.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length && (args.length !== 2 || args[0] !== '--changed-from' || !/^[a-f0-9]{40}$/u.test(args[1]))) throw new Error('usage: check-docs-source.mjs [--changed-from <40-character commit SHA>]');
  const result = checkDocsSources(root);
  if (result.errors.length) throw new Error(result.errors.join('\n'));
  console.log(`Docs sources: ${result.pages} pages, ${result.mappedPages} mapped pages; references valid.`);
  if (args.length) {
    const changed = execFileSync('git', ['diff', '--name-only', '-z', args[1]], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const candidates = selectDocsReview(root, changed);
    console.log(`Documentation review candidates (${candidates.length}; selection is not semantic verification):\n${candidates.join('\n')}`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
