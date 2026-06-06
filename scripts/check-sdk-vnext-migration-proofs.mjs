#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');

const proofFiles = [
  'sdks/typescript/migration-proofs/index.ts',
  'sdks/typescript/migration-proofs/model-fixtures.ts',
  'sdks/typescript/migration-proofs/proof-contracts.ts',
  'sdks/typescript/migration-proofs/vercel-ai-sdk-external-app.ts',
  'sdks/typescript/migration-proofs/mcp-tool-heavy-app.ts',
  'sdks/typescript/migration-proofs/mastra-like-agent-app.ts',
  'sdks/typescript/migration-proofs/langgraph-like-graph-node.ts',
  'sdks/typescript/migration-proofs/mingsim-shaped-proof.ts',
  'sdks/typescript/migration-proofs/ai-profile-requirement-flow.ts',
  'sdks/typescript/migration-proofs/migration-proofs.test.ts',
];

function run(label, args) {
  process.stdout.write(`[check-sdk-vnext-migration-proofs] ${label}\n`);
  const result = spawnSync(args[0], args.slice(1), {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const code = result.status ?? 1;
    throw new Error(`${label} failed with exit code ${String(code)}`);
  }
}

function main() {
  const missing = proofFiles.filter((file) => !existsSync(path.join(repoRoot, file)));
  if (missing.length > 0) {
    throw new Error(`missing migration proof files:\n${missing.map((file) => `- ${file}`).join('\n')}`);
  }

  run('running migration proof tests', [
    'pnpm',
    '--dir',
    vnextRoot,
    'exec',
    'tsx',
    '--test',
    '--test-concurrency=1',
    'migration-proofs/migration-proofs.test.ts',
  ]);
  run('typechecking migration proof sources and tests', [
    'pnpm',
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '--noEmit',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--strict',
    '--types',
    'node',
    '--skipLibCheck',
    ...proofFiles.map((file) => path.relative(vnextRoot, path.join(repoRoot, file)).replaceAll(path.sep, '/')),
  ]);

  process.stdout.write(`SDK vNext migration proof check passed (${proofFiles.length} file(s))\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-migration-proofs failed: ${message}\n`);
  process.exitCode = 1;
}
