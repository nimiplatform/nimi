#!/usr/bin/env node
import { initializeLocalAgentLife } from './lib/initialize-local-agent-life.mjs';

const args = process.argv.slice(2).filter(arg => arg !== '--');
if (args.includes('--help')) {
  console.log('One-time initialization of missing life rows in the known pre-life, default-off LocalAgent database. Never run automatically at startup.\nPreview: pnpm runtime:initialize-local-agent-life --db <absolute memory.db>\nApply the reviewed plan while Runtime is stopped: add --apply --confirm-runtime-stopped --backup <new absolute backup.db> --expected-input-hash <preview hash>\nOnly empty initial life rows are inserted. Identity, media, source snapshots, partners, Conversation, Memory and existing life history are not rewritten. Partial coverage or active/unknown old formats fail closed.');
} else {
  try {
    const options = {};
    const values = { '--db': 'dbPath', '--backup': 'backupPath', '--expected-input-hash': 'expectedInputHash' };
    const flags = { '--apply': 'apply', '--confirm-runtime-stopped': 'runtimeStopped' };
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (seen.has(arg)) throw new Error('Duplicate option: ' + arg);
      seen.add(arg);
      if (flags[arg]) options[flags[arg]] = true;
      else if (values[arg] && args[i + 1] && !args[i + 1].startsWith('--')) options[values[arg]] = args[++i];
      else throw new Error('Unknown or incomplete option: ' + arg);
    }
    console.log(JSON.stringify(initializeLocalAgentLife(options), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
