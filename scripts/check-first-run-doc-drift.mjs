#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const checks = [
  {
    file: 'README.md',
    required: [
      'nimi start',
      'nimi run "What is Nimi?"',
      'nimi run "What is Nimi?" --provider gemini',
    ],
    forbidden: ['nimi serve', '--yes', '--model local/qwen2.5', '--provider gemini --model'],
    ordered: [
      ['nimi run "What is Nimi?" --provider gemini', 'nimi provider set gemini --api-key-env'],
    ],
  },
  {
    file: 'docs/README.md',
    required: [
      'nimi start',
      'nimi run "What is Nimi?"',
      'nimi run "What is Nimi?" --provider gemini',
    ],
    forbidden: ['nimi serve', '--yes', '--model local/qwen2.5', '--provider gemini --model'],
  },
  {
    file: 'docs/index.md',
    required: [
      'nimi start',
      'nimi run "..."',
      'nimi run "..." --provider ...',
    ],
    forbidden: ['nimi serve', '--yes', '--model local/...', '--provider ... --model ...'],
  },
  {
    file: 'docs/getting-started/index.md',
    required: [
      'nimi start',
      'nimi run "What is Nimi?"',
      'nimi run "What is Nimi?" --provider gemini',
    ],
    forbidden: ['nimi serve', '--model local/qwen2.5', '--provider gemini --model'],
    ordered: [
      ['nimi run "What is Nimi?" --provider gemini', 'nimi provider set gemini --api-key-env'],
    ],
  },
  {
    file: 'examples/README.md',
    required: [
      'nimi start',
      'nimi run "What is Nimi?" --provider gemini',
      'nimi provider set gemini --api-key-env',
    ],
    forbidden: ['nimi serve', '--provider openai --model', '--default-model gpt-4o-mini'],
    ordered: [
      ['nimi run "What is Nimi?" --provider gemini', 'nimi provider set gemini --api-key-env'],
    ],
  },
  {
    file: 'scripts/install.sh',
    required: [
      'Run: nimi start',
      'Run: nimi doctor',
      'Run: nimi run \\"What is Nimi?\\"',
    ],
    forbidden: ['Run: nimi serve', '--model local/qwen2.5'],
  },
  {
    file: 'apps/landing/src/content/landing-content.ts',
    required: [
      "command: 'nimi start'",
      'command: \'nimi run "What is Nimi?"\'',
    ],
    forbidden: ["command: 'nimi serve'", '--yes', '--model local/qwen2.5'],
  },
];

const failures = [];

for (const check of checks) {
  const filePath = path.join(repoRoot, check.file);
  const content = fs.readFileSync(filePath, 'utf8');

  for (const token of check.required || []) {
    if (!content.includes(token)) {
      failures.push(`${check.file}: missing required token ${JSON.stringify(token)}`);
    }
  }

  for (const token of check.forbidden || []) {
    if (content.includes(token)) {
      failures.push(`${check.file}: forbidden token present ${JSON.stringify(token)}`);
    }
  }

  for (const [first, second] of check.ordered || []) {
    const firstIndex = content.indexOf(first);
    const secondIndex = content.indexOf(second);
    if (firstIndex === -1 || secondIndex === -1) {
      continue;
    }
    if (firstIndex > secondIndex) {
      failures.push(`${check.file}: expected ${JSON.stringify(first)} to appear before ${JSON.stringify(second)}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write('first-run doc drift check failed:\n');
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(`first-run doc drift check passed (${checks.length} file(s) scanned)\n`);
