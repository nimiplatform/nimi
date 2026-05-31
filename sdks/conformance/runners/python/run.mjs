#!/usr/bin/env node
process.argv.push('--language', 'python');
await import('../../run.mjs');
