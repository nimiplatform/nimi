#!/usr/bin/env node
process.argv.push('--language', 'go');
await import('../../run.mjs');
