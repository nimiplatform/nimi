import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkReleasePromisePublicCopy } from './check-release-promise-public-copy.mjs';

const POSITIONING =
  'Nimi is an open-source, local-first, multi-provider personal AI runtime with Realm-owned ecosystem identity.';

function makeFixture(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-release-promise-copy-'));
  fs.mkdirSync(path.join(root, '.nimi/spec/platform/kernel/tables'), { recursive: true });
  fs.mkdirSync(path.join(root, 'app-tools'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/tester'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/platform/agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/runtime'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs/sdk'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sdks'), { recursive: true });

  const files = {
    '.nimi/spec/platform/kernel/tables/release-promise-freeze.yaml': [
      'positioning:',
      `  statement: ${POSITIONING}`,
      '',
    ].join('\n'),
    'README.md': [
      '# Nimi',
      '',
      POSITIONING,
      '',
      'Their stable public product release channels remain release-gated and are not opened by the source checkout itself.',
      '',
      'These commands are for a source checkout or locally built runtime binary.',
      '',
    ].join('\n'),
    'RELEASE.md': '# Release Process\n',
    'app-tools/README.md': [
      '# @nimiplatform/app-tools',
      '',
      'The CLI does not create public admission truth, permission grants, registry visibility, release descriptors, or installed-app update truth.',
      '',
    ].join('\n'),
    'apps/tester/README.md': '# Tester\n',
    'docs/platform/agents/chat-and-life-tracks.md': 'Life Track is narrow follow-up-turn only; general reminders are not promised.\n',
    'docs/platform/agents/hook-intent.md': 'HookIntent supports narrow follow-up-turn only; app scheduler is outside this promise.\n',
    'docs/platform/agents/participation-authority.md': 'Runtime Agent Participation is deferred; no public production participation SDK is promised.\n',
    'docs/runtime/agent-execution.md': 'Runtime execution docs describe the supported chat path and narrow follow-up-turn only.\n',
    'docs/runtime/delegated-capability.md': 'MCP delegated behavior is partial and raw MCP ontology promotion is unsupported.\n',
    'docs/runtime/mcp-integration.md': 'MCP resources are unsupported and production MCP transport is not promised.\n',
    'docs/sdk/agent-participation-client.md': 'Agent participation client is semantic-contract-only and deferred; no public production SDK surface.\n',
    'sdks/README.md': [
      '# SDKS Core Family',
      '',
      'Adapter packages stay source-local/private until owner-approved public package names and compatibility promises are accepted.',
      '',
    ].join('\n'),
    ...overrides,
  };

  for (const [relPath, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, relPath), text);
  }
  return root;
}

test('release promise public copy check accepts bounded public copy', () => {
  const root = makeFixture();
  assert.deepEqual(checkReleasePromisePublicCopy(root), []);
});

test('release promise public copy check rejects Runtime OpenAI REST overclaim', () => {
  const root = makeFixture({
    'README.md': [
      '# Nimi',
      '',
      POSITIONING,
      'Their stable public product release channels remain release-gated and are not opened by the source checkout itself.',
      'These commands are for a source checkout or locally built runtime binary.',
      'Use /v1/chat/completions as the stable app integration endpoint.',
      '',
    ].join('\n'),
  });
  assert.match(
    checkReleasePromisePublicCopy(root).join('\n'),
    /runtime-openai-compatible-rest-endpoint/,
  );
});

test('release promise public copy check rejects app-tools admission overclaim', () => {
  const root = makeFixture({
    'app-tools/README.md': [
      '# @nimiplatform/app-tools',
      '',
      'The CLI creates public admission truth and permission grants for generated apps.',
      '',
    ].join('\n'),
  });
  const errors = checkReleasePromisePublicCopy(root).join('\n');
  assert.match(errors, /app-tools-non-admission-boundary/);
  assert.match(errors, /app-tools-admission-overclaim/);
});
