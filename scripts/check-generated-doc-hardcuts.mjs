#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const targetRoots = [
  'scripts/lib',
];

const retiredNarrativePatterns = [
  {
    id: 'external-agent-tier1-actions',
    re: /tier-1 actions registered|registers tier-1 actions/giu,
  },
  {
    id: 'desktop-action-bridge',
    re: /启动 action bridge|starts an action bridge|action bridge/giu,
  },
  {
    id: 'desktop-action-descriptor-sync',
    re: /action descriptor 同步|agent token 管理和 action descriptor/giu,
  },
  {
    id: 'local-ai-ipc-command-authority',
    re: /Local AI 命令|模型列表、安装、生命周期管理和审计/giu,
  },
  {
    id: 'external-agent-token-gateway-supported',
    re: /token 支持签发、撤销、列表和网关监控/giu,
  },
];

const sourceExtensions = new Set(['.mjs', '.js', '.ts', '.tsx', '.md']);

function rel(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function locationFor(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const column = index - prefix.lastIndexOf('\n');
  return { line, column };
}

async function collectFiles(target) {
  const absolute = path.join(repoRoot, target);
  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (stat.isFile()) {
    return sourceExtensions.has(path.extname(absolute)) ? [absolute] : [];
  }
  if (!stat.isDirectory()) return [];
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'archive') {
      continue;
    }
    const child = path.join(target, entry.name);
    files.push(...await collectFiles(child));
  }
  return files;
}

const files = (await Promise.all(targetRoots.map(collectFiles))).flat();
const failures = [];

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  for (const pattern of retiredNarrativePatterns) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(source)) !== null) {
      const { line, column } = locationFor(source, match.index);
      failures.push(`${rel(file)}:${line}:${column} ${pattern.id} matched ${JSON.stringify(match[0])}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Generated-doc hardcut guard failed: retired Desktop action bridge / Local AI IPC narrative is still active.');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Generated-doc hardcut guard passed (${files.length} files).`);
