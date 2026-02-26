#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const ssotProtoContractPath = path.join(repoRoot, 'ssot', 'runtime', 'proto-contract.md');

const REQUIRED_PATTERNS = [
  {
    pattern: /proto\/runtime\/v1\/\*\.proto/,
    label: 'must declare proto/runtime/v1/*.proto as canonical schema source',
  },
];

const BANNED_PATTERNS = [
  { pattern: /```(?:proto|protobuf)\b/i, label: 'embedded proto code fence is forbidden' },
  { pattern: /\bsyntax\s*=\s*"proto3"\s*;/, label: 'proto syntax declaration must live only in .proto files' },
  { pattern: /^\s*service\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m, label: 'service definitions must live only in .proto files' },
  { pattern: /^\s*rpc\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/m, label: 'rpc definitions must live only in .proto files' },
  { pattern: /^\s*message\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m, label: 'message definitions must live only in .proto files' },
  { pattern: /^\s*enum\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/m, label: 'enum definitions must live only in .proto files' },
];

const MAX_LINES = 260;

async function main() {
  const violations = [];
  let content = '';

  try {
    content = await fs.readFile(ssotProtoContractPath, 'utf8');
  } catch {
    process.stderr.write(
      `SSOT proto-first check failed: missing ${path.relative(repoRoot, ssotProtoContractPath)}\n`,
    );
    process.exit(1);
  }

  for (const item of REQUIRED_PATTERNS) {
    if (!item.pattern.test(content)) {
      violations.push(item.label);
    }
  }

  for (const item of BANNED_PATTERNS) {
    if (item.pattern.test(content)) {
      violations.push(item.label);
    }
  }

  const lineCount = content.split('\n').length;
  if (lineCount > MAX_LINES) {
    violations.push(`proto contract SSOT is too large (${lineCount} lines > ${MAX_LINES}); keep governance-only`);
  }

  if (violations.length > 0) {
    process.stderr.write('SSOT proto-first check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `SSOT proto-first check passed (${path.relative(repoRoot, ssotProtoContractPath)}, ${lineCount} line(s))\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`check-ssot-proto-first failed: ${String(error)}\n`);
  process.exitCode = 1;
});
