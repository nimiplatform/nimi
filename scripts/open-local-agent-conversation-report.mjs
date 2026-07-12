#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { repoRoot } from '../tests/local-agent-product/harness/registry.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

const indexPath = path.join(repoRoot, '.nimi', 'local', 'reports', 'local-agent-conversation', 'latest.json');
const explicit = option('--report-root');
if (!explicit && !fs.existsSync(indexPath)) throw new Error('no LocalAgent conversation report index exists');
const bundleRoot = path.resolve(explicit || JSON.parse(fs.readFileSync(indexPath, 'utf8')).bundleRoot);
const reportHtml = path.join(bundleRoot, 'report.html');
if (!fs.existsSync(reportHtml)) throw new Error(`report.html does not exist under ${bundleRoot}`);
const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
const args = process.platform === 'win32' ? ['/c', 'start', '', reportHtml] : [reportHtml];
const opened = spawnSync(command, args, { stdio: 'inherit' });
if (opened.error) throw opened.error;
if (opened.status !== 0) process.exit(opened.status ?? 1);
process.stdout.write(`${reportHtml}\n`);
