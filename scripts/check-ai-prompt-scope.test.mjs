import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectPromptScopeFailures } from './check-ai-prompt-scope.mjs';

const ACTIVE_AGENTS = [
  'AGENTS.md',
  'nimi2d/AGENTS.md',
  'tests/local-agent-product/AGENTS.md',
];

function write(root, rel, content) {
  const target = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function buildFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-ai-prompt-scope-'));
  write(root, '.nimi/config/governance.yaml', `ai_governance:
  agents_freshness:
    targets:
      - rel: AGENTS.md
        max_lines: 40
      - rel: nimi2d/AGENTS.md
        max_lines: 60
      - rel: tests/local-agent-product/AGENTS.md
        max_lines: 60
`);
  write(root, 'AGENTS.md', `# AGENTS.md

For Nimi2D Image2 work, read \`nimi2d/AGENTS.md\`.
For Gate 0 or P4 work, read \`tests/local-agent-product/AGENTS.md\`.
`);
  write(root, 'nimi2d/AGENTS.md', `# AGENTS.md

## Scope
Image2.
## Hard Boundaries
${[
    'image2-provider-plan',
    'image2-provider-run',
    'image2-register-output',
    'image2-compare-pixels',
    'image2-postprocess',
    'image2-layer-workflow',
    'image2-distribution-report',
    'image2-demo-suite',
    'codex.cmd',
  ].join(' ')}
## Retrieval Defaults
Current task only.
## Verification Commands
Relevant command only.
`);
  write(root, 'tests/local-agent-product/AGENTS.md', `# AGENTS.md

## Scope
P4.
## Hard Boundaries
durable product mutation
## Retrieval Defaults
Current journey only.
## Verification Commands
pnpm test:e2e:first-party-product:p4
Reuse dataRoot.path from ~/.nimi/nimi.json; never accept a second root oracle.
`);
  write(root, 'CLAUDE.md', '# CLAUDE.md\n\nRead the nearest AGENTS.md.\n');
  write(root, '.cursorrules', '# Cursor\n\nRead the nearest AGENTS.md.\n');
  write(root, 'DESIGN.md', 'Compact projection. Full inventory: kit/design-projection.json\n');
  write(root, 'kit/DESIGN.md', 'Authority-backed design projection.\n');
  return root;
}

function withFixture(run) {
  const root = buildFixture();
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('accepts an exact scoped prompt registry', () => {
  withFixture((root) => {
    assert.deepEqual(
      collectPromptScopeFailures(root, { activeAgents: ACTIVE_AGENTS }),
      [],
    );
  });
});

test('ignores AGENTS files under local evidence paths', () => {
  withFixture((root) => {
    write(root, '.nimi/local/evidence/AGENTS.md', 'local evidence only\n');
    assert.deepEqual(
      collectPromptScopeFailures(root, {
        activeAgents: [...ACTIVE_AGENTS, '.nimi/local/evidence/AGENTS.md'],
      }),
      [],
    );
  });
});

test('rejects an active AGENTS file missing from governance', () => {
  withFixture((root) => {
    const governance = path.join(root, '.nimi', 'config', 'governance.yaml');
    const body = fs.readFileSync(governance, 'utf8')
      .replace(/      - rel: nimi2d\/AGENTS\.md\n        max_lines: 60\n/u, '');
    fs.writeFileSync(governance, body, 'utf8');
    const failures = collectPromptScopeFailures(root, { activeAgents: ACTIVE_AGENTS });
    assert.ok(failures.some((failure) => failure.includes('missing active target nimi2d/AGENTS.md')));
  });
});

test('rejects scoped Image2 details restored to the root prompt', () => {
  withFixture((root) => {
    fs.appendFileSync(path.join(root, 'AGENTS.md'), '\nimage2-provider-run\n', 'utf8');
    const failures = collectPromptScopeFailures(root, { activeAgents: ACTIVE_AGENTS });
    assert.ok(failures.some((failure) => failure.includes('Image2 command detail')));
  });
});

test('rejects an AGENTS chain at or above the 32 KiB project limit', () => {
  withFixture((root) => {
    fs.appendFileSync(
      path.join(root, 'nimi2d', 'AGENTS.md'),
      `\n${'x'.repeat(32 * 1024)}\n`,
      'utf8',
    );
    const failures = collectPromptScopeFailures(root, { activeAgents: ACTIVE_AGENTS });
    assert.ok(failures.some((failure) => failure.includes('must stay below 32768')));
  });
});

test('rejects duplicated runtime-first guidance in a compatibility shim', () => {
  withFixture((root) => {
    fs.appendFileSync(path.join(root, 'CLAUDE.md'), '\nLayer debug order: runtime → sdks\n', 'utf8');
    const failures = collectPromptScopeFailures(root, { activeAgents: ACTIVE_AGENTS });
    assert.ok(failures.some((failure) => failure.includes('CLAUDE.md: forbidden runtime-first ordering')));
  });
});
