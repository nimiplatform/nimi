#!/usr/bin/env node

// check-no-runtime-knowledge-service.mjs
//
// Wave-3 of topic 2026-05-10-runtime-knowledge-cognition-hard-cut.
// Hard-cut guard: the retired runtime knowledge surface must not
// reappear under any of the forbidden tokens after the legacy
// package was deleted in Wave 3 and the spec convergence locked
// it down in Wave 0.
//
// Guard scope: production source tree only. The allow-list captures
// legitimate retired-history references in spec, closed topic
// archives, this topic's own files, the topic's own deferred mod
// surface, and self-referential guards.
//
// Allow-list rationale: per D5 ("New Repo Guard" table), spec is
// its own review surface; the production-code guard does not
// gatekeep spec content. Future RuntimeKnowledgeService
// introductions to active spec must be caught by spec review, not
// by this script.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const FORBIDDEN_TOKENS = [
  'runtime/internal/services/knowledge',
  'RuntimeKnowledgeService',
  'knowledgeservice.NewPersistent',
  'knowledgeservice.NewWithBackend',
  'knowledge_snapshot',
  'pkgKnowledge',
];

// Allow-list (path globs, evaluated as prefix match relative to repoRoot).
// Each entry corresponds to a row in `design/D5-deletion-and-guards.md`
// "New Repo Guard" table.
const ALLOW_PREFIXES = [
  '.nimi/spec/',                                                      // spec retired-history (D5 table)
  '.nimi/topics/',                                                    // all topic lifecycle artifacts (gitignored; local-only working surface)
  '.nimi/local/',                                                     // local-only operational artifacts (gitignored)
  '.nimi/cache/',                                                     // local cache (gitignored)
  '.local/',                                                          // legacy local execution workspace (gitignored)
  '.iterate/',                                                        // local iteration workspace (gitignored)
  'scripts/check-runtime-proto-spec-linkage.mjs',                     // guard self-reference
  'scripts/check-no-runtime-knowledge-service.mjs',                   // this guard's pattern strings
  'scripts/check-no-runtime-knowledge-service.test.mjs',              // self-test fixtures
  'nimi-mods/runtime/knowledge-base/',                                // deferred mod surface
];

// File-specific allow-list. The wave-4 rename targets
// (knowledge_commands_test.go, runtime_knowledge_app_client_test.go)
// were on this list during wave-3 but are now dropped — wave-4
// renamed cmdTestRuntimeKnowledgeService and testRuntimeKnowledgeService
// out of those files, so any future reintroduction of the retired
// token there is caught by this guard.
//
// The cognition invariant tests pin the forbidden tokens as
// constants they validate against; guarding them would defang the
// test, so they remain allow-listed.
const ALLOW_FILES = [
  'runtime/internal/services/cognition/import_invariant_test.go',
  'runtime/internal/services/cognition/authorizer_test.go',
  'runtime/internal/services/cognition/workspace_denied_test.go',
  'runtime/internal/grpcserver/registration_invariant_test.go',
  // Wave-4 SDK assertion test (K5.1): pins the retired token as a
  // forbidden constant the test validates against; guarding it
  // would defang the assertion.
  'sdk/test/runtime-method-ids.test.ts',
];

// Directories the walker never descends into.
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '_external',
  'archive',
  'build',
  'coverage',
  'dist',
  'gen',
  'generated',
  'node_modules',
  'target',
]);

// Only scan these source-shaped extensions.
const SOURCE_EXTENSIONS = new Set([
  '.go', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.rs', '.json', '.md', '.yaml', '.yml',
]);

function* walk(dir, rel = '') {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(dir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    if (entry.isDirectory()) {
      yield* walk(abs, relPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(name);
    if (!SOURCE_EXTENSIONS.has(ext)) continue;
    yield { abs, rel: relPath };
  }
}

function isAllowed(relPath) {
  for (const prefix of ALLOW_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  for (const file of ALLOW_FILES) {
    if (relPath === file) return true;
  }
  return false;
}

function scan() {
  const violations = [];
  for (const { abs, rel } of walk(repoRoot)) {
    if (isAllowed(rel)) continue;
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch (err) {
      // Symlinks or unreadable files are not part of guard scope.
      continue;
    }
    for (const token of FORBIDDEN_TOKENS) {
      if (content.includes(token)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(token)) {
            violations.push({
              file: rel,
              line: i + 1,
              token,
              snippet: lines[i].trim().slice(0, 200),
            });
          }
        }
      }
    }
  }
  return violations;
}

function main() {
  const violations = scan();
  if (violations.length === 0) {
    process.stdout.write('check-no-runtime-knowledge-service: PASS — 0 violations\n');
    process.exit(0);
  }
  process.stderr.write(`check-no-runtime-knowledge-service: FAIL — ${violations.length} violation(s)\n\n`);
  for (const v of violations) {
    process.stderr.write(`  ${v.file}:${v.line}  [${v.token}]\n    ${v.snippet}\n`);
  }
  process.stderr.write('\nIf the hit is legitimate retired-history or a deferred surface, add it to the allow-list in scripts/check-no-runtime-knowledge-service.mjs and document the rationale in design/D5-deletion-and-guards.md.\n');
  process.exit(1);
}

main();
