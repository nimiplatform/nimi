#!/usr/bin/env node
process.argv.push('--language', 'typescript');
await import('../../run.mjs');
