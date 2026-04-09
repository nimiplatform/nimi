#!/usr/bin/env node
import path from 'node:path';
import { run as runAcceptanceSkeleton } from './commands/acceptance-skeleton.mjs';
import { run as runAttachEvidence } from './commands/attach-evidence.mjs';
import { run as runBatchPhaseDone } from './commands/batch-phase-done.mjs';
import { run as runBatchPreflight } from './commands/batch-preflight.mjs';
import { run as runBatchNextPhase } from './commands/batch-next-phase.mjs';
import { run as runFindingSetStatus } from './commands/finding-set-status.mjs';
import { run as runInitTopic } from './commands/init-topic.mjs';
import { run as runPromptSkeleton } from './commands/prompt-skeleton.mjs';
import { run as runConfirm } from './commands/run-confirm.mjs';
import { run as runAck } from './commands/run-ack.mjs';
import { run as runAckStatus } from './commands/run-ack-status.mjs';
import { run as runIngest } from './commands/run-ingest.mjs';
import { run as runLoopOnce } from './commands/run-loop-once.mjs';
import { run as runNextPrompt } from './commands/run-next-prompt.mjs';
import { run as runNotify } from './commands/run-notify.mjs';
import { run as runNotifyTelegram } from './commands/run-notify-telegram.mjs';
import { run as runNotifyWebhook } from './commands/run-notify-webhook.mjs';
import { run as runNotifications } from './commands/run-notifications.mjs';
import { run as runReview } from './commands/run-review.mjs';
import { run as runResume } from './commands/run-resume.mjs';
import { run as runScheduleOnce } from './commands/run-schedule-once.mjs';
import { run as runScheduleCodexBridge } from './commands/run-schedule-codex-bridge.mjs';
import { run as runScheduleCodexOnce } from './commands/run-schedule-codex-once.mjs';
import { run as runScheduleCodexAutomationUpsert } from './commands/run-schedule-codex-automation-upsert.mjs';
import { run as runScheduleCodexSetup } from './commands/run-schedule-codex-setup.mjs';
import { run as runScheduleStatus } from './commands/run-schedule-status.mjs';
import { run as runStart } from './commands/run-start.mjs';
import { run as runStatus } from './commands/run-status.mjs';
import { run as runUntilBlocked } from './commands/run-until-blocked.mjs';
import { run as runSetBaseline } from './commands/set-baseline.mjs';
import { run as runSetTopicStatus } from './commands/set-topic-status.mjs';
import { run as runTopicSummary } from './commands/topic-summary.mjs';
import { run as runUnresolvedFindings } from './commands/unresolved-findings.mjs';
import { run as runValidateAcceptance } from './commands/validate-acceptance.mjs';
import { run as runValidateDoc } from './commands/validate-doc.mjs';
import { run as runValidateExecutionPacket } from './commands/validate-execution-packet.mjs';
import { run as runValidateFindingLedger } from './commands/validate-finding-ledger.mjs';
import { run as runValidateModule } from './commands/validate-module.mjs';
import { run as runValidateNotificationPayload } from './commands/validate-notification-payload.mjs';
import { run as runValidateOrchestrationState } from './commands/validate-orchestration-state.mjs';
import { run as runValidatePrompt } from './commands/validate-prompt.mjs';
import { run as runValidateTopic } from './commands/validate-topic.mjs';
import { run as runValidateWorkerOutput } from './commands/validate-worker-output.mjs';

const COMMANDS = {
  'acceptance-skeleton': runAcceptanceSkeleton,
  'attach-evidence': runAttachEvidence,
  'batch-phase-done': runBatchPhaseDone,
  'batch-preflight': runBatchPreflight,
  'batch-next-phase': runBatchNextPhase,
  'finding-set-status': runFindingSetStatus,
  'init-topic': runInitTopic,
  'prompt-skeleton': runPromptSkeleton,
  'run-ack': runAck,
  'run-ack-status': runAckStatus,
  'run-confirm': runConfirm,
  'run-ingest': runIngest,
  'run-loop-once': runLoopOnce,
  'run-next-prompt': runNextPrompt,
  'run-notify': runNotify,
  'run-notify-telegram': runNotifyTelegram,
  'run-notify-webhook': runNotifyWebhook,
  'run-notifications': runNotifications,
  'run-review': runReview,
  'run-resume': runResume,
  'run-schedule-once': runScheduleOnce,
  'run-schedule-codex-bridge': runScheduleCodexBridge,
  'run-schedule-codex-once': runScheduleCodexOnce,
  'run-schedule-codex-automation-upsert': runScheduleCodexAutomationUpsert,
  'run-schedule-codex-setup': runScheduleCodexSetup,
  'run-schedule-status': runScheduleStatus,
  'run-start': runStart,
  'run-status': runStatus,
  'run-until-blocked': runUntilBlocked,
  'set-baseline': runSetBaseline,
  'set-topic-status': runSetTopicStatus,
  'topic-summary': runTopicSummary,
  'unresolved-findings': runUnresolvedFindings,
  'validate-acceptance': runValidateAcceptance,
  'validate-doc': runValidateDoc,
  'validate-execution-packet': runValidateExecutionPacket,
  'validate-finding-ledger': runValidateFindingLedger,
  'validate-module': runValidateModule,
  'validate-notification-payload': runValidateNotificationPayload,
  'validate-orchestration-state': runValidateOrchestrationState,
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
      '  validate-execution-packet Validate an execution-packet artifact',
      '  validate-orchestration-state Validate an orchestration-state artifact',
      '  validate-prompt         Validate a prompt artifact',
      '  validate-worker-output  Validate a worker-output artifact',
      '  validate-acceptance     Validate an acceptance artifact',
      '  validate-finding-ledger Validate a finding ledger',
      '  validate-module         Validate the nimi-coding module itself',
      '  validate-notification-payload Validate a transport-agnostic notification payload artifact',
      '',
      'Assist:',
      '  topic-summary           Structured topic overview (status, findings, refs)',
      '  unresolved-findings     List active/deferred findings from ledger',
      '  prompt-skeleton         Generate dispatch prompt skeleton from topic state',
      '  acceptance-skeleton     Generate acceptance skeleton with disposition',
      '',
      'Continuous Run:',
      '  run-start               Create or replace a terminal orchestration state with a running packet-bound run',
      '  run-status              Show packet-bound run status (or conceptual idle when no run exists)',
      '  run-next-prompt         Generate the current phase prompt from frozen packet + topic state',
      '  run-loop-once          Generate prompt, invoke codex exec, ingest worker signal/output, and emit a stable structured summary for one running phase',
      '  run-until-blocked      Keep executing provider-backed phases until pause/fail/completed/superseded or loop guard refusal, with stable structured summary output',
      '  run-schedule-status    Inspect one topic for foreground scheduler eligibility, operational lease state, and refusal/preflight status',
      '  run-schedule-once      Acquire an operational lease, invoke run-until-blocked once in the foreground, release on normal exit, and emit a stable scheduler result',
      '  run-schedule-codex-bridge Compose one-topic Codex automation setup + create/update into one assistant/UI-facing bridge result; convenience only, not a scheduler owner',
      '  run-schedule-codex-once Thin Codex automation backend wrapper over run-schedule-once; preserves scheduler-result.v1 and never owns loop semantics',
      '  run-schedule-codex-setup Emit the one-topic Codex automation setup payload: explicit topic path, repo cwd, exact scheduler commands, and expected contracts',
      '  run-schedule-codex-automation-upsert Create or update one Codex automation instance for one explicit topic from the setup payload; no repo scanning, no scheduler semantics',
      '  run-ingest              Ingest worker output, run required checks, update state, and emit local notifications',
      '  run-ack-status          Read transport-local checkpoint state for one consumer and run',
      '  run-ack                 Persist transport-local checkpoint progress to one cursor for one consumer and run',
      '  run-notify              Deliver handoff entries to the file-sink adapter and ack only after each successful delivery',
      '  run-notify-telegram     Deliver handoff entries to one Telegram chat and ack only after each successful Telegram send',
      '  run-notify-webhook      POST handoff entries to one webhook endpoint and ack only after each successful 2xx delivery',
      '  run-notifications       Read one run-scoped local notification log as cursor-annotated handoff entries, optionally replaying after a cursor or consumer ack',
      '  run-review              Manager-reviewed phase attempt closeout: validate worker output + acceptance, record complete/partial/deferred, and keep or advance the frozen phase route',
      '  run-resume              Resume a paused run when packet resume_policy allows it',
      '  run-confirm             Optionally attach final evidence and close the topic after manager-owned terminal completion',
      '',
      'Batch:',
      '  batch-preflight         Validate frozen-plan preconditions for batch delivery',
      '  batch-next-phase        Print the next packet-declared phase view',
      '  batch-phase-done        Record phase completion (validates + attaches evidence)',
      '',
    ].join('\n'),
  );
}

export async function main(argv = process.argv.slice(2)) {
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
  await runner(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`nimi-coding: ${String(error.message || error)}\n`);
    process.exit(1);
  });
}
