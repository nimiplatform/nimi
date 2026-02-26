#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ssotRoot = path.join(repoRoot, 'ssot');

const SKIP_RELATIVE = new Set(['_meta/template.md']);

const FORBIDDEN_PATTERNS = [
  {
    re: /^\s*[-*]\s+\[x\]\s+/i,
    reason: 'checked progress marker in SSOT (`- [x]`)',
  },
  {
    re: /当前状态快照|Gate\s*状态快照/i,
    reason: 'dated status snapshot belongs in dev/report',
  },
  {
    re: /本轮报告/,
    reason: 'round-specific report marker belongs in dev/report',
  },
  {
    re: /计划完成日期|实际完成日期|阻塞原因|下轮承接/,
    reason: 'iteration completion ledger belongs in dev/plan or dev/report',
  },
  {
    re: /^\s*\|\s*Iteration\s*\|/i,
    reason: 'iteration status table belongs in dev/plan or dev/report',
  },
];

function isMarkdownFile(name) {
  return name.endsWith('.md');
}

async function listMarkdownFiles(dir, baseDir = dir) {
  const output = [];
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listMarkdownFiles(fullPath, baseDir)));
      continue;
    }
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      output.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
    }
  }
  return output;
}

function linePreview(line) {
  const compact = line.trim().replace(/\s+/g, ' ');
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 117)}...`;
}

async function main() {
  const violations = [];
  const files = await listMarkdownFiles(ssotRoot);

  for (const relPath of files) {
    if (SKIP_RELATIVE.has(relPath)) continue;
    const absPath = path.join(ssotRoot, relPath);
    const content = await fs.readFile(absPath, 'utf8');
    const lines = content.split(/\r?\n/);

    let inCodeFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        inCodeFence = !inCodeFence;
        continue;
      }
      if (inCodeFence) continue;

      for (const rule of FORBIDDEN_PATTERNS) {
        if (!rule.re.test(line)) continue;
        violations.push(`${relPath}:${i + 1}: ${rule.reason} -> ${linePreview(line)}`);
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SSOT boundary check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`SSOT boundary check passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-ssot-boundary failed: ${String(error)}\n`);
  process.exitCode = 1;
});
