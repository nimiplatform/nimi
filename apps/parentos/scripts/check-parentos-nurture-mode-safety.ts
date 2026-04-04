/**
 * check-parentos-nurture-mode-safety.ts
 * Validates that P0 reminders are ALWAYS push in ALL nurture modes.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TABLES = resolve(ROOT, 'spec/kernel/tables');

let errors = 0;

function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg: string) {
  console.log(`  PASS: ${msg}`);
}

console.log('\n=== Nurture Mode Safety ===\n');

const data = parseYaml(
  readFileSync(resolve(TABLES, 'reminder-rules.yaml'), 'utf-8'),
) as {
  rules: Array<{
    ruleId: string;
    priority: string;
    nurtureMode: { relaxed: string; balanced: string; advanced: string };
  }>;
};

let p0Count = 0;

for (const rule of data.rules) {
  if (rule.priority !== 'P0') continue;
  p0Count++;

  const modes = ['relaxed', 'balanced', 'advanced'] as const;
  for (const mode of modes) {
    if (rule.nurtureMode[mode] !== 'push') {
      fail(`P0 rule ${rule.ruleId} has '${rule.nurtureMode[mode]}' in ${mode} mode — must be 'push'`);
    }
  }
}

if (p0Count === 0) {
  fail('No P0 rules found — this is unexpected');
} else {
  pass(`${p0Count} P0 rules checked — all must be push in all modes`);
}

// ── Nurture modes YAML internal consistency ─────────────────

console.log('\n=== Nurture Mode Config ===\n');

const modesData = parseYaml(
  readFileSync(resolve(TABLES, 'nurture-modes.yaml'), 'utf-8'),
) as {
  modes: Array<{
    modeId: string;
    parameters: { reminderBehavior: { P0: string } };
  }>;
};

for (const mode of modesData.modes) {
  if (mode.parameters.reminderBehavior.P0 !== 'push') {
    fail(`Mode '${mode.modeId}' defines P0 as '${mode.parameters.reminderBehavior.P0}' — must be 'push'`);
  } else {
    pass(`Mode '${mode.modeId}' P0 = push`);
  }
}

// ── Result ──────────────────────────────────────────────────

console.log(`\n${errors === 0 ? 'All checks passed.' : `${errors} error(s) found.`}\n`);
process.exit(errors > 0 ? 1 : 0);
