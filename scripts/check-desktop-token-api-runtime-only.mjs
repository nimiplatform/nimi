#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);

const targets = [
  'apps/desktop/src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery.ts',
  'apps/desktop/src/runtime/llm-adapter/runtime/routing-service.ts',
  'apps/desktop/src/runtime/llm-adapter/registry/model-registry.ts',
];

const failures = [];

for (const relativePath of targets) {
  const absolutePath = resolve(repoRoot, relativePath);
  const content = readFileSync(absolutePath, 'utf8');
  const hasCreateProviderAdapter = /\bcreateProviderAdapter\s*\(/.test(content);
  const hasDirectListModels = /\b[a-zA-Z0-9_]+\s*\.\s*listModels\s*\(/.test(content);
  const hasDirectHealthCheck = /\b[a-zA-Z0-9_]+\s*\.\s*healthCheck\s*\(/.test(content);

  if (hasCreateProviderAdapter && (hasDirectListModels || hasDirectHealthCheck)) {
    failures.push(`${relativePath}: direct createProviderAdapter(...).listModels/healthCheck is forbidden`);
    continue;
  }

  if (hasDirectListModels || hasDirectHealthCheck) {
    failures.push(`${relativePath}: direct adapter listModels/healthCheck is forbidden for token-api probe path`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('desktop token-api runtime-only check passed\n');
}
