#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const specRoot = path.join(repoRoot, '.nimi', 'spec');

const SCAN_EXTENSIONS = new Set(['.md', '.yaml', '.yml']);
const SKIP_DIR_NAMES = new Set(['generated', 'gen']);

const BANNED_PATTERNS = [
  {
    label: 'topic lifecycle path inside active spec',
    pattern: /\.nimi\/topics\/(?:closed|ongoing|pending|proposal)\//u,
  },
  {
    label: 'wave-numbered implementation/admission language',
    pattern: /\b(?:Wave|wave)[\s_-]*[0-9]+/u,
  },
  {
    label: 'topic source provenance',
    pattern: /\bSource:\s*topic\b/u,
  },
  {
    label: 'topic-local evidence wording',
    pattern: /\btopic-local\b/u,
  },
  {
    label: 'topic preflight/process wording',
    pattern: /\b(?:current topic|topic preflight|topic-internal|candidate-wave-plan|candidate wave plan)\b/u,
  },
  {
    label: 'child-topic evidence wording',
    pattern: /\bchild topic\b/u,
  },
  {
    label: 'closed-topic evidence wording',
    pattern: /\bclosed[- ]topic\b/u,
  },
  {
    label: 'self-referential topic authority wording',
    pattern: /\bthis topic\b|\b本 topic\b/u,
  },
  {
    label: 'downstream topic reference field',
    pattern: /\bdownstream_topic_ref\b/u,
  },
  {
    label: 'process wave lifecycle wording',
    pattern: /\b(?:cleanup|implementation|future|later|acceptance|remediation|proof)\s+waves?\b/u,
  },
  {
    label: 'implementation evidence scheduling wording',
    pattern: /\bevidence\s+lands\s+with\b/u,
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
    if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      output.push(fullPath);
    }
  }
  return output;
}

function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

async function main() {
  const files = await walk(specRoot);
  const violations = [];

  for (const filePath of files) {
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/u);

    for (const { label, pattern } of BANNED_PATTERNS) {
      for (const match of content.matchAll(new RegExp(pattern, 'gu'))) {
        const index = match.index ?? -1;
        if (index < 0) {
          continue;
        }
        const line = lineNumber(content, index);
        violations.push({
          relPath,
          line,
          label,
          text: String(lines[line - 1] ?? '').trim(),
        });
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('Spec process-language gate failed:\n');
    for (const violation of violations) {
      process.stderr.write(
        `  - ${violation.relPath}:${violation.line}: ${violation.label}: ${violation.text}\n`,
      );
    }
    process.stderr.write(
      '\nActive .nimi/spec/** authority must describe final truth, not topic/wave/process provenance.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`Spec process-language gate passed (${files.length} file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-spec-no-process-language failed: ${String(error)}\n`);
  process.exit(1);
});
