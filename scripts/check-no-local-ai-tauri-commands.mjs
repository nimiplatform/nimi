#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const desktopTauriSrc = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'src');

const RUST_EXTENSION = '.rs';
const SKIP_DIR_NAMES = new Set(['generated', 'gen', 'target']);

const COMMAND_PATTERNS = [
  {
    label: 'Rust Tauri command function',
    pattern: /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(local_ai_[a-z0-9_]+)\b/gu,
  },
  {
    label: 'Tauri command rename',
    pattern: /#\s*\[\s*tauri::command[^\]]*rename\s*=\s*["'](local_ai_[a-z0-9_]+)["'][^\]]*\]/gu,
  },
];

async function walk(dir) {
  const output = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) {
        continue;
      }
      output.push(...(await walk(fullPath)));
      continue;
    }
    if (entry.isFile() && path.extname(entry.name) === RUST_EXTENSION) {
      output.push(fullPath);
    }
  }
  return output;
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

function inspectGenerateHandlerBlocks(content) {
  const violations = [];
  const blockPattern = /generate_handler!\s*\[([\s\S]*?)\]/gu;
  for (const blockMatch of content.matchAll(blockPattern)) {
    const block = blockMatch[1] ?? '';
    const blockStart = (blockMatch.index ?? 0) + blockMatch[0].indexOf(block);
    for (const commandMatch of block.matchAll(/\b(local_ai_[a-z0-9_]+)\b/gu)) {
      const index = blockStart + (commandMatch.index ?? 0);
      violations.push({
        index,
        command: commandMatch[1],
        label: 'Tauri generate_handler command',
      });
    }
  }
  return violations;
}

async function main() {
  const files = await walk(desktopTauriSrc);
  const violations = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    for (const { label, pattern } of COMMAND_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const index = match.index ?? -1;
        if (index < 0) {
          continue;
        }
        violations.push({
          relPath,
          line: lineNumber(content, index),
          label,
          command: match[1],
        });
      }
    }
    for (const violation of inspectGenerateHandlerBlocks(content)) {
      violations.push({
        relPath,
        line: lineNumber(content, violation.index),
        label: violation.label,
        command: violation.command,
      });
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Desktop Tauri local_ai_* command symbols are forbidden; use runtime bridge APIs:\n');
    for (const violation of violations) {
      process.stderr.write(
        `  - ${violation.relPath}:${violation.line}: ${violation.label}: ${violation.command}\n`,
      );
    }
    process.exit(1);
  }

  process.stdout.write(`check:no-local-ai-tauri-commands: no local_ai_* Tauri command symbols found (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check:no-local-ai-tauri-commands failed: ${String(error)}\n`);
  process.exit(1);
});
