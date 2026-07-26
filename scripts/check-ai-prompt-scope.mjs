#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const PROJECT_DOC_MAX_BYTES = 32 * 1024;
const INACTIVE_PREFIXES = [
  'archive/',
  'docs/',
  '_external/',
  '.iterate/',
  '.cache/',
  '.local/',
  '.nimi/local/',
  'node_modules/',
  'app-tools/templates/app-source/',
];
const INACTIVE_SEGMENTS = new Set([
  'archive',
  'docs',
  '_external',
  '.iterate',
  '.cache',
  '.local',
  'generated',
  'gen',
  'node_modules',
]);
const IMAGE_AGENTS = 'nimi2d/AGENTS.md';
const PRODUCT_HARNESS_AGENTS = 'tests/local-agent-product/AGENTS.md';
const IMAGE_MARKERS = [
  'image2-provider-plan',
  'image2-provider-run',
  'image2-register-output',
  'image2-compare-pixels',
  'image2-postprocess',
  'image2-layer-workflow',
  'image2-distribution-report',
  'image2-demo-suite',
  'codex.cmd',
];
const PRODUCT_HARNESS_MARKERS = [
  'test:e2e:first-party-product:p4',
  '~/.nimi/nimi.json',
  'dataRoot.path',
  'durable product mutation',
];

function normalizeRel(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function lineCount(text) {
  const normalized = text.replace(/\r\n/gu, '\n').replace(/\n$/u, '');
  return normalized ? normalized.split('\n').length : 0;
}

function isActiveAgentPath(rel) {
  const normalized = normalizeRel(rel);
  if (normalized !== 'AGENTS.md' && !normalized.endsWith('/AGENTS.md')) {
    return false;
  }
  if (INACTIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  return !normalized.split('/').some((segment) => INACTIVE_SEGMENTS.has(segment));
}

function readUtf8(repoRoot, rel) {
  return fs.readFileSync(path.join(repoRoot, ...normalizeRel(rel).split('/')), 'utf8');
}

function readIfPresent(repoRoot, rel) {
  const target = path.join(repoRoot, ...normalizeRel(rel).split('/'));
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
}

export function discoverActiveAgents(repoRoot) {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr.trim() || `exit ${result.status}`;
    throw new Error(`unable to discover AGENTS.md files: ${detail}`);
  }
  return [...new Set(
    result.stdout
      .split(/\r?\n/u)
      .map(normalizeRel)
      .filter(Boolean)
      .filter(isActiveAgentPath),
  )].sort();
}

function instructionChain(activeSet, rel) {
  const chain = [];
  if (activeSet.has('AGENTS.md')) {
    chain.push('AGENTS.md');
  }
  if (rel === 'AGENTS.md') {
    return chain;
  }
  const parts = normalizeRel(rel).split('/');
  for (let index = 1; index < parts.length; index += 1) {
    const candidate = `${parts.slice(0, index).join('/')}/AGENTS.md`;
    if (activeSet.has(candidate)) {
      chain.push(candidate);
    }
  }
  return chain;
}

function requireContains(failures, rel, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) {
      failures.push(`${rel}: missing required marker ${JSON.stringify(marker)}`);
    }
  }
}

function forbidPatterns(failures, rel, text, patterns) {
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) {
      failures.push(`${rel}: forbidden ${label}`);
    }
  }
}

export function collectPromptScopeFailures(repoRoot, options = {}) {
  const failures = [];
  const activeAgents = (options.activeAgents || discoverActiveAgents(repoRoot))
    .map(normalizeRel)
    .filter(isActiveAgentPath)
    .sort();
  const activeSet = new Set(activeAgents);
  const governance = YAML.parse(readUtf8(repoRoot, '.nimi/config/governance.yaml'));
  const registryRows = governance?.ai_governance?.agents_freshness?.targets || [];
  const registryAgents = registryRows.map((row) => normalizeRel(row.rel));
  const registrySet = new Set(registryAgents);

  const duplicates = [...new Set(
    registryAgents.filter((rel, index) => registryAgents.indexOf(rel) !== index),
  )].sort();
  for (const rel of duplicates) {
    failures.push(`governance registry: duplicate target ${rel}`);
  }
  for (const rel of activeAgents) {
    if (!registrySet.has(rel)) {
      failures.push(`governance registry: missing active target ${rel}`);
    }
  }
  for (const rel of [...registrySet].sort()) {
    if (!activeSet.has(rel)) {
      failures.push(`governance registry: stale or inactive target ${rel}`);
    }
  }

  const rootAgents = readUtf8(repoRoot, 'AGENTS.md');
  requireContains(failures, 'AGENTS.md', rootAgents, [IMAGE_AGENTS, PRODUCT_HARNESS_AGENTS]);
  forbidPatterns(failures, 'AGENTS.md', rootAgents, [
    ['Image2 command detail', /image2-provider-/u],
    ['P4 command detail', /test:e2e:first-party-product:p4/u],
    ['Product Control path detail', /~\/\.nimi\/nimi\.json/u],
    ['runtime-first ordering', /(?:`runtime`|runtime)\s*(?:→|->)[^\n]*(?:sdks\/typescript|SDK)/iu],
    ['filesystem-root authority path', /\/\.nimi\/spec/u],
  ]);

  for (const rel of activeAgents) {
    const text = readUtf8(repoRoot, rel);
    if (rel !== IMAGE_AGENTS && /image2-provider-/u.test(text)) {
      failures.push(`${rel}: Image2 command detail must live only in ${IMAGE_AGENTS}`);
    }
    if (
      rel !== PRODUCT_HARNESS_AGENTS
      && /(test:e2e:first-party-product:p4|~\/\.nimi\/nimi\.json)/u.test(text)
    ) {
      failures.push(`${rel}: product-harness detail must live only in ${PRODUCT_HARNESS_AGENTS}`);
    }
  }

  const imageAgents = readUtf8(repoRoot, IMAGE_AGENTS);
  requireContains(failures, IMAGE_AGENTS, imageAgents, IMAGE_MARKERS);
  const productHarnessAgents = readUtf8(repoRoot, PRODUCT_HARNESS_AGENTS);
  requireContains(
    failures,
    PRODUCT_HARNESS_AGENTS,
    productHarnessAgents,
    PRODUCT_HARNESS_MARKERS,
  );

  const compatibilityPrompts = [
    ['CLAUDE.md', 25],
    ['.cursorrules', 12],
  ];
  for (const [rel, maxLines] of compatibilityPrompts) {
    const text = readUtf8(repoRoot, rel);
    if (lineCount(text) > maxLines) {
      failures.push(`${rel}: ${lineCount(text)} lines exceeds ${maxLines}`);
    }
    requireContains(failures, rel, text, ['AGENTS.md']);
    forbidPatterns(failures, rel, text, [
      ['runtime-first ordering', /(?:Layer debug order|runtime\s*(?:→|->)[^\n]*sdks)/iu],
      ['broad runtime retrieval list', /runtime\/internal/iu],
      ['filesystem-root authority path', /\/\.nimi/u],
      ['duplicated retrieval section', /## (?:Retrieval Defaults|Repo-Wide Verification)/iu],
      ['legacy root topology', /(?:^|\n)- `(?:sdk|desktop|web|mods)\//u],
    ]);
  }

  const targetedChecks = [
    ['runtime/AGENTS.md', [['repo-wide first blocker', /first blocking layer/iu]]],
    ['apps/desktop/AGENTS.md', [
      ['bare spec path', /`spec\/\*\*`/u],
      ['filesystem-root spec path', /`\/\.nimi\/spec/u],
    ]],
    ['kit/ui/AGENTS.md', [
      ['parallel design authority claim', /(?:cross-app design authority|is the design authority)/iu],
    ]],
    ['app-tools/templates/default-starter/AGENTS.md', [
      ['hypothetical SDK ownership expansion', /or should exist/iu],
      ['automatic authority note', /Stop and write an authority note/iu],
    ]],
    ['apps/tester/AGENTS.md', [
      ['hypothetical SDK ownership expansion', /or should exist/iu],
      ['automatic authority note', /Stop and write an authority note/iu],
      ['sibling prompt dependency', /app-tools\/templates\/default-starter\/AGENTS\.md/iu],
    ]],
    ['runtime/catalog/source/AGENTS.md', [
      ['unconditional provider report', /Produce or update a provider update report before mutating source/iu],
    ]],
    ['apps/avatar/AGENTS.md', [
      ['dynamic productization status', /Productization gate active/iu],
      ['dynamic capability matrix', /Admitted Capability Status/iu],
      ['historical run count', /21-run/iu],
      ['unbounded full-suite instruction', /Run full test suite/iu],
    ]],
    ['apps/avatar/README.md', [
      ['dynamic productization status', /Productization gate active/iu],
      ['dynamic delivery waves', /## Delivery Waves/iu],
      ['retired two-backend union', /(?:Live2D \+ VRM|backend branches are Live2D and VRM)/iu],
    ]],
  ];
  for (const [rel, patterns] of targetedChecks) {
    const text = readIfPresent(repoRoot, rel);
    if (text !== null) {
      forbidPatterns(failures, rel, text, patterns);
    }
  }

  for (const rel of activeAgents) {
    const chain = instructionChain(activeSet, rel);
    const bytes = chain.reduce(
      (total, item, index) => total + Buffer.byteLength(readUtf8(repoRoot, item), 'utf8') + (index ? 2 : 0),
      0,
    );
    if (bytes >= PROJECT_DOC_MAX_BYTES) {
      failures.push(
        `${rel}: AGENTS instruction chain is ${bytes} bytes; must stay below ${PROJECT_DOC_MAX_BYTES}`,
      );
    }
  }

  for (const rel of ['DESIGN.md', 'kit/DESIGN.md']) {
    const text = readUtf8(repoRoot, rel);
    forbidPatterns(failures, rel, text, [
      ['industrial-grade slogan', /industrial-grade/iu],
      ['complete-token overclaim', /complete tokens/iu],
    ]);
  }
  requireContains(
    failures,
    'DESIGN.md',
    readUtf8(repoRoot, 'DESIGN.md'),
    ['kit/design-projection.json'],
  );

  return failures;
}

export function runPromptScopeCheck(repoRoot = path.resolve('.')) {
  const failures = collectPromptScopeFailures(repoRoot);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`[ai-prompt-scope] ${failure}`);
    }
    return 1;
  }
  console.log('[ai-prompt-scope] passed');
  return 0;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  process.exitCode = runPromptScopeCheck();
}
