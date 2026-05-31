#!/usr/bin/env node
process.argv.push('--language', 'rust');
await import('../../run.mjs');
