#!/usr/bin/env node
import path from 'node:path';
import { run as runAcceptanceSkeleton } from './commands/acceptance-skeleton.mjs';
import { run as runAttachEvidence } from './commands/attach-evidence.mjs';
import { run as runBatchPhaseDone } from './commands/batch-phase-done.mjs';
import { run as runBatchPreflight } from './commands/batch-preflight.mjs';
import { run as runFindingSetStatus } from './commands/finding-set-status.mjs';
import { run as runInitTopic } from './commands/init-topic.mjs';
import { run as runPromptSkeleton } from './commands/prompt-skeleton.mjs';
import { run as runSetBaseline } from './commands/set-baseline.mjs';
import { run as runSetTopicStatus } from './commands/set-topic-status.mjs';
import { run as runTopicSummary } from './commands/topic-summary.mjs';
import { run as runUnresolvedFindings } from './commands/unresolved-findings.mjs';
import { run as runValidateAcceptance } from './commands/validate-acceptance.mjs';
import { run as runValidateDoc } from './commands/validate-doc.mjs';
import { run as runValidateFindingLedger } from './commands/validate-finding-ledger.mjs';
import { run as runValidateModule } from './commands/validate-module.mjs';
import { run as runValidatePrompt } from './commands/validate-prompt.mjs';
import { run as runValidateTopic } from './commands/validate-topic.mjs';
import { run as runValidateWorkerOutput } from './commands/validate-worker-output.mjs';

const COMMANDS = {
  'acceptance-skeleton': runAcceptanceSkeleton,
  'attach-evidence': runAttachEvidence,
  'batch-phase-done': runBatchPhaseDone,
  'batch-preflight': runBatchPreflight,
  'finding-set-status': runFindingSetStatus,
  'init-topic': runInitTopic,
  'prompt-skeleton': runPromptSkeleton,
  'set-baseline': runSetBaseline,
  'set-topic-status': runSetTopicStatus,
  'topic-summary': runTopicSummary,
  'unresolved-findings': runUnresolvedFindings,
  'validate-acceptance': runValidateAcceptance,
  'validate-doc': runValidateDoc,
  'validate-finding-ledger': runValidateFindingLedger,
  'validate-module': runValidateModule,
  'validate-prompt': runValidatePrompt,
  'validate-topic': runValidateTopic,
  'validate-worker-output': runValidateWorkerOutput,
};

function usage() {
  process.stdout.write(
    [
      'nimi-coding <command> [args]',
      '',
      'Lifecycle:',
      '  init-topic              Initialize a new topic directory',
      '  set-topic-status        Change topic status (exploring/active/closed/...)',
      '  set-baseline            Set or clear topic active baseline',
      '  attach-evidence         Attach evidence to topic (optionally as final)',
      '  finding-set-status      Transition a finding lifecycle status',
      '',
      'Validate:',
      '  validate-topic          Validate a topic directory',
      '  validate-doc            Validate an explore/baseline/evidence document',
      '  validate-prompt         Validate a prompt artifact',
      '  validate-worker-output  Validate a worker-output artifact',
      '  validate-acceptance     Validate an acceptance artifact',
      '  validate-finding-ledger Validate a finding ledger',
      '  validate-module         Validate the nimi-coding module itself',
      '',
      'Assist:',
      '  topic-summary           Structured topic overview (status, findings, refs)',
      '  unresolved-findings     List active/deferred findings from ledger',
      '  prompt-skeleton         Generate dispatch prompt skeleton from topic state',
      '  acceptance-skeleton     Generate acceptance skeleton with disposition',
      '',
      'Batch:',
      '  batch-preflight         Validate frozen-plan preconditions for batch delivery',
      '  batch-phase-done        Record phase completion (validates + attaches evidence)',
      '',
    ].join('\n'),
  );
}

export function main(argv = process.argv.slice(2)) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const [command, ...args] = normalizedArgv;
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }
  const runner = COMMANDS[command];
  if (!runner) {
    process.stderr.write(`unknown nimi-coding command: ${command}\n`);
    usage();
    process.exit(1);
  }
  runner(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
