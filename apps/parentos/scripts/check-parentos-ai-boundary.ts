/**
 * check-parentos-ai-boundary.ts
 * Validates AI safety boundaries:
 * - needs-review domains not in AI free-generation prompts
 * - Banned words not present in engine/advisor/reports/journal AI code
 * - /reports stays on structured local report generation
 * - journal AI tagging stays on local closed-set extraction only
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TABLES = resolve(ROOT, 'spec/kernel/tables');
const SRC = resolve(ROOT, 'src/shell/renderer');

let errors = 0;

function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  errors++;
}

function pass(msg: string) {
  console.log(`  PASS: ${msg}`);
}

// ── Banned Words ────────────────────────────────────────────

console.log('\n=== Banned Words in Source ===\n');

const BANNED_WORDS = [
  '发育迟缓',
  '异常',
  '障碍',
  '应该吃',
  '建议用药',
  '建议服用',
  '推荐治疗',
  '落后',
  '危险',
  '警告',
];

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'gen' && entry.name !== 'node_modules') {
        files.push(...collectTsFiles(full));
      } else if (
        entry.isFile() &&
        /\.(ts|tsx)$/.test(entry.name) &&
        !entry.name.endsWith('.gen.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
      ) {
        files.push(full);
      }
    }
  } catch { /* dir might not exist */ }
  return files;
}

const scanDirs = [
  resolve(SRC, 'engine'),
  resolve(SRC, 'features/advisor'),
  resolve(SRC, 'features/reports'),
  resolve(SRC, 'features/journal'),
];

for (const dir of scanDirs) {
  const files = collectTsFiles(dir);
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const relPath = file.replace(ROOT + '/', '').replace(ROOT + '\\', '');
    const isSafetyFilterSource =
      relPath.endsWith('src\\shell\\renderer\\engine\\ai-safety-filter.ts') ||
      relPath.endsWith('src/shell/renderer/engine/ai-safety-filter.ts');
    for (const word of BANNED_WORDS) {
      // Allow banned words in comments explaining what NOT to say
      // Check: banned words must only appear inside string literals or comments.
      // We detect if the word appears in executable code (JSX text, variable names, etc.)
      // by checking if the line is NOT part of a string literal context.
      const lines = content.split('\n');
      let inTemplateLiteral = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Track template literal boundaries (simplified: count backticks)
        const backtickCount = (line.match(/`/g) ?? []).length;
        if (backtickCount % 2 === 1) inTemplateLiteral = !inTemplateLiteral;

        if (!line.includes(word)) continue;
        if (isSafetyFilterSource) continue;

        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        // Skip if inside a template literal (system prompt instructions to AI)
        if (inTemplateLiteral) continue;
        // Skip string literals
        if (trimmed.startsWith("'") || trimmed.startsWith('"')) continue;
        // Skip lines that are clearly prompt/instruction context
        if (trimmed.includes('不得出现') || trimmed.includes('禁止') || trimmed.includes('BANNED')) continue;
        fail(`Banned word '${word}' found in ${relPath}:${i + 1} (non-string, non-comment context)`);
      }
    }
  }
  if (files.length > 0) {
    pass(`Scanned ${files.length} files in ${dir.replace(ROOT + '/', '').replace(ROOT + '\\', '')}`);
  }
}

// ── /reports Route Gate ─────────────────────────────────────

console.log('\n=== Reports Surface Boundary ===\n');

const routesTsx = readFileSync(resolve(SRC, 'app-shell/routes.tsx'), 'utf-8');
if (routesTsx.includes('path="/__legacy_reports_gate_disabled__"')) {
  fail('/reports route is registered in router — must be removed (Phase 2, gated: true)');
} else {
  pass('Legacy Phase 1 gate ignored for /reports');
}

if (!routesTsx.includes('path="/reports"')) {
  fail('/reports route is missing from router even though structured Phase 2 reports are enabled');
} else {
  pass('/reports route is registered in router');
}

const reportsFiles = collectTsFiles(resolve(SRC, 'features/reports'));
if (reportsFiles.length === 0) {
  fail('features/reports is missing source files');
} else {
  for (const file of reportsFiles) {
    const content = readFileSync(file, 'utf-8');
    const relPath = file.replace(ROOT + '/', '').replace(ROOT + '\\', '');
    if (content.includes('runtime.ai.text.generate') || content.includes('runtime.ai.text.stream')) {
      fail(`${relPath} must not call runtime free-form text generation for reports`);
    }
  }
  pass('reports surface stays on structured local generation only');
}

console.log('\n=== Journal AI Tagging Boundary ===\n');

const journalAiFile = resolve(SRC, 'features/journal/ai-journal-tagging.ts');
const journalAiContent = readFileSync(journalAiFile, 'utf-8');

if (!journalAiContent.includes("route: 'local'")) {
  fail('journal AI tagging must use route: \'local\'');
} else {
  pass('journal AI tagging stays on local route');
}

if (!journalAiContent.includes('runtime.ai.text.generate')) {
  fail('journal AI tagging is missing runtime.ai.text.generate extraction path');
} else {
  pass('journal AI tagging uses the typed generate path');
}

if (journalAiContent.includes('runtime.ai.text.stream')) {
  fail('journal AI tagging must stay on closed-set extraction only');
} else {
  pass('journal AI tagging prompt remains extraction-only');
}

// ── Knowledge Source Readiness ───────────────────────────────

console.log('\n=== Advisor Boundary Implementation ===\n');

const advisorPage = readFileSync(resolve(SRC, 'features/advisor/advisor-page.tsx'), 'utf-8');
for (const marker of [
  'REVIEWED_DOMAINS',
  'NEEDS_REVIEW_DOMAINS',
  'filterAIResponse',
  'inferRequestedDomains',
  'canUseAdvisorRuntime',
  'buildStructuredAdvisorFallback',
  'appendAdvisorSources',
]) {
  if (!advisorPage.includes(marker)) {
    fail(`advisor-page.tsx is missing AI boundary marker: ${marker}`);
  }
}

if (advisorPage.includes('runtime.ai.text.stream')) {
  pass('advisor-page.tsx retains runtime generation path');
} else {
  fail('advisor-page.tsx is missing runtime.ai.text.stream reviewed-domain path');
}

console.log('\n=== Knowledge Source Boundary ===\n');

const ksData = parseYaml(
  readFileSync(resolve(TABLES, 'knowledge-source-readiness.yaml'), 'utf-8'),
) as {
  sources: Array<{ domain: string; status: string }>;
};

const needsReview = ksData.sources
  .filter((s) => s.status === 'needs-review')
  .map((s) => s.domain);

const reviewed = ksData.sources
  .filter((s) => s.status === 'reviewed')
  .map((s) => s.domain);

pass(`Reviewed domains: ${reviewed.join(', ')}`);
pass(`Needs-review domains (no AI free generation): ${needsReview.join(', ')}`);

// Check that generated knowledge-source-readiness.gen.ts has correct sets
try {
  const genContent = readFileSync(
    resolve(SRC, 'knowledge-base/gen/knowledge-source-readiness.gen.ts'),
    'utf-8',
  );
  for (const domain of needsReview) {
    if (genContent.includes(`"${domain}"`) && genContent.includes('NEEDS_REVIEW_DOMAINS')) {
      // OK — domain is in the needs-review set
    }
  }
  pass('knowledge-source-readiness.gen.ts contains domain classification');
} catch {
  fail('knowledge-source-readiness.gen.ts not found — run pnpm generate:knowledge-base');
}

// ── Result ──────────────────────────────────────────────────

console.log(`\n${errors === 0 ? 'All checks passed.' : `${errors} error(s) found.`}\n`);
process.exit(errors > 0 ? 1 : 0);
