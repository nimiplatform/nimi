#!/usr/bin/env node

if (!process.argv.includes('--check')) {
  process.argv.push('--check');
}

await import('./generate-relay-spec-kernel-docs.mjs');
