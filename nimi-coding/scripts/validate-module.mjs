#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadYamlFile, exists, timestampNow } from './lib/doc-utils.mjs';
import { moduleRootFrom } from './lib/module-paths.mjs';
import { ackNotificationCheckpoint, readNotificationCheckpoint, readNotificationsAfterAck } from './lib/notification-checkpoint.mjs';
import { runNotifyFileSink } from './lib/notification-file-sink.mjs';
import { readNotificationLog } from './lib/notification-log.mjs';
import { runNotifyTelegram } from './lib/notification-telegram.mjs';
import { runNotifyWebhook } from './lib/notification-webhook.mjs';
import { buildCodexAutomationSetup } from './lib/scheduler-automation-setup.mjs';
import { bridgeCodexAutomationForTopic } from './lib/scheduler-automation-bridge.mjs';
import { upsertCodexAutomationForTopic, upsertCodexAutomationFromSetup } from './lib/scheduler-automation-upsert.mjs';
import { runScheduleOnce, runScheduleStatus } from './lib/scheduler-foreground.mjs';
import { acquireSchedulerLease, schedulerLeaseRelPath } from './lib/scheduler-lease.mjs';
import { validateAcceptance, validateDoc, validateExecutionPacket, validateFindingLedger, validateNotificationPayload, validateOrchestrationState, validatePrompt, validateTopic, validateWorkerOutput } from './lib/validators.mjs';
import { batchNextPhase, batchPreflight } from './lib/batch-delivery.mjs';
import { runConfirm, runIngest, runLoopOnce, runNextPrompt, runResume, runStart, runStatus, runUntilBlocked } from './lib/continuous-delivery.mjs';

const REQUIRED_FILES = [
  'README.md',
  'contracts/methodology.contract.md',
  'contracts/artifact-model.contract.md',
  'contracts/staged-delivery.contract.md',
  'contracts/finding-lifecycle.contract.md',
  'schema/topic-index.schema.yaml',
  'schema/explore-doc.schema.yaml',
  'schema/baseline-doc.schema.yaml',
  'schema/evidence-doc.schema.yaml',
  'schema/finding-ledger.schema.yaml',
  'schema/execution-packet.schema.yaml',
  'schema/orchestration-state.schema.yaml',
  'schema/notification-payload.schema.yaml',
  'schema/prompt.schema.yaml',
  'schema/worker-output.schema.yaml',
  'schema/acceptance.schema.yaml',
  'protocol/execution-packet.protocol.yaml',
  'protocol/orchestration-state.protocol.yaml',
  'protocol/notification-payload.protocol.yaml',
  'protocol/notification-log.protocol.yaml',
  'protocol/notification-handoff.protocol.yaml',
  'protocol/notification-ack-checkpoint.protocol.yaml',
  'protocol/notification-telegram-adapter.protocol.yaml',
  'protocol/notification-webhook-adapter.protocol.yaml',
  'protocol/dispatch.protocol.yaml',
  'protocol/provider-worker-execution.protocol.yaml',
  'protocol/worker-output.protocol.yaml',
  'protocol/worker-runner-signal.protocol.yaml',
  'protocol/acceptance.protocol.yaml',
  'protocol/phase-lifecycle.protocol.yaml',
  'protocol/reopen-defer.protocol.yaml',
  'gates/gate-policy.yaml',
  'gates/promotion-policy.yaml',
  'samples/minimum-topic/topic.index.yaml',
  'samples/minimum-topic/overview.explore.md',
  'samples/minimum-topic/methodology.baseline.md',
  'samples/minimum-topic/sample.execution-packet.yaml',
  'samples/minimum-topic/sample.orchestration-state.yaml',
  'samples/minimum-topic/audit.evidence.md',
  'samples/minimum-topic/final.audit.evidence.md',
  'samples/minimum-topic/finding-ledger.yaml',
  'samples/minimum-topic/sample-phase.prompt.md',
  'samples/minimum-topic/sample-phase.worker-output.md',
  'samples/minimum-topic/sample-phase.acceptance.md',
  'samples/minimum-topic/.nimi-coding/notifications/run-paused.notification.yaml',
  'samples/minimum-topic/.nimi-coding/notifications/run-failed.notification.yaml',
  'samples/minimum-topic/.nimi-coding/notifications/awaiting-final-confirmation.notification.yaml',
  'samples/minimum-topic/.nimi-coding/notifications/minimum-topic-run-v1.jsonl',
  'cli/cli.mjs',
  'cli/commands/run-start.mjs',
  'cli/commands/run-status.mjs',
  'cli/commands/run-next-prompt.mjs',
  'cli/commands/run-loop-once.mjs',
  'cli/commands/run-schedule-once.mjs',
  'cli/commands/run-schedule-codex-once.mjs',
  'cli/commands/run-schedule-codex-bridge.mjs',
  'cli/commands/run-schedule-codex-setup.mjs',
  'cli/commands/run-schedule-codex-automation-upsert.mjs',
  'cli/commands/run-schedule-status.mjs',
  'cli/commands/run-until-blocked.mjs',
  'cli/commands/run-ingest.mjs',
  'cli/commands/run-ack-status.mjs',
  'cli/commands/run-ack.mjs',
  'cli/commands/run-notify.mjs',
  'cli/commands/run-notify-telegram.mjs',
  'cli/commands/run-notify-webhook.mjs',
  'cli/commands/run-notifications.mjs',
  'cli/commands/run-resume.mjs',
  'cli/commands/run-confirm.mjs',
  'cli/commands/validate-notification-payload.mjs',
  'scripts/batch-next-phase.mjs',
  'scripts/run-start.mjs',
  'scripts/run-status.mjs',
  'scripts/run-next-prompt.mjs',
  'scripts/run-loop-once.mjs',
  'scripts/run-schedule-once.mjs',
  'scripts/run-schedule-codex-once.mjs',
  'scripts/run-schedule-codex-bridge.mjs',
  'scripts/run-schedule-codex-setup.mjs',
  'scripts/run-schedule-codex-automation-upsert.mjs',
  'scripts/run-schedule-status.mjs',
  'scripts/run-until-blocked.mjs',
  'scripts/run-ingest.mjs',
  'scripts/run-ack-status.mjs',
  'scripts/run-ack.mjs',
  'scripts/run-notify.mjs',
  'scripts/run-notify-telegram.mjs',
  'scripts/run-notify-webhook.mjs',
  'scripts/run-notifications.mjs',
  'scripts/run-resume.mjs',
  'scripts/run-confirm.mjs',
  'scripts/lib/continuous-delivery.mjs',
  'scripts/lib/notification-checkpoint.mjs',
  'scripts/lib/notification-file-sink.mjs',
  'scripts/lib/notification-log.mjs',
  'scripts/lib/notification-telegram.mjs',
  'scripts/lib/notification-webhook.mjs',
  'scripts/lib/scheduler-automation-codex.mjs',
  'scripts/lib/scheduler-automation-bridge.mjs',
  'scripts/lib/scheduler-automation-setup.mjs',
  'scripts/lib/scheduler-automation-upsert.mjs',
  'scripts/lib/scheduler-foreground.mjs',
  'scripts/lib/scheduler-lease.mjs',
  'scripts/validate-execution-packet.mjs',
  'scripts/validate-orchestration-state.mjs',
  'scripts/validate-notification-payload.mjs',
  'scripts/report-ai-hotspots.mjs',
  'scripts/report-ai-structure-hotspots.mjs',
];

const SCHEMA_FILES = [
  'schema/topic-index.schema.yaml',
  'schema/explore-doc.schema.yaml',
  'schema/baseline-doc.schema.yaml',
  'schema/evidence-doc.schema.yaml',
  'schema/finding-ledger.schema.yaml',
  'schema/execution-packet.schema.yaml',
  'schema/orchestration-state.schema.yaml',
  'schema/notification-payload.schema.yaml',
  'schema/prompt.schema.yaml',
  'schema/worker-output.schema.yaml',
  'schema/acceptance.schema.yaml',
];

const PROTOCOL_FILES = [
  'protocol/execution-packet.protocol.yaml',
  'protocol/orchestration-state.protocol.yaml',
  'protocol/notification-payload.protocol.yaml',
  'protocol/notification-log.protocol.yaml',
  'protocol/notification-handoff.protocol.yaml',
  'protocol/notification-ack-checkpoint.protocol.yaml',
  'protocol/notification-telegram-adapter.protocol.yaml',
  'protocol/notification-webhook-adapter.protocol.yaml',
  'protocol/dispatch.protocol.yaml',
  'protocol/provider-worker-execution.protocol.yaml',
  'protocol/worker-output.protocol.yaml',
  'protocol/worker-runner-signal.protocol.yaml',
  'protocol/acceptance.protocol.yaml',
  'protocol/phase-lifecycle.protocol.yaml',
  'protocol/reopen-defer.protocol.yaml',
];

function fail(message, errors) {
  errors.push(message);
}

function checkRequiredFiles(moduleRoot, errors) {
  for (const relPath of REQUIRED_FILES) {
    const absPath = path.join(moduleRoot, relPath);
    if (!exists(absPath)) {
      fail(`missing module file: ${relPath}`, errors);
    }
  }
}

function checkYamlObject(filePath, errors, requiredKeys) {
  const relPath = path.relative(process.cwd(), filePath) || filePath;
  let doc;
  try {
    doc = loadYamlFile(filePath);
  } catch (error) {
    fail(`invalid YAML in ${relPath}: ${String(error)}`, errors);
    return;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(`YAML root must be a mapping: ${relPath}`, errors);
    return;
  }
  for (const key of requiredKeys) {
    if (!(key in doc)) {
      fail(`missing key "${key}" in ${relPath}`, errors);
    }
  }
}

function checkSchemaFiles(moduleRoot, errors) {
  for (const relPath of SCHEMA_FILES) {
    checkYamlObject(path.join(moduleRoot, relPath), errors, ['id', 'kind']);
  }
}

function checkProtocolFiles(moduleRoot, errors) {
  for (const relPath of PROTOCOL_FILES) {
    checkYamlObject(path.join(moduleRoot, relPath), errors, ['id', 'purpose']);
  }
}

function checkGateFiles(moduleRoot, errors) {
  checkYamlObject(path.join(moduleRoot, 'gates/gate-policy.yaml'), errors, ['hard_gates', 'soft_gates', 'advisory']);
  checkYamlObject(path.join(moduleRoot, 'gates/promotion-policy.yaml'), errors, [
    'local_incubator_root',
    'promoted_root',
    'promotable',
    'promotion_requirements',
  ]);
}

function checkSample(moduleRoot, errors, warnings) {
  const sampleDir = path.join(moduleRoot, 'samples/minimum-topic');
  const topicReport = validateTopic(sampleDir);
  warnings.push(...topicReport.warnings.map((warning) => `sample topic warning: ${warning}`));
  errors.push(...topicReport.errors.map((error) => `sample topic invalid: ${error}`));

  for (const relPath of ['overview.explore.md', 'methodology.baseline.md', 'audit.evidence.md', 'final.audit.evidence.md']) {
    const report = validateDoc(path.join(sampleDir, relPath));
    warnings.push(...report.warnings.map((warning) => `sample doc ${relPath}: ${warning}`));
    errors.push(...report.errors.map((error) => `sample doc ${relPath}: ${error}`));
  }

  const ledgerReport = validateFindingLedger(path.join(sampleDir, 'finding-ledger.yaml'), { topicDir: sampleDir });
  warnings.push(...ledgerReport.warnings.map((warning) => `sample ledger warning: ${warning}`));
  errors.push(...ledgerReport.errors.map((error) => `sample ledger invalid: ${error}`));

  const executionPacketReport = validateExecutionPacket(path.join(sampleDir, 'sample.execution-packet.yaml'), { topicDir: sampleDir });
  warnings.push(...executionPacketReport.warnings.map((warning) => `sample execution-packet warning: ${warning}`));
  errors.push(...executionPacketReport.errors.map((error) => `sample execution-packet invalid: ${error}`));

  const orchestrationStateReport = validateOrchestrationState(path.join(sampleDir, 'sample.orchestration-state.yaml'), { topicDir: sampleDir });
  warnings.push(...orchestrationStateReport.warnings.map((warning) => `sample orchestration-state warning: ${warning}`));
  errors.push(...orchestrationStateReport.errors.map((error) => `sample orchestration-state invalid: ${error}`));

  const preflightReport = batchPreflight(sampleDir);
  warnings.push(...preflightReport.warnings.map((warning) => `sample batch-preflight warning: ${warning}`));
  errors.push(...preflightReport.errors.map((error) => `sample batch-preflight invalid: ${error}`));

  const nextPhaseReport = batchNextPhase(sampleDir);
  warnings.push(...nextPhaseReport.warnings.map((warning) => `sample batch-next-phase warning: ${warning}`));
  errors.push(...nextPhaseReport.errors.map((error) => `sample batch-next-phase invalid: ${error}`));

  const promptReport = validatePrompt(path.join(sampleDir, 'sample-phase.prompt.md'));
  warnings.push(...promptReport.warnings.map((warning) => `sample prompt warning: ${warning}`));
  errors.push(...promptReport.errors.map((error) => `sample prompt invalid: ${error}`));

  const workerOutputReport = validateWorkerOutput(path.join(sampleDir, 'sample-phase.worker-output.md'));
  warnings.push(...workerOutputReport.warnings.map((warning) => `sample worker-output warning: ${warning}`));
  errors.push(...workerOutputReport.errors.map((error) => `sample worker-output invalid: ${error}`));

  const acceptanceReport = validateAcceptance(path.join(sampleDir, 'sample-phase.acceptance.md'));
  warnings.push(...acceptanceReport.warnings.map((warning) => `sample acceptance warning: ${warning}`));
  errors.push(...acceptanceReport.errors.map((error) => `sample acceptance invalid: ${error}`));

  for (const relPath of [
    '.nimi-coding/notifications/run-paused.notification.yaml',
    '.nimi-coding/notifications/run-failed.notification.yaml',
    '.nimi-coding/notifications/awaiting-final-confirmation.notification.yaml',
  ]) {
    const report = validateNotificationPayload(path.join(sampleDir, relPath), { topicDir: sampleDir });
    warnings.push(...report.warnings.map((warning) => `sample notification warning (${relPath}): ${warning}`));
    errors.push(...report.errors.map((error) => `sample notification invalid (${relPath}): ${error}`));
  }

  const logReport = readNotificationLog(sampleDir, { runId: 'minimum-topic-run-v1' });
  warnings.push(...(logReport.warnings || []).map((warning) => `sample notification-log warning: ${warning}`));
  if (!logReport.ok) {
    errors.push(...(logReport.errors || []).map((error) => `sample notification-log invalid: ${error}`));
  } else if (!logReport.exists || logReport.entry_count !== 2) {
    errors.push(`sample notification-log expected 2 entries, got exists=${logReport.exists} entry_count=${logReport.entry_count}`);
  } else if (logReport.returned_entry_count !== 2 || logReport.entries[0]?.cursor !== 1 || logReport.entries[1]?.cursor !== 2) {
    errors.push('sample notification-log expected cursor-annotated entries 1..2');
  }

  const replayReport = readNotificationLog(sampleDir, { runId: 'minimum-topic-run-v1', afterCursor: 1 });
  warnings.push(...(replayReport.warnings || []).map((warning) => `sample notification replay warning: ${warning}`));
  if (!replayReport.ok) {
    errors.push(...(replayReport.errors || []).map((error) => `sample notification replay invalid: ${error}`));
  } else if (replayReport.returned_entry_count !== 1 || replayReport.entries[0]?.cursor !== 2) {
    errors.push('sample notification replay expected exactly cursor 2 after after_cursor=1');
  }

  const ackStatusReport = readNotificationCheckpoint(sampleDir, {
    consumerId: 'sample-consumer',
    runId: 'minimum-topic-run-v1',
  });
  warnings.push(...(ackStatusReport.warnings || []).map((warning) => `sample ack-status warning: ${warning}`));
  if (!ackStatusReport.ok) {
    errors.push(...(ackStatusReport.errors || []).map((error) => `sample ack-status invalid: ${error}`));
  } else if (ackStatusReport.exists || ackStatusReport.last_acked_cursor !== 0) {
    errors.push('sample ack-status expected missing checkpoint with last_acked_cursor=0');
  }
}

function writeCloseoutWorkerOutput(sampleDir) {
  const filePath = path.join(sampleDir, 'sample-closeout.worker-output.md');
  writeWorkerOutputWithSignal(filePath, {
    title: 'Sample Closeout Worker Output',
    findings: [
      'Terminal packet phase has no further next_on_success target.',
      'Final human confirmation is now the only remaining action.',
    ],
    implementationSummary: [
      'Consumed the terminal phase dispatch.',
      'Returned the minimum structured output required for mechanical closeout.',
    ],
    filesChanged: ['`sample-closeout.worker-output.md`'],
    checksRun: ['`pnpm nimi-coding:validate-topic -- <temp-sample-dir>`'],
    remainingGaps: ['Final human confirmation still remains intentionally manual.'],
    signal: {
      result_kind: 'complete',
      worker_output_ref: 'sample-closeout.worker-output.md',
      evidence_refs: [],
      escalation_reasons: [],
      fail_reason: null,
    },
  });
}

function writeWorkerOutputWithSignal(filePath, options) {
  const signalLines = [
    '```yaml',
    `result_kind: ${options.signal.result_kind}`,
    `worker_output_ref: ${options.signal.worker_output_ref}`,
    `evidence_refs: ${JSON.stringify(options.signal.evidence_refs || [])}`,
    `escalation_reasons: ${JSON.stringify(options.signal.escalation_reasons || [])}`,
    `fail_reason: ${options.signal.fail_reason === null ? 'null' : JSON.stringify(options.signal.fail_reason)}`,
    '```',
  ];
  fs.writeFileSync(
    filePath,
    [
      `# ${options.title}`,
      '',
      '## Findings',
      '',
      ...options.findings.map((line) => `- ${line}`),
      '',
      '## Implementation summary',
      '',
      ...options.implementationSummary.map((line) => `- ${line}`),
      '',
      '## Files changed',
      '',
      ...options.filesChanged.map((line) => `- ${line}`),
      '',
      '## Checks run',
      '',
      ...options.checksRun.map((line) => `- ${line}`),
      '',
      '## Remaining gaps / risks',
      '',
      ...options.remainingGaps.map((line) => `- ${line}`),
      '',
      '## Runner Signal',
      '',
      ...signalLines,
      '',
    ].join('\n'),
    'utf8',
  );
}

function createProviderInvoker(writeOutput, providerResult = {}) {
  return ({ workerOutputAbsPath, workerOutputRef, phase }) => {
    writeOutput({ workerOutputAbsPath, workerOutputRef, phase });
    return {
      ok: true,
      provider_id: 'codex exec',
      command: ['codex', 'exec'],
      stdout: '',
      stderr: '',
      exit_code: 0,
      timed_out: false,
      reason: null,
      ...providerResult,
    };
  };
}

function createPhaseProviderInvoker(writersByPhase, providerResult = {}) {
  return ({ workerOutputAbsPath, workerOutputRef, phase }) => {
    const writer = writersByPhase[phase.phase_id];
    if (!writer) {
      throw new Error(`missing provider smoke writer for phase ${phase.phase_id}`);
    }
    writer({ workerOutputAbsPath, workerOutputRef, phase });
    return {
      ok: true,
      provider_id: 'codex exec',
      command: ['codex', 'exec'],
      stdout: '',
      stderr: '',
      exit_code: 0,
      timed_out: false,
      reason: null,
      ...providerResult,
    };
  };
}

function prepareProviderSmokeDir(sampleDir, tempRoot, suffix) {
  const targetDir = path.join(tempRoot, suffix);
  fs.cpSync(sampleDir, targetDir, { recursive: true });
  patchSmokeChecks(targetDir);
  writeCloseoutWorkerOutput(targetDir);
  return targetDir;
}

function patchSmokeChecks(sampleDir) {
  const packetPath = path.join(sampleDir, 'sample.execution-packet.yaml');
  const packet = loadYamlFile(packetPath);
  for (const phase of packet.phases || []) {
    phase.required_checks = [`pnpm nimi-coding:validate-topic -- ${sampleDir}`];
    phase.write_scope = [sampleDir];
  }
  fs.writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
}

async function startWebhookSmokeServer(responder) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += String(chunk);
    }
    requests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body,
    });
    responder(req, res, body);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  return {
    requests,
    baseUrl: `http://127.0.0.1:${address.port}`,
    endpoint: `http://127.0.0.1:${address.port}/hook`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function writeEnvFile(filePath, pairs) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = [];
  for (const [key, value] of pairs) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function runValidatorCli(moduleRoot, validatorCommand, targetPath) {
  const result = spawnSync(
    'node',
    [path.join(moduleRoot, 'cli', 'cli.mjs'), validatorCommand, targetPath],
    {
      cwd: moduleRoot,
      encoding: 'utf8',
    },
  );
  let parsed = null;
  const stdout = String(result.stdout || '').trim();
  if (stdout.length > 0) {
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      parsed = { parse_error: String(error.message || error), raw_stdout: stdout };
    }
  }
  return {
    command: validatorCommand,
    status: result.status,
    stdout,
    stderr: String(result.stderr || '').trim(),
    parsed,
  };
}

function runNimiCodingCli(moduleRoot, command, args = []) {
  const result = spawnSync(
    'node',
    [path.join(moduleRoot, 'cli', 'cli.mjs'), command, ...args],
    {
      cwd: path.join(moduleRoot, '..'),
      encoding: 'utf8',
    },
  );
  let parsed = null;
  const stdout = String(result.stdout || '').trim();
  if (stdout.length > 0) {
    try {
      parsed = JSON.parse(stdout);
    } catch (error) {
      parsed = { parse_error: String(error.message || error), raw_stdout: stdout };
    }
  }
  return {
    command,
    args,
    status: result.status,
    stdout,
    stderr: String(result.stderr || '').trim(),
    parsed,
  };
}

function offsetTimestamp(isoTimestamp, offsetMs) {
  return new Date(Date.parse(isoTimestamp) + offsetMs).toISOString();
}

async function checkContinuousRunSmoke(moduleRoot, errors, warnings) {
  const sampleDir = path.join(moduleRoot, 'samples/minimum-topic');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-coding-smoke-'));
  const tempSampleDir = path.join(tempRoot, 'minimum-topic');
  fs.cpSync(sampleDir, tempSampleDir, { recursive: true });
  patchSmokeChecks(tempSampleDir);
  writeCloseoutWorkerOutput(tempSampleDir);
  const webhookSuccessServer = await startWebhookSmokeServer((req, res) => {
    res.statusCode = 204;
    res.end();
  });
  const webhookFailureServer = await startWebhookSmokeServer((req, res) => {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('upstream failure');
  });
  const webhookBadJsonServer = await startWebhookSmokeServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end('{not-json');
  });
  const telegramSuccessServer = await startWebhookSmokeServer((req, res, body) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      result: {
        message_id: 1,
        echo_length: body.length,
      },
    }));
  });
  const telegramFailureServer = await startWebhookSmokeServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      description: 'chat not available',
    }));
  });
  const telegramBadJsonServer = await startWebhookSmokeServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end('{not-json');
  });

  try {
  const telegramEnvRootPath = path.join(tempRoot, 'telegram-root.env');
  const telegramEnvModulePath = path.join(tempRoot, 'telegram-module.env');
  const telegramEnvPaths = [telegramEnvRootPath, telegramEnvModulePath];
  writeEnvFile(telegramEnvRootPath, [
    ['TG_BOT_TOKEN', '123456:rootRootRootRootRoot__'],
    ['TG_CHAT_ID', '123456'],
  ]);
  writeEnvFile(telegramEnvModulePath, [
    ['TG_BOT_TOKEN', '654321:moduleModuleModuleMod'],
    ['TG_CHAT_ID', '-1009876543210'],
  ]);
  const missingTelegramEnvPaths = [
    path.join(tempRoot, 'missing-root.env'),
    path.join(tempRoot, 'missing-module.env'),
  ];

  const validatorMissingWorkerOutputDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-missing-worker-output');
  const validatorMissingWorkerOutputPath = path.join(validatorMissingWorkerOutputDir, 'sample-phase.worker-output.md');
  fs.rmSync(validatorMissingWorkerOutputPath);
  const validatorMissingWorkerOutput = validateWorkerOutput(validatorMissingWorkerOutputPath, {
    topicDir: validatorMissingWorkerOutputDir,
    expectedWorkerOutputRef: 'sample-phase.worker-output.md',
  });
  if (validatorMissingWorkerOutput.ok || validatorMissingWorkerOutput.refusal?.code !== 'WORKER_OUTPUT_MISSING') {
    errors.push('validator smoke expected WORKER_OUTPUT_MISSING refusal from validateWorkerOutput');
    return;
  }

  const validatorInvalidWorkerOutputDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-invalid-worker-output');
  const validatorInvalidWorkerOutputPath = path.join(validatorInvalidWorkerOutputDir, 'sample-phase.worker-output.md');
  writeWorkerOutputWithSignal(validatorInvalidWorkerOutputPath, {
    title: 'Validator Invalid Worker Output',
    findings: ['One required worker-output section is intentionally missing.'],
    implementationSummary: ['This fixture should classify as WORKER_OUTPUT_INVALID.'],
    filesChanged: ['`sample-phase.worker-output.md`'],
    checksRun: ['`pnpm nimi-coding:validate-topic -- <validator-invalid-worker-output-dir>`'],
    remainingGaps: ['The worker-output artifact is structurally incomplete.'],
    signal: {
      result_kind: 'complete',
      worker_output_ref: 'sample-phase.worker-output.md',
      evidence_refs: [],
      escalation_reasons: [],
      fail_reason: null,
    },
  });
  fs.writeFileSync(
    validatorInvalidWorkerOutputPath,
    fs.readFileSync(validatorInvalidWorkerOutputPath, 'utf8').replace(/\n## Checks run[\s\S]*?\n## Remaining gaps \/ risks\n/u, '\n## Remaining gaps / risks\n'),
    'utf8',
  );
  const validatorInvalidWorkerOutput = validateWorkerOutput(validatorInvalidWorkerOutputPath, {
    topicDir: validatorInvalidWorkerOutputDir,
    expectedWorkerOutputRef: 'sample-phase.worker-output.md',
  });
  if (validatorInvalidWorkerOutput.ok || validatorInvalidWorkerOutput.refusal?.code !== 'WORKER_OUTPUT_INVALID') {
    errors.push('validator smoke expected WORKER_OUTPUT_INVALID refusal from validateWorkerOutput');
    return;
  }

  const validatorMissingSignalDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-missing-signal');
  const validatorMissingSignalPath = path.join(validatorMissingSignalDir, 'sample-phase.worker-output.md');
  fs.writeFileSync(
    validatorMissingSignalPath,
    [
      '# Validator Missing Signal',
      '',
      '## Findings',
      '',
      '- Runner Signal is intentionally absent.',
      '',
      '## Implementation summary',
      '',
      '- This fixture should classify as RUNNER_SIGNAL_MISSING.',
      '',
      '## Files changed',
      '',
      '- `sample-phase.worker-output.md`',
      '',
      '## Checks run',
      '',
      '- `pnpm nimi-coding:validate-topic -- <validator-missing-signal-dir>`',
      '',
      '## Remaining gaps / risks',
      '',
      '- The validator must refuse this artifact.',
      '',
    ].join('\n'),
    'utf8',
  );
  const validatorMissingSignal = validateWorkerOutput(validatorMissingSignalPath, {
    topicDir: validatorMissingSignalDir,
    expectedWorkerOutputRef: 'sample-phase.worker-output.md',
  });
  if (validatorMissingSignal.ok || validatorMissingSignal.refusal?.code !== 'RUNNER_SIGNAL_MISSING') {
    errors.push('validator smoke expected RUNNER_SIGNAL_MISSING refusal from validateWorkerOutput');
    return;
  }

  const validatorInvalidSignalDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-invalid-signal');
  const validatorInvalidSignalPath = path.join(validatorInvalidSignalDir, 'sample-phase.worker-output.md');
  writeWorkerOutputWithSignal(validatorInvalidSignalPath, {
    title: 'Validator Invalid Signal',
    findings: ['Runner Signal uses an invalid result_kind.'],
    implementationSummary: ['This fixture should classify as RUNNER_SIGNAL_INVALID.'],
    filesChanged: ['`sample-phase.worker-output.md`'],
    checksRun: ['`pnpm nimi-coding:validate-topic -- <validator-invalid-signal-dir>`'],
    remainingGaps: ['The validator must reject the malformed signal payload.'],
    signal: {
      result_kind: 'bogus',
      worker_output_ref: 'sample-phase.worker-output.md',
      evidence_refs: [],
      escalation_reasons: [],
      fail_reason: null,
    },
  });
  const validatorInvalidSignal = validateWorkerOutput(validatorInvalidSignalPath, {
    topicDir: validatorInvalidSignalDir,
    expectedWorkerOutputRef: 'sample-phase.worker-output.md',
  });
  if (validatorInvalidSignal.ok || validatorInvalidSignal.refusal?.code !== 'RUNNER_SIGNAL_INVALID') {
    errors.push('validator smoke expected RUNNER_SIGNAL_INVALID refusal from validateWorkerOutput');
    return;
  }

  const validatorArtifactMismatchDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-artifact-mismatch');
  const validatorArtifactMismatchPath = path.join(validatorArtifactMismatchDir, 'sample-phase.worker-output.md');
  writeWorkerOutputWithSignal(validatorArtifactMismatchPath, {
    title: 'Validator Artifact Mismatch',
    findings: ['worker_output_ref intentionally mismatches the current artifact path.'],
    implementationSummary: ['This fixture should classify as RUNNER_SIGNAL_ARTIFACT_MISMATCH.'],
    filesChanged: ['`sample-phase.worker-output.md`'],
    checksRun: ['`pnpm nimi-coding:validate-topic -- <validator-artifact-mismatch-dir>`'],
    remainingGaps: ['The validator must fail-close on the mismatch.'],
    signal: {
      result_kind: 'complete',
      worker_output_ref: 'different.worker-output.md',
      evidence_refs: [],
      escalation_reasons: [],
      fail_reason: null,
    },
  });
  const validatorArtifactMismatch = validateWorkerOutput(validatorArtifactMismatchPath, {
    topicDir: validatorArtifactMismatchDir,
    expectedWorkerOutputRef: 'sample-phase.worker-output.md',
  });
  if (validatorArtifactMismatch.ok || validatorArtifactMismatch.refusal?.code !== 'RUNNER_SIGNAL_ARTIFACT_MISMATCH') {
    errors.push('validator smoke expected RUNNER_SIGNAL_ARTIFACT_MISMATCH refusal from validateWorkerOutput');
    return;
  }

  const cliPromptSuccess = runValidatorCli(moduleRoot, 'validate-prompt', path.join(sampleDir, 'sample-phase.prompt.md'));
  if (
    cliPromptSuccess.status !== 0
    || cliPromptSuccess.parsed?.contract !== 'validator-cli-result.v1'
    || cliPromptSuccess.parsed?.validator !== 'validate-prompt'
    || cliPromptSuccess.parsed?.target_ref !== path.join(sampleDir, 'sample-phase.prompt.md')
    || cliPromptSuccess.parsed?.ok !== true
    || !Array.isArray(cliPromptSuccess.parsed?.errors)
    || !Array.isArray(cliPromptSuccess.parsed?.warnings)
  ) {
    errors.push('validator CLI smoke expected stable success JSON from validate-prompt');
    return;
  }

  const invalidPromptDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-invalid-prompt');
  const invalidPromptPath = path.join(invalidPromptDir, 'sample-phase.prompt.md');
  fs.writeFileSync(
    invalidPromptPath,
    fs.readFileSync(invalidPromptPath, 'utf8').replace(/\n## Required Checks\n/gu, '\n## Removed Required Checks\n'),
    'utf8',
  );
  const cliPromptFailure = runValidatorCli(moduleRoot, 'validate-prompt', invalidPromptPath);
  if (
    cliPromptFailure.status === 0
    || cliPromptFailure.parsed?.contract !== 'validator-cli-result.v1'
    || cliPromptFailure.parsed?.validator !== 'validate-prompt'
    || cliPromptFailure.parsed?.ok !== false
    || !Array.isArray(cliPromptFailure.parsed?.errors)
    || cliPromptFailure.parsed?.errors.length === 0
  ) {
    errors.push('validator CLI smoke expected stable failure JSON from validate-prompt');
    return;
  }

  const cliAcceptanceSuccess = runValidatorCli(moduleRoot, 'validate-acceptance', path.join(sampleDir, 'sample-phase.acceptance.md'));
  if (
    cliAcceptanceSuccess.status !== 0
    || cliAcceptanceSuccess.parsed?.contract !== 'validator-cli-result.v1'
    || cliAcceptanceSuccess.parsed?.validator !== 'validate-acceptance'
    || cliAcceptanceSuccess.parsed?.target_ref !== path.join(sampleDir, 'sample-phase.acceptance.md')
    || cliAcceptanceSuccess.parsed?.ok !== true
    || !Array.isArray(cliAcceptanceSuccess.parsed?.errors)
    || !Array.isArray(cliAcceptanceSuccess.parsed?.warnings)
  ) {
    errors.push('validator CLI smoke expected stable success JSON from validate-acceptance');
    return;
  }

  const invalidAcceptanceDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'validator-invalid-acceptance');
  const invalidAcceptancePath = path.join(invalidAcceptanceDir, 'sample-phase.acceptance.md');
  fs.writeFileSync(
    invalidAcceptancePath,
    fs.readFileSync(invalidAcceptancePath, 'utf8').replace(/disposition:\s*complete/u, 'disposition: nonsense'),
    'utf8',
  );
  const cliAcceptanceFailure = runValidatorCli(moduleRoot, 'validate-acceptance', invalidAcceptancePath);
  if (
    cliAcceptanceFailure.status === 0
    || cliAcceptanceFailure.parsed?.contract !== 'validator-cli-result.v1'
    || cliAcceptanceFailure.parsed?.validator !== 'validate-acceptance'
    || cliAcceptanceFailure.parsed?.ok !== false
    || !Array.isArray(cliAcceptanceFailure.parsed?.errors)
    || cliAcceptanceFailure.parsed?.errors.length === 0
  ) {
    errors.push('validator CLI smoke expected stable failure JSON from validate-acceptance');
    return;
  }

  const cliMissingWorkerOutput = runValidatorCli(moduleRoot, 'validate-worker-output', validatorMissingWorkerOutputPath);
  if (cliMissingWorkerOutput.status === 0 || cliMissingWorkerOutput.parsed?.refusal?.code !== 'WORKER_OUTPUT_MISSING') {
    errors.push('validator CLI smoke expected WORKER_OUTPUT_MISSING refusal code from validate-worker-output');
    return;
  }
  if (cliMissingWorkerOutput.parsed?.refusal?.message !== 'worker-output artifact is missing') {
    errors.push('validator CLI smoke expected WORKER_OUTPUT_MISSING refusal message from validate-worker-output');
    return;
  }

  const cliInvalidWorkerOutput = runValidatorCli(moduleRoot, 'validate-worker-output', validatorInvalidWorkerOutputPath);
  if (cliInvalidWorkerOutput.status === 0 || cliInvalidWorkerOutput.parsed?.refusal?.code !== 'WORKER_OUTPUT_INVALID') {
    errors.push('validator CLI smoke expected WORKER_OUTPUT_INVALID refusal code from validate-worker-output');
    return;
  }

  const cliMissingSignal = runValidatorCli(moduleRoot, 'validate-worker-output', validatorMissingSignalPath);
  if (cliMissingSignal.status === 0 || cliMissingSignal.parsed?.refusal?.code !== 'RUNNER_SIGNAL_MISSING') {
    errors.push('validator CLI smoke expected RUNNER_SIGNAL_MISSING refusal code from validate-worker-output');
    return;
  }

  const cliInvalidSignal = runValidatorCli(moduleRoot, 'validate-worker-output', validatorInvalidSignalPath);
  if (cliInvalidSignal.status === 0 || cliInvalidSignal.parsed?.refusal?.code !== 'RUNNER_SIGNAL_INVALID') {
    errors.push('validator CLI smoke expected RUNNER_SIGNAL_INVALID refusal code from validate-worker-output');
    return;
  }

  const cliArtifactMismatch = runValidatorCli(moduleRoot, 'validate-worker-output', validatorArtifactMismatchPath);
  if (cliArtifactMismatch.status === 0 || cliArtifactMismatch.parsed?.refusal?.code !== 'RUNNER_SIGNAL_ARTIFACT_MISMATCH') {
    errors.push('validator CLI smoke expected RUNNER_SIGNAL_ARTIFACT_MISMATCH refusal code from validate-worker-output');
    return;
  }
  if (
    cliArtifactMismatch.parsed?.contract !== 'validator-cli-result.v1'
    || cliArtifactMismatch.parsed?.validator !== 'validate-worker-output'
    || cliArtifactMismatch.parsed?.ok !== false
  ) {
    errors.push('validator CLI smoke expected stable validator-cli-result.v1 structure from validate-worker-output');
    return;
  }

  const providerSuccessDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-success');
  const providerSuccessStart = runStart(providerSuccessDir, { runId: 'provider-success-run' });
  if (!providerSuccessStart.ok) {
    errors.push(`provider-backed smoke success run-start: ${(providerSuccessStart.errors || []).join('; ')}`);
    return;
  }
  const providerSuccess = runLoopOnce(providerSuccessDir, {
    providerInvoker: createProviderInvoker(
      ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Provider Success Worker Output',
          findings: ['Provider-backed execution completed the current bounded phase.'],
          implementationSummary: ['Wrote the expected worker output with a complete runner signal.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <provider-success-dir>`'],
          remainingGaps: ['Terminal closeout still belongs to later packet progression.'],
          signal: {
            result_kind: 'complete',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: null,
          },
        });
      },
      {
        stdout: `provider stdout ${'x'.repeat(4100)} TG_BOT_TOKEN=123456:secretsecretsecret`,
        stderr: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
      },
    ),
  });
  warnings.push(...(providerSuccess.warnings || []).map((warning) => `provider-backed smoke success: ${warning}`));
  if (!providerSuccess.ok) {
    errors.push(`provider-backed smoke success: ${(providerSuccess.errors || []).join('; ')}`);
    return;
  }
  if (providerSuccess.provider?.provider_id !== 'codex exec' || providerSuccess.run_status !== 'running' || providerSuccess.ingest?.next_phase?.phase_id !== 'sample-closeout') {
    errors.push('provider-backed smoke success expected codex exec path and progression to next running phase');
    return;
  }
  if (
    providerSuccess.summary?.outcome !== 'advanced'
    || providerSuccess.summary?.run_status !== 'running'
    || providerSuccess.summary?.signal_result_kind !== 'complete'
    || providerSuccess.summary?.refusal_code !== null
  ) {
    errors.push('provider-backed smoke success expected stable advanced summary with no refusal code');
    return;
  }
  if (
    providerSuccess.provider?.transcript?.stdout?.truncated !== true
    || providerSuccess.provider?.transcript?.stdout?.redacted !== true
    || providerSuccess.provider?.transcript?.stderr?.redacted !== true
    || providerSuccess.provider?.transcript?.policy?.raw_prompt_body_logged !== false
  ) {
    errors.push('provider-backed smoke success expected bounded and redacted provider transcript capture');
    return;
  }

  const providerEscalateDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-escalate');
  const providerEscalateStart = runStart(providerEscalateDir, { runId: 'provider-escalate-run' });
  if (!providerEscalateStart.ok) {
    errors.push(`provider-backed smoke escalate run-start: ${(providerEscalateStart.errors || []).join('; ')}`);
    return;
  }
  const providerEscalate = runLoopOnce(providerEscalateDir, {
    providerInvoker: createProviderInvoker(({ workerOutputAbsPath, workerOutputRef }) => {
      writeWorkerOutputWithSignal(workerOutputAbsPath, {
        title: 'Provider Escalate Worker Output',
        findings: ['Execution hit a packet-declared escalation condition.'],
        implementationSummary: ['Returned a strict escalate runner signal instead of continuing.'],
        filesChanged: [`\`${workerOutputRef}\``],
        checksRun: ['`pnpm nimi-coding:validate-topic -- <provider-escalate-dir>`'],
        remainingGaps: ['Manager action is still required before resume.'],
        signal: {
          result_kind: 'escalate',
          worker_output_ref: workerOutputRef,
          evidence_refs: [],
          escalation_reasons: ['authority conflict'],
          fail_reason: null,
        },
      });
    }),
  });
  warnings.push(...(providerEscalate.warnings || []).map((warning) => `provider-backed smoke escalate: ${warning}`));
  if (!providerEscalate.ok) {
    errors.push(`provider-backed smoke escalate: ${(providerEscalate.errors || []).join('; ')}`);
    return;
  }
  if (providerEscalate.run_status !== 'paused' || providerEscalate.ingest?.required_human_action !== 'resolve-escalation-and-resume') {
    errors.push('provider-backed smoke escalate expected paused state with resolve-escalation-and-resume action');
    return;
  }

  const providerFailDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-fail');
  const providerFailStart = runStart(providerFailDir, { runId: 'provider-fail-run' });
  if (!providerFailStart.ok) {
    errors.push(`provider-backed smoke fail run-start: ${(providerFailStart.errors || []).join('; ')}`);
    return;
  }
  const providerFail = runLoopOnce(providerFailDir, {
    providerInvoker: createProviderInvoker(({ workerOutputAbsPath, workerOutputRef }) => {
      writeWorkerOutputWithSignal(workerOutputAbsPath, {
        title: 'Provider Fail Worker Output',
        findings: ['Worker explicitly refused safe completion for this cycle.'],
        implementationSummary: ['Returned a fail runner signal with a concrete fail_reason.'],
        filesChanged: [`\`${workerOutputRef}\``],
        checksRun: ['`pnpm nimi-coding:validate-topic -- <provider-fail-dir>`'],
        remainingGaps: ['Manual repair or a new packet is required.'],
        signal: {
          result_kind: 'fail',
          worker_output_ref: workerOutputRef,
          evidence_refs: [],
          escalation_reasons: [],
          fail_reason: 'worker requested terminal failure',
        },
      });
    }),
  });
  warnings.push(...(providerFail.warnings || []).map((warning) => `provider-backed smoke fail: ${warning}`));
  if (!providerFail.ok) {
    errors.push(`provider-backed smoke fail: ${(providerFail.errors || []).join('; ')}`);
    return;
  }
  if (providerFail.run_status !== 'failed') {
    errors.push('provider-backed smoke fail expected run_status=failed');
    return;
  }

  const providerInvocationFailureDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-invocation-failure');
  const providerInvocationFailureStart = runStart(providerInvocationFailureDir, { runId: 'provider-invocation-failure-run' });
  if (!providerInvocationFailureStart.ok) {
    errors.push(`provider-backed smoke invocation-failure run-start: ${(providerInvocationFailureStart.errors || []).join('; ')}`);
    return;
  }
  const providerInvocationFailure = runLoopOnce(providerInvocationFailureDir, {
    providerInvoker: () => ({
      ok: false,
      provider_id: 'codex exec',
      command: ['codex', 'exec'],
      stdout: '',
      stderr: 'simulated provider failure',
      exit_code: 9,
      timed_out: false,
      reason: 'provider exited with status 9',
    }),
  });
  warnings.push(...(providerInvocationFailure.warnings || []).map((warning) => `provider-backed smoke invocation failure: ${warning}`));
  if (providerInvocationFailure.ok) {
    errors.push('provider-backed smoke invocation failure expected structured refusal');
    return;
  }
  if (providerInvocationFailure.refusal?.code !== 'PROVIDER_INVOCATION_FAILED' || providerInvocationFailure.provider?.ok !== false || providerInvocationFailure.run_status !== 'failed') {
    errors.push('provider-backed smoke invocation failure expected PROVIDER_INVOCATION_FAILED refusal with run_status=failed');
    return;
  }
  if (providerInvocationFailure.summary?.refusal_code !== 'PROVIDER_INVOCATION_FAILED' || providerInvocationFailure.summary?.outcome !== 'refusal') {
    errors.push('provider-backed smoke invocation failure expected stable refusal summary');
    return;
  }

  const providerTimeoutDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-timeout');
  const providerTimeoutStart = runStart(providerTimeoutDir, { runId: 'provider-timeout-run' });
  if (!providerTimeoutStart.ok) {
    errors.push(`provider-backed smoke timeout run-start: ${(providerTimeoutStart.errors || []).join('; ')}`);
    return;
  }
  const providerTimeout = runLoopOnce(providerTimeoutDir, {
    providerInvoker: () => ({
      ok: false,
      provider_id: 'codex exec',
      stdout: '',
      stderr: 'timed out',
      exit_code: null,
      timed_out: true,
      reason: 'provider timed out after 120000ms',
    }),
  });
  warnings.push(...(providerTimeout.warnings || []).map((warning) => `provider-backed smoke timeout: ${warning}`));
  if (providerTimeout.ok) {
    errors.push('provider-backed smoke timeout expected structured refusal');
    return;
  }
  if (providerTimeout.refusal?.code !== 'PROVIDER_TIMEOUT' || providerTimeout.provider?.timed_out !== true) {
    errors.push('provider-backed smoke timeout expected PROVIDER_TIMEOUT refusal and timed_out=true');
    return;
  }

  const malformedSignalDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-malformed-signal');
  const malformedSignalStart = runStart(malformedSignalDir, { runId: 'provider-malformed-signal-run' });
  if (!malformedSignalStart.ok) {
    errors.push(`provider-backed smoke malformed-signal run-start: ${(malformedSignalStart.errors || []).join('; ')}`);
    return;
  }
  const malformedSignal = runLoopOnce(malformedSignalDir, {
    providerInvoker: createProviderInvoker(({ workerOutputAbsPath }) => {
      fs.writeFileSync(
        workerOutputAbsPath,
        [
          '# Malformed Signal Worker Output',
          '',
          '## Findings',
          '',
          '- Signal block is intentionally malformed for smoke coverage.',
          '',
          '## Implementation summary',
          '',
          '- Wrote a worker-output artifact without the required Runner Signal block.',
          '',
          '## Files changed',
          '',
          '- `sample-phase.worker-output.md`',
          '',
          '## Checks run',
          '',
          '- `pnpm nimi-coding:validate-topic -- <malformed-signal-dir>`',
          '',
          '## Remaining gaps / risks',
          '',
          '- This artifact must be refused by the provider-backed loop.',
          '',
        ].join('\n'),
        'utf8',
      );
    }),
  });
  warnings.push(...(malformedSignal.warnings || []).map((warning) => `provider-backed smoke malformed signal: ${warning}`));
  if (malformedSignal.ok) {
    errors.push('provider-backed smoke malformed signal expected structured refusal');
    return;
  }
  if (malformedSignal.refusal?.code !== 'RUNNER_SIGNAL_MISSING' || malformedSignal.run_status !== 'failed') {
    errors.push('provider-backed smoke malformed signal expected RUNNER_SIGNAL_MISSING refusal with run_status=failed');
    return;
  }

  const invalidWorkerOutputDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-invalid-worker-output');
  const invalidWorkerOutputStart = runStart(invalidWorkerOutputDir, { runId: 'provider-invalid-worker-output-run' });
  if (!invalidWorkerOutputStart.ok) {
    errors.push(`provider-backed smoke invalid-worker-output run-start: ${(invalidWorkerOutputStart.errors || []).join('; ')}`);
    return;
  }
  const invalidWorkerOutput = runLoopOnce(invalidWorkerOutputDir, {
    providerInvoker: createProviderInvoker(({ workerOutputAbsPath, workerOutputRef }) => {
      writeWorkerOutputWithSignal(workerOutputAbsPath, {
        title: 'Provider Invalid Worker Output',
        findings: ['One required worker-output block is intentionally missing.'],
        implementationSummary: ['This should be refused as WORKER_OUTPUT_INVALID.'],
        filesChanged: [`\`${workerOutputRef}\``],
        checksRun: ['`pnpm nimi-coding:validate-topic -- <invalid-worker-output-dir>`'],
        remainingGaps: ['The worker-output artifact is structurally incomplete.'],
        signal: {
          result_kind: 'complete',
          worker_output_ref: workerOutputRef,
          evidence_refs: [],
          escalation_reasons: [],
          fail_reason: null,
        },
      });
      fs.writeFileSync(
        workerOutputAbsPath,
        fs.readFileSync(workerOutputAbsPath, 'utf8').replace(/\n## Checks run[\s\S]*?\n## Remaining gaps \/ risks\n/u, '\n## Remaining gaps / risks\n'),
        'utf8',
      );
    }),
  });
  warnings.push(...(invalidWorkerOutput.warnings || []).map((warning) => `provider-backed smoke invalid worker output: ${warning}`));
  if (invalidWorkerOutput.ok) {
    errors.push('provider-backed smoke invalid worker output expected structured refusal');
    return;
  }
  if (invalidWorkerOutput.refusal?.code !== 'WORKER_OUTPUT_INVALID' || invalidWorkerOutput.run_status !== 'failed') {
    errors.push('provider-backed smoke invalid worker output expected WORKER_OUTPUT_INVALID refusal with run_status=failed');
    return;
  }

  const missingWorkerOutputDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-missing-worker-output');
  const missingWorkerOutputStart = runStart(missingWorkerOutputDir, { runId: 'provider-missing-worker-output-run' });
  if (!missingWorkerOutputStart.ok) {
    errors.push(`provider-backed smoke missing-worker-output run-start: ${(missingWorkerOutputStart.errors || []).join('; ')}`);
    return;
  }
  fs.rmSync(path.join(missingWorkerOutputDir, 'sample-phase.worker-output.md'));
  const missingWorkerOutput = runLoopOnce(missingWorkerOutputDir, {
    providerInvoker: () => ({
      ok: true,
      provider_id: 'codex exec',
      stdout: 'worker forgot to write artifact',
      stderr: '',
      exit_code: 0,
      timed_out: false,
      reason: null,
    }),
  });
  warnings.push(...(missingWorkerOutput.warnings || []).map((warning) => `provider-backed smoke missing worker output: ${warning}`));
  if (missingWorkerOutput.ok) {
    errors.push('provider-backed smoke missing worker output expected structured refusal');
    return;
  }
  if (missingWorkerOutput.refusal?.code !== 'WORKER_OUTPUT_MISSING' || missingWorkerOutput.run_status !== 'failed') {
    errors.push('provider-backed smoke missing worker output expected WORKER_OUTPUT_MISSING refusal with run_status=failed');
    return;
  }

  const invalidSignalDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-invalid-signal');
  const invalidSignalStart = runStart(invalidSignalDir, { runId: 'provider-invalid-signal-run' });
  if (!invalidSignalStart.ok) {
    errors.push(`provider-backed smoke invalid-signal run-start: ${(invalidSignalStart.errors || []).join('; ')}`);
    return;
  }
  const invalidSignal = runLoopOnce(invalidSignalDir, {
    providerInvoker: createProviderInvoker(({ workerOutputAbsPath }) => {
      writeWorkerOutputWithSignal(workerOutputAbsPath, {
        title: 'Provider Invalid Signal Output',
        findings: ['Runner Signal uses an invalid result_kind.'],
        implementationSummary: ['This should be refused as RUNNER_SIGNAL_INVALID.'],
        filesChanged: ['`sample-phase.worker-output.md`'],
        checksRun: ['`pnpm nimi-coding:validate-topic -- <invalid-signal-dir>`'],
        remainingGaps: ['The Runner Signal payload is invalid.'],
        signal: {
          result_kind: 'bogus',
          worker_output_ref: 'sample-phase.worker-output.md',
          evidence_refs: [],
          escalation_reasons: [],
          fail_reason: null,
        },
      });
    }),
  });
  warnings.push(...(invalidSignal.warnings || []).map((warning) => `provider-backed smoke invalid signal: ${warning}`));
  if (invalidSignal.ok) {
    errors.push('provider-backed smoke invalid signal expected structured refusal');
    return;
  }
  if (invalidSignal.refusal?.code !== 'RUNNER_SIGNAL_INVALID' || invalidSignal.run_status !== 'failed') {
    errors.push('provider-backed smoke invalid signal expected RUNNER_SIGNAL_INVALID refusal with run_status=failed');
    return;
  }

  const mismatchSignalDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-signal-mismatch');
  const mismatchSignalStart = runStart(mismatchSignalDir, { runId: 'provider-signal-mismatch-run' });
  if (!mismatchSignalStart.ok) {
    errors.push(`provider-backed smoke signal-mismatch run-start: ${(mismatchSignalStart.errors || []).join('; ')}`);
    return;
  }
  const mismatchSignal = runLoopOnce(mismatchSignalDir, {
    providerInvoker: createProviderInvoker(({ workerOutputAbsPath }) => {
      writeWorkerOutputWithSignal(workerOutputAbsPath, {
        title: 'Provider Signal Mismatch Output',
        findings: ['worker_output_ref intentionally mismatches the current artifact path.'],
        implementationSummary: ['This should be refused as RUNNER_SIGNAL_ARTIFACT_MISMATCH.'],
        filesChanged: ['`sample-phase.worker-output.md`'],
        checksRun: ['`pnpm nimi-coding:validate-topic -- <mismatch-signal-dir>`'],
        remainingGaps: ['The runner must fail-close on artifact mismatch.'],
        signal: {
          result_kind: 'complete',
          worker_output_ref: 'different.worker-output.md',
          evidence_refs: [],
          escalation_reasons: [],
          fail_reason: null,
        },
      });
    }),
  });
  warnings.push(...(mismatchSignal.warnings || []).map((warning) => `provider-backed smoke signal mismatch: ${warning}`));
  if (mismatchSignal.ok) {
    errors.push('provider-backed smoke signal mismatch expected structured refusal');
    return;
  }
  if (mismatchSignal.refusal?.code !== 'RUNNER_SIGNAL_ARTIFACT_MISMATCH' || mismatchSignal.run_status !== 'failed') {
    errors.push('provider-backed smoke signal mismatch expected RUNNER_SIGNAL_ARTIFACT_MISMATCH refusal with run_status=failed');
    return;
  }

  const untilAwaitingDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-until-awaiting');
  const untilAwaitingStart = runStart(untilAwaitingDir, { runId: 'provider-until-awaiting-run' });
  if (!untilAwaitingStart.ok) {
    errors.push(`provider-backed smoke until-awaiting run-start: ${(untilAwaitingStart.errors || []).join('; ')}`);
    return;
  }
  const untilAwaiting = runUntilBlocked(untilAwaitingDir, {
    maxSteps: 4,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Provider Until Awaiting Phase Output',
          findings: ['Phase completed and loop should advance automatically.'],
          implementationSummary: ['Returned complete for the first phase to continue the loop.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <until-awaiting-dir>`'],
          remainingGaps: ['Terminal closeout still needs one more packet phase.'],
          signal: {
            result_kind: 'complete',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: null,
          },
        });
      },
      'sample-closeout': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Provider Until Awaiting Closeout Output',
          findings: ['Terminal packet phase completed mechanically.'],
          implementationSummary: ['Returned complete for the terminal phase to reach awaiting_confirmation.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <until-awaiting-dir>`'],
          remainingGaps: ['Final human confirmation remains intentionally manual.'],
          signal: {
            result_kind: 'complete',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: null,
          },
        });
      },
    }),
  });
  warnings.push(...(untilAwaiting.warnings || []).map((warning) => `provider-backed smoke run-until-blocked awaiting_confirmation: ${warning}`));
  if (!untilAwaiting.ok) {
    errors.push(`provider-backed smoke run-until-blocked awaiting_confirmation: ${(untilAwaiting.errors || []).join('; ')}`);
    return;
  }
  if (untilAwaiting.run_status !== 'awaiting_confirmation' || untilAwaiting.stop_reason !== 'awaiting_confirmation' || untilAwaiting.step_count !== 2) {
    errors.push('provider-backed smoke run-until-blocked awaiting_confirmation expected two steps ending in awaiting_confirmation');
    return;
  }
  const untilAwaitingLogPath = path.join(untilAwaitingDir, '.nimi-coding', 'provider-execution', 'provider-until-awaiting-run.jsonl');
  const untilAwaitingLogLines = fs.readFileSync(untilAwaitingLogPath, 'utf8').trim().split('\n').filter(Boolean);
  if (untilAwaitingLogLines.length !== 2) {
    errors.push(`provider-backed smoke run-until-blocked awaiting_confirmation expected 2 provider log entries, got ${untilAwaitingLogLines.length}`);
    return;
  }
  const untilAwaitingFirstLog = JSON.parse(untilAwaitingLogLines[0]);
  if (
    untilAwaitingFirstLog.run_id !== 'provider-until-awaiting-run'
    || untilAwaitingFirstLog.phase_id !== 'sample-phase'
    || untilAwaitingFirstLog.provider !== 'codex exec'
    || untilAwaitingFirstLog.prompt_ref !== 'sample-phase.prompt.md'
    || untilAwaitingFirstLog.worker_output_ref !== 'sample-phase.worker-output.md'
    || untilAwaitingFirstLog.signal_result_kind !== 'complete'
    || typeof untilAwaitingFirstLog.started_at !== 'string'
    || typeof untilAwaitingFirstLog.finished_at !== 'string'
    || untilAwaitingFirstLog.refusal_code !== null
    || untilAwaitingFirstLog.exit_status?.ok !== true
    || typeof untilAwaitingFirstLog.status_summary?.outcome !== 'string'
    || typeof untilAwaitingFirstLog.transcript?.policy?.max_chars_per_stream !== 'number'
  ) {
    errors.push('provider-backed smoke run-until-blocked awaiting_confirmation expected provider execution log entry with the required audit fields');
    return;
  }
  if (untilAwaiting.summary?.outcome !== 'stopped' || untilAwaiting.summary?.stop_reason !== 'awaiting_confirmation') {
    errors.push('provider-backed smoke run-until-blocked awaiting_confirmation expected stable stopped summary');
    return;
  }

  const untilPauseDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-until-pause');
  const untilPauseStart = runStart(untilPauseDir, { runId: 'provider-until-pause-run' });
  if (!untilPauseStart.ok) {
    errors.push(`provider-backed smoke run-until-blocked pause run-start: ${(untilPauseStart.errors || []).join('; ')}`);
    return;
  }
  const untilPause = runUntilBlocked(untilPauseDir, {
    maxSteps: 4,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Provider Until Pause Output',
          findings: ['Execution hit a packet-declared escalation condition.'],
          implementationSummary: ['Returned escalate so the loop must stop immediately.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <until-pause-dir>`'],
          remainingGaps: ['Manager intervention is required before resume.'],
          signal: {
            result_kind: 'escalate',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: ['authority conflict'],
            fail_reason: null,
          },
        });
      },
    }),
  });
  warnings.push(...(untilPause.warnings || []).map((warning) => `provider-backed smoke run-until-blocked pause: ${warning}`));
  if (!untilPause.ok) {
    errors.push(`provider-backed smoke run-until-blocked pause: ${(untilPause.errors || []).join('; ')}`);
    return;
  }
  if (untilPause.run_status !== 'paused' || untilPause.stop_reason !== 'paused' || untilPause.step_count !== 1) {
    errors.push('provider-backed smoke run-until-blocked pause expected to stop after one paused step');
    return;
  }

  const untilFailDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-until-fail');
  const untilFailStart = runStart(untilFailDir, { runId: 'provider-until-fail-run' });
  if (!untilFailStart.ok) {
    errors.push(`provider-backed smoke run-until-blocked fail run-start: ${(untilFailStart.errors || []).join('; ')}`);
    return;
  }
  const untilFail = runUntilBlocked(untilFailDir, {
    maxSteps: 4,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Provider Until Fail Output',
          findings: ['Worker requested terminal failure.'],
          implementationSummary: ['Returned fail so the loop must stop in failed state.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <until-fail-dir>`'],
          remainingGaps: ['Manual repair or a new packet is required.'],
          signal: {
            result_kind: 'fail',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: 'worker requested terminal failure',
          },
        });
      },
    }),
  });
  warnings.push(...(untilFail.warnings || []).map((warning) => `provider-backed smoke run-until-blocked fail: ${warning}`));
  if (!untilFail.ok) {
    errors.push(`provider-backed smoke run-until-blocked fail: ${(untilFail.errors || []).join('; ')}`);
    return;
  }
  if (untilFail.run_status !== 'failed' || untilFail.stop_reason !== 'failed' || untilFail.step_count !== 1) {
    errors.push('provider-backed smoke run-until-blocked fail expected to stop after one failed step');
    return;
  }

  const untilMalformedDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-until-malformed');
  const untilMalformedStart = runStart(untilMalformedDir, { runId: 'provider-until-malformed-run' });
  if (!untilMalformedStart.ok) {
    errors.push(`provider-backed smoke run-until-blocked malformed run-start: ${(untilMalformedStart.errors || []).join('; ')}`);
    return;
  }
  const untilMalformed = runUntilBlocked(untilMalformedDir, {
    maxSteps: 4,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath }) => {
        fs.writeFileSync(
          workerOutputAbsPath,
          [
            '# Malformed Until Blocked Output',
            '',
            '## Findings',
            '',
            '- Missing Runner Signal on purpose.',
            '',
            '## Implementation summary',
            '',
            '- This file should be refused by the provider-backed loop.',
            '',
            '## Files changed',
            '',
            '- `sample-phase.worker-output.md`',
            '',
            '## Checks run',
            '',
            '- `pnpm nimi-coding:validate-topic -- <until-malformed-dir>`',
            '',
            '## Remaining gaps / risks',
            '',
            '- The loop must refuse and fail-close on malformed signal.',
            '',
          ].join('\n'),
          'utf8',
        );
      },
    }),
  });
  warnings.push(...(untilMalformed.warnings || []).map((warning) => `provider-backed smoke run-until-blocked malformed: ${warning}`));
  if (untilMalformed.ok) {
    errors.push('provider-backed smoke run-until-blocked malformed expected structured refusal');
    return;
  }
  if (untilMalformed.refusal?.code !== 'RUNNER_SIGNAL_MISSING' || untilMalformed.run_status !== 'failed') {
    errors.push('provider-backed smoke run-until-blocked malformed expected RUNNER_SIGNAL_MISSING refusal with failed run status');
    return;
  }

  const untilGuardDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'provider-until-guard');
  const untilGuardStart = runStart(untilGuardDir, { runId: 'provider-until-guard-run' });
  if (!untilGuardStart.ok) {
    errors.push(`provider-backed smoke run-until-blocked guard run-start: ${(untilGuardStart.errors || []).join('; ')}`);
    return;
  }
  const untilGuard = runUntilBlocked(untilGuardDir, {
    maxSteps: 1,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Provider Until Guard Output',
          findings: ['Phase completed successfully but the loop guard is intentionally too small.'],
          implementationSummary: ['Advanced one phase so run-until-blocked must refuse on step guard before terminal stop.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <until-guard-dir>`'],
          remainingGaps: ['A larger max-step budget would be required to continue.'],
          signal: {
            result_kind: 'complete',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: null,
          },
        });
      },
    }),
  });
  warnings.push(...(untilGuard.warnings || []).map((warning) => `provider-backed smoke run-until-blocked guard: ${warning}`));
  if (untilGuard.ok) {
    errors.push('provider-backed smoke run-until-blocked guard expected structured refusal');
    return;
  }
  if (untilGuard.refusal?.code !== 'LOOP_GUARD_HIT') {
    errors.push('provider-backed smoke run-until-blocked guard expected LOOP_GUARD_HIT refusal');
    return;
  }
  if (untilGuard.summary?.refusal_code !== 'LOOP_GUARD_HIT' || untilGuard.summary?.step_count !== 1) {
    errors.push('provider-backed smoke run-until-blocked guard expected stable refusal summary with step_count=1');
    return;
  }

  const schedulerEligibleDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'scheduler-eligible');
  const schedulerEligibleStart = runStart(schedulerEligibleDir, { runId: 'scheduler-eligible-run' });
  if (!schedulerEligibleStart.ok) {
    errors.push(`scheduler smoke eligible run-start: ${(schedulerEligibleStart.errors || []).join('; ')}`);
    return;
  }
  const schedulerEligible = runScheduleStatus(schedulerEligibleDir);
  if (
    schedulerEligible.contract !== 'scheduler-preflight.v1'
    || schedulerEligible.eligible !== true
    || schedulerEligible.scheduler_status !== 'eligible'
    || schedulerEligible.refusal !== null
    || schedulerEligible.run_id !== 'scheduler-eligible-run'
  ) {
    errors.push('scheduler smoke eligible path expected scheduler-preflight.v1 eligible result');
    return;
  }

  const schedulerLeaseBlockedDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'scheduler-lease-blocked');
  const schedulerLeaseBlockedStart = runStart(schedulerLeaseBlockedDir, { runId: 'scheduler-lease-blocked-run' });
  if (!schedulerLeaseBlockedStart.ok) {
    errors.push(`scheduler smoke lease-blocked run-start: ${(schedulerLeaseBlockedStart.errors || []).join('; ')}`);
    return;
  }
  const leaseBlockedBaseNow = timestampNow();
  const leaseBlockedAcquire = acquireSchedulerLease(schedulerLeaseBlockedDir, {
    topicId: 'minimum-topic',
    runId: 'scheduler-lease-blocked-run',
    holderId: 'scheduler-smoke-holder-a',
    ttlMs: 60000,
    now: leaseBlockedBaseNow,
  });
  if (!leaseBlockedAcquire.ok) {
    errors.push(`scheduler smoke lease-blocked acquire: ${(leaseBlockedAcquire.errors || []).join('; ')}`);
    return;
  }
  const schedulerLeaseBlocked = runScheduleStatus(schedulerLeaseBlockedDir, {
    now: offsetTimestamp(leaseBlockedBaseNow, 30000),
  });
  if (
    schedulerLeaseBlocked.eligible !== false
    || schedulerLeaseBlocked.scheduler_status !== 'blocked_by_active_lease'
    || schedulerLeaseBlocked.refusal?.code !== 'SCHEDULER_LEASE_ACTIVE'
  ) {
    errors.push('scheduler smoke lease-blocked status expected SCHEDULER_LEASE_ACTIVE refusal');
    return;
  }
  const schedulerLeaseBlockedOnce = runScheduleOnce(schedulerLeaseBlockedDir, {
    now: offsetTimestamp(leaseBlockedBaseNow, 30000),
    leaseHolderId: 'scheduler-smoke-holder-b',
  });
  if (
    schedulerLeaseBlockedOnce.ok
    || schedulerLeaseBlockedOnce.scheduler_outcome !== 'refusal'
    || schedulerLeaseBlockedOnce.refusal?.code !== 'SCHEDULER_LEASE_ACTIVE'
  ) {
    errors.push('scheduler smoke schedule-once concurrent lease expected SCHEDULER_LEASE_ACTIVE refusal');
    return;
  }

  const schedulerStaleDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'scheduler-stale');
  const schedulerStaleStart = runStart(schedulerStaleDir, { runId: 'scheduler-stale-run' });
  if (!schedulerStaleStart.ok) {
    errors.push(`scheduler smoke stale run-start: ${(schedulerStaleStart.errors || []).join('; ')}`);
    return;
  }
  const staleLeaseBaseNow = timestampNow();
  const staleAcquire = acquireSchedulerLease(schedulerStaleDir, {
    topicId: 'minimum-topic',
    runId: 'scheduler-stale-run',
    holderId: 'scheduler-stale-holder',
    ttlMs: 1000,
    now: staleLeaseBaseNow,
  });
  if (!staleAcquire.ok) {
    errors.push(`scheduler smoke stale acquire: ${(staleAcquire.errors || []).join('; ')}`);
    return;
  }
  const schedulerStaleStatus = runScheduleStatus(schedulerStaleDir, {
    now: offsetTimestamp(staleLeaseBaseNow, 5000),
  });
  if (
    schedulerStaleStatus.eligible !== true
    || schedulerStaleStatus.scheduler_status !== 'eligible'
    || schedulerStaleStatus.lease.stale !== true
  ) {
    errors.push('scheduler smoke stale status expected expired lease to become eligible again');
    return;
  }

  const schedulerSuccessDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'scheduler-success');
  const schedulerSuccessStart = runStart(schedulerSuccessDir, { runId: 'scheduler-success-run' });
  if (!schedulerSuccessStart.ok) {
    errors.push(`scheduler smoke success run-start: ${(schedulerSuccessStart.errors || []).join('; ')}`);
    return;
  }
  const schedulerSuccess = runScheduleOnce(schedulerSuccessDir, {
    maxSteps: 4,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Scheduler Success Phase Output',
          findings: ['Foreground scheduler advanced the first phase.'],
          implementationSummary: ['Returned a complete signal so the loop can continue.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <scheduler-success-dir>`'],
          remainingGaps: ['Terminal phase still remains after this step.'],
          signal: {
            result_kind: 'complete',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: null,
          },
        });
      },
      'sample-closeout': ({ workerOutputAbsPath, workerOutputRef }) => {
        writeWorkerOutputWithSignal(workerOutputAbsPath, {
          title: 'Scheduler Success Closeout Output',
          findings: ['Foreground scheduler reached awaiting_confirmation.'],
          implementationSummary: ['Returned a complete signal for the terminal phase.'],
          filesChanged: [`\`${workerOutputRef}\``],
          checksRun: ['`pnpm nimi-coding:validate-topic -- <scheduler-success-dir>`'],
          remainingGaps: ['Final confirmation remains manual.'],
          signal: {
            result_kind: 'complete',
            worker_output_ref: workerOutputRef,
            evidence_refs: [],
            escalation_reasons: [],
            fail_reason: null,
          },
        });
      },
    }),
  });
  if (
    !schedulerSuccess.ok
    || schedulerSuccess.contract !== 'scheduler-result.v1'
    || schedulerSuccess.scheduler_outcome !== 'invoked'
    || schedulerSuccess.loop_summary?.stop_reason !== 'awaiting_confirmation'
    || schedulerSuccess.loop_summary?.step_count !== 2
    || schedulerSuccess.lease.released !== true
  ) {
    errors.push('scheduler smoke success path expected invoked scheduler-result.v1 ending in awaiting_confirmation with released lease');
    return;
  }
  const schedulerSuccessLeasePath = path.join(
    schedulerSuccessDir,
    schedulerLeaseRelPath('minimum-topic'),
  );
  if (exists(schedulerSuccessLeasePath)) {
    errors.push('scheduler smoke success path expected operational lease file to be removed on normal exit');
    return;
  }

  const schedulerRefusalDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'scheduler-refusal');
  const schedulerRefusalStart = runStart(schedulerRefusalDir, { runId: 'scheduler-refusal-run' });
  if (!schedulerRefusalStart.ok) {
    errors.push(`scheduler smoke refusal run-start: ${(schedulerRefusalStart.errors || []).join('; ')}`);
    return;
  }
  const schedulerRefusal = runScheduleOnce(schedulerRefusalDir, {
    maxSteps: 4,
    providerInvoker: createPhaseProviderInvoker({
      'sample-phase': ({ workerOutputAbsPath }) => {
        fs.writeFileSync(
          workerOutputAbsPath,
          [
            '# Scheduler Refusal Output',
            '',
            '## Findings',
            '',
            '- Runner Signal is intentionally missing.',
            '',
            '## Implementation summary',
            '',
            '- This fixture should force a structured loop refusal.',
            '',
            '## Files changed',
            '',
            '- `sample-phase.worker-output.md`',
            '',
            '## Checks run',
            '',
            '- `pnpm nimi-coding:validate-topic -- <scheduler-refusal-dir>`',
            '',
            '## Remaining gaps / risks',
            '',
            '- The scheduler should propagate the runner refusal and still release its lease.',
            '',
          ].join('\n'),
          'utf8',
        );
      },
    }),
  });
  if (
    schedulerRefusal.ok
    || schedulerRefusal.scheduler_outcome !== 'refusal'
    || schedulerRefusal.refusal?.code !== 'RUNNER_SIGNAL_MISSING'
    || schedulerRefusal.loop_summary?.refusal_code !== 'RUNNER_SIGNAL_MISSING'
    || schedulerRefusal.lease.released !== true
  ) {
    errors.push('scheduler smoke refusal path expected RUNNER_SIGNAL_MISSING refusal with released lease');
    return;
  }

  const automationEligibleDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'automation-cli-eligible');
  const automationEligibleStart = runStart(automationEligibleDir, { runId: 'automation-cli-eligible-run' });
  if (!automationEligibleStart.ok) {
    errors.push(`automation smoke eligible run-start: ${(automationEligibleStart.errors || []).join('; ')}`);
    return;
  }
  const automationSetup = buildCodexAutomationSetup(automationEligibleDir);
  if (
    automationSetup.contract !== 'codex-automation-setup.v1'
    || automationSetup.ok !== true
    || automationSetup.topic_id !== 'minimum-topic'
    || automationSetup.target?.topic_path !== automationEligibleDir
    || automationSetup.target?.explicit_topic_only !== true
    || automationSetup.target?.implicit_topic_selection !== false
    || automationSetup.execution?.cwd !== path.join(moduleRoot, '..')
    || automationSetup.execution?.preflight_command?.args?.join(' ') !== `nimi-coding:run-schedule-status -- ${automationEligibleDir}`
    || automationSetup.execution?.invoke_command?.args?.join(' ') !== `nimi-coding:run-schedule-codex-once -- ${automationEligibleDir}`
    || automationSetup.execution?.expected_preflight_contract !== 'scheduler-preflight.v1'
    || automationSetup.execution?.expected_result_contract !== 'scheduler-result.v1'
    || automationSetup.preflight?.contract !== 'scheduler-preflight.v1'
  ) {
    errors.push('automation setup smoke expected stable codex-automation-setup.v1 payload for one explicit topic');
    return;
  }
  if (
    !String(automationSetup.suggested_automation?.prompt || '').includes('run-schedule-status')
    || !String(automationSetup.suggested_automation?.prompt || '').includes('run-schedule-codex-once')
    || !String(automationSetup.suggested_automation?.prompt || '').includes('Do not parse topic files directly')
  ) {
    errors.push('automation setup smoke expected suggested automation prompt to reference only scheduler command surfaces');
    return;
  }
  const automationSetupCli = runNimiCodingCli(moduleRoot, 'run-schedule-codex-setup', [automationEligibleDir]);
  if (
    automationSetupCli.status !== 0
    || automationSetupCli.parsed?.contract !== 'codex-automation-setup.v1'
    || automationSetupCli.parsed?.ok !== true
    || automationSetupCli.parsed?.target?.topic_path !== automationEligibleDir
  ) {
    errors.push('automation setup CLI smoke expected machine-readable codex-automation-setup.v1 output');
    return;
  }
  const automationCodexHome = path.join(tempRoot, 'codex-home');
  const automationUpsertCreated = upsertCodexAutomationForTopic(automationEligibleDir, {
    codexHome: automationCodexHome,
  });
  if (
    !automationUpsertCreated.ok
    || automationUpsertCreated.contract !== 'codex-automation-upsert-result.v1'
    || automationUpsertCreated.action !== 'created'
    || automationUpsertCreated.topic_target !== automationEligibleDir
    || automationUpsertCreated.automation?.status !== 'PAUSED'
    || automationUpsertCreated.automation?.rrule !== 'FREQ=HOURLY;INTERVAL=1'
    || automationUpsertCreated.scheduler_binding?.expected_result_contract !== 'scheduler-result.v1'
  ) {
    errors.push('automation upsert smoke expected created codex-automation-upsert-result.v1 for one explicit topic');
    return;
  }
  const automationUpsertPath = automationUpsertCreated.automation?.automation_toml_path;
  if (!automationUpsertPath || !exists(automationUpsertPath)) {
    errors.push('automation upsert smoke expected automation.toml to be written');
    return;
  }
  const automationUpsertToml = fs.readFileSync(automationUpsertPath, 'utf8');
  if (
    !automationUpsertToml.includes(`id = "${automationUpsertCreated.automation.automation_id}"`)
    || !automationUpsertToml.includes(`prompt = ${JSON.stringify(automationSetup.suggested_automation.prompt)}`)
    || !automationUpsertToml.includes(`cwds = [${JSON.stringify(path.join(moduleRoot, '..'))}]`)
  ) {
    errors.push('automation upsert smoke expected automation.toml to contain the scheduler-bound prompt and cwd');
    return;
  }
  const automationUpsertUpdated = upsertCodexAutomationForTopic(automationEligibleDir, {
    codexHome: automationCodexHome,
    status: 'ACTIVE',
    rrule: 'FREQ=HOURLY;INTERVAL=2',
  });
  if (
    !automationUpsertUpdated.ok
    || automationUpsertUpdated.action !== 'updated'
    || automationUpsertUpdated.automation?.automation_id !== automationUpsertCreated.automation?.automation_id
    || automationUpsertUpdated.automation?.status !== 'ACTIVE'
    || automationUpsertUpdated.automation?.rrule !== 'FREQ=HOURLY;INTERVAL=2'
  ) {
    errors.push('automation upsert smoke expected stable identity with update-over-duplicate behavior');
    return;
  }
  const automationDirs = fs.readdirSync(path.join(automationCodexHome, 'automations'));
  if (automationDirs.length !== 1) {
    errors.push(`automation upsert smoke expected one automation directory after update, got ${automationDirs.length}`);
    return;
  }
  const automationUpsertCli = runNimiCodingCli(moduleRoot, 'run-schedule-codex-automation-upsert', [
    automationEligibleDir,
    '--codex-home',
    automationCodexHome,
    '--status',
    'PAUSED',
  ]);
  if (
    automationUpsertCli.status !== 0
    || automationUpsertCli.parsed?.contract !== 'codex-automation-upsert-result.v1'
    || automationUpsertCli.parsed?.ok !== true
    || automationUpsertCli.parsed?.action !== 'updated'
    || automationUpsertCli.parsed?.automation?.automation_id !== automationUpsertCreated.automation?.automation_id
  ) {
    errors.push('automation upsert CLI smoke expected machine-readable updated result without duplicate creation');
    return;
  }
  const automationStatusCli = runNimiCodingCli(moduleRoot, 'run-schedule-status', [automationEligibleDir]);
  if (
    automationStatusCli.status !== 0
    || automationStatusCli.parsed?.contract !== 'scheduler-preflight.v1'
    || automationStatusCli.parsed?.eligible !== true
    || automationStatusCli.parsed?.scheduler_status !== 'eligible'
    || automationStatusCli.parsed?.topic_id !== 'minimum-topic'
    || automationStatusCli.parsed?.run_id !== 'automation-cli-eligible-run'
  ) {
    errors.push('automation smoke expected machine-readable eligible scheduler-preflight.v1 from run-schedule-status');
    return;
  }

  const automationTerminalCli = runNimiCodingCli(moduleRoot, 'run-schedule-codex-once', [sampleDir]);
  if (
    automationTerminalCli.status === 0
    || automationTerminalCli.parsed?.contract !== 'scheduler-result.v1'
    || automationTerminalCli.parsed?.scheduler_outcome !== 'refusal'
    || automationTerminalCli.parsed?.refusal?.code !== 'RUN_TERMINAL'
    || automationTerminalCli.parsed?.preflight?.contract !== 'scheduler-preflight.v1'
    || automationTerminalCli.parsed?.preflight?.scheduler_status !== 'run_terminal'
  ) {
    errors.push('automation smoke expected machine-readable RUN_TERMINAL refusal from run-schedule-codex-once');
    return;
  }

  const automationLeaseBlockedDir = prepareProviderSmokeDir(sampleDir, tempRoot, 'automation-cli-lease-blocked');
  const automationLeaseBlockedStart = runStart(automationLeaseBlockedDir, { runId: 'automation-cli-lease-blocked-run' });
  if (!automationLeaseBlockedStart.ok) {
    errors.push(`automation smoke lease-blocked run-start: ${(automationLeaseBlockedStart.errors || []).join('; ')}`);
    return;
  }
  const automationLeaseBaseNow = timestampNow();
  const automationLeaseAcquire = acquireSchedulerLease(automationLeaseBlockedDir, {
    topicId: 'minimum-topic',
    runId: 'automation-cli-lease-blocked-run',
    holderId: 'automation-cli-preexisting-holder',
    ttlMs: 60000,
    now: automationLeaseBaseNow,
  });
  if (!automationLeaseAcquire.ok) {
    errors.push(`automation smoke lease-blocked acquire: ${(automationLeaseAcquire.errors || []).join('; ')}`);
    return;
  }
  const automationLeaseBlockedCli = runNimiCodingCli(moduleRoot, 'run-schedule-codex-once', [automationLeaseBlockedDir]);
  if (
    automationLeaseBlockedCli.status === 0
    || automationLeaseBlockedCli.parsed?.contract !== 'scheduler-result.v1'
    || automationLeaseBlockedCli.parsed?.scheduler_outcome !== 'refusal'
    || automationLeaseBlockedCli.parsed?.refusal?.code !== 'SCHEDULER_LEASE_ACTIVE'
    || automationLeaseBlockedCli.parsed?.preflight?.scheduler_status !== 'blocked_by_active_lease'
  ) {
    errors.push('automation smoke expected machine-readable SCHEDULER_LEASE_ACTIVE refusal from run-schedule-codex-once');
    return;
  }
  if (!String(automationLeaseBlockedCli.parsed?.lease?.holder_id || '').startsWith('automation-cli-preexisting-holder')) {
    errors.push('automation smoke expected blocked lease holder_id to be surfaced in scheduler result');
    return;
  }
  if (automationLeaseBlockedCli.parsed?.lease?.released !== false) {
    errors.push('automation smoke expected blocked automation refusal to keep released=false');
    return;
  }
  const automationInvalidSetup = runNimiCodingCli(moduleRoot, 'run-schedule-codex-setup', [path.join(tempRoot, 'missing-automation-topic')]);
  if (
    automationInvalidSetup.status === 0
    || automationInvalidSetup.parsed?.contract !== 'codex-automation-setup.v1'
    || automationInvalidSetup.parsed?.ok !== false
    || automationInvalidSetup.parsed?.refusal?.code !== 'SCHEDULER_PREREQUISITES_MISSING'
    || automationInvalidSetup.parsed?.target?.implicit_topic_selection !== false
  ) {
    errors.push('automation setup CLI smoke expected machine-readable refusal for invalid explicit topic target');
    return;
  }
  const automationInvalidUpsert = runNimiCodingCli(moduleRoot, 'run-schedule-codex-automation-upsert', [
    path.join(tempRoot, 'missing-automation-topic'),
    '--codex-home',
    automationCodexHome,
  ]);
  if (
    automationInvalidUpsert.status === 0
    || automationInvalidUpsert.parsed?.contract !== 'codex-automation-upsert-result.v1'
    || automationInvalidUpsert.parsed?.ok !== false
    || automationInvalidUpsert.parsed?.refusal?.code !== 'SCHEDULER_PREREQUISITES_MISSING'
  ) {
    errors.push('automation upsert CLI smoke expected refusal for invalid explicit topic target');
    return;
  }
  const automationBridgeCodexHome = path.join(tempRoot, 'codex-bridge-home');
  const automationBridgeCreated = bridgeCodexAutomationForTopic(automationEligibleDir, {
    upsertOptions: {
      codexHome: automationBridgeCodexHome,
    },
  });
  if (
    !automationBridgeCreated.ok
    || automationBridgeCreated.contract !== 'codex-automation-bridge-result.v1'
    || automationBridgeCreated.bridge_outcome !== 'created'
    || automationBridgeCreated.upsert_action !== 'created'
    || automationBridgeCreated.topic_target !== automationEligibleDir
    || automationBridgeCreated.setup_payload_summary?.contract !== 'codex-automation-setup.v1'
    || automationBridgeCreated.command_binding?.expected_result_contract !== 'scheduler-result.v1'
    || automationBridgeCreated.automation_identity?.automation_id == null
  ) {
    errors.push('automation bridge smoke expected created bridge result with setup summary and scheduler command binding');
    return;
  }
  const automationBridgeUpdated = runNimiCodingCli(moduleRoot, 'run-schedule-codex-bridge', [
    automationEligibleDir,
    '--codex-home',
    automationBridgeCodexHome,
  ]);
  if (
    automationBridgeUpdated.status !== 0
    || automationBridgeUpdated.parsed?.contract !== 'codex-automation-bridge-result.v1'
    || automationBridgeUpdated.parsed?.ok !== true
    || automationBridgeUpdated.parsed?.bridge_outcome !== 'updated'
    || automationBridgeUpdated.parsed?.upsert_action !== 'updated'
    || automationBridgeUpdated.parsed?.automation_identity?.automation_id !== automationBridgeCreated.automation_identity?.automation_id
  ) {
    errors.push('automation bridge CLI smoke expected repeated invocation to update the same one-topic automation');
    return;
  }
  const automationBridgeInvalid = runNimiCodingCli(moduleRoot, 'run-schedule-codex-bridge', [
    path.join(tempRoot, 'missing-automation-topic'),
    '--codex-home',
    automationBridgeCodexHome,
  ]);
  if (
    automationBridgeInvalid.status === 0
    || automationBridgeInvalid.parsed?.contract !== 'codex-automation-bridge-result.v1'
    || automationBridgeInvalid.parsed?.ok !== false
    || automationBridgeInvalid.parsed?.bridge_outcome !== 'refusal'
    || automationBridgeInvalid.parsed?.refusal?.code !== 'SCHEDULER_PREREQUISITES_MISSING'
  ) {
    errors.push('automation bridge CLI smoke expected machine-readable refusal for invalid explicit topic target');
    return;
  }
  const automationMalformedUpsert = upsertCodexAutomationFromSetup({
    contract: 'codex-automation-setup.v1',
    ok: true,
    topic_id: 'minimum-topic',
    target: {
      topic_path: automationEligibleDir,
      explicit_topic_only: false,
      implicit_topic_selection: true,
    },
    execution: {
      cwd: path.join(moduleRoot, '..'),
      invoke_command: {
        executable: 'pnpm',
        args: ['nimi-coding:run-schedule-codex-once', '--', automationEligibleDir],
      },
      preflight_command: {
        executable: 'pnpm',
        args: ['nimi-coding:run-schedule-status', '--', automationEligibleDir],
      },
      expected_preflight_contract: 'scheduler-preflight.v1',
      expected_result_contract: 'scheduler-result.v1',
    },
  }, {
    codexHome: automationCodexHome,
  });
  if (
    automationMalformedUpsert.ok
    || automationMalformedUpsert.refusal?.code !== 'AUTOMATION_SETUP_INVALID'
  ) {
    errors.push('automation upsert smoke expected malformed setup payload to refuse');
    return;
  }

  const idleStatus = runStatus(tempSampleDir);
  warnings.push(...(idleStatus.warnings || []).map((warning) => `continuous smoke run-status idle: ${warning}`));
  if (!idleStatus.ok) {
    errors.push(`continuous smoke run-status idle: ${(idleStatus.errors || []).join('; ')}`);
    return;
  }

  const started = runStart(tempSampleDir);
  warnings.push(...(started.warnings || []).map((warning) => `continuous smoke run-start: ${warning}`));
  if (!started.ok) {
    errors.push(`continuous smoke run-start: ${(started.errors || []).join('; ')}`);
    return;
  }

  const promptOne = runNextPrompt(tempSampleDir);
  warnings.push(...(promptOne.warnings || []).map((warning) => `continuous smoke run-next-prompt phase 1: ${warning}`));
  if (!promptOne.ok) {
    errors.push(`continuous smoke run-next-prompt phase 1: ${(promptOne.errors || []).join('; ')}`);
    return;
  }

  const paused = runIngest(tempSampleDir, {
    workerOutput: 'sample-phase.worker-output.md',
    escalationReasons: ['authority conflict'],
  });
  warnings.push(...(paused.warnings || []).map((warning) => `continuous smoke run-ingest pause: ${warning}`));
  if (!paused.ok) {
    errors.push(`continuous smoke run-ingest pause: ${(paused.errors || []).join('; ')}`);
    return;
  }
  const pauseLogReport = readNotificationLog(tempSampleDir, { runId: started.run_id });
  warnings.push(...(pauseLogReport.warnings || []).map((warning) => `continuous smoke notification log after pause: ${warning}`));
  if (!pauseLogReport.ok) {
    errors.push(`continuous smoke notification log after pause: ${(pauseLogReport.errors || []).join('; ')}`);
    return;
  }
  if (pauseLogReport.entry_count !== 1 || pauseLogReport.entries[0]?.payload?.event !== 'run_paused') {
    errors.push('continuous smoke expected one run_paused notification after pause');
    return;
  }

  const resumed = runResume(tempSampleDir, { reason: 'environmental repair' });
  warnings.push(...(resumed.warnings || []).map((warning) => `continuous smoke run-resume: ${warning}`));
  if (!resumed.ok) {
    errors.push(`continuous smoke run-resume: ${(resumed.errors || []).join('; ')}`);
    return;
  }

  const promptResume = runNextPrompt(tempSampleDir);
  warnings.push(...(promptResume.warnings || []).map((warning) => `continuous smoke run-next-prompt resume: ${warning}`));
  if (!promptResume.ok) {
    errors.push(`continuous smoke run-next-prompt resume: ${(promptResume.errors || []).join('; ')}`);
    return;
  }

  const continued = runIngest(tempSampleDir, {
    workerOutput: 'sample-phase.worker-output.md',
  });
  warnings.push(...(continued.warnings || []).map((warning) => `continuous smoke run-ingest continue: ${warning}`));
  if (!continued.ok) {
    errors.push(`continuous smoke run-ingest continue: ${(continued.errors || []).join('; ')}`);
    return;
  }

  const terminalPrompt = runNextPrompt(tempSampleDir);
  warnings.push(...(terminalPrompt.warnings || []).map((warning) => `continuous smoke run-next-prompt terminal: ${warning}`));
  if (!terminalPrompt.ok) {
    errors.push(`continuous smoke run-next-prompt terminal: ${(terminalPrompt.errors || []).join('; ')}`);
    return;
  }

  const awaitingConfirmation = runIngest(tempSampleDir, {
    workerOutput: 'sample-closeout.worker-output.md',
  });
  warnings.push(...(awaitingConfirmation.warnings || []).map((warning) => `continuous smoke run-ingest terminal: ${warning}`));
  if (!awaitingConfirmation.ok) {
    errors.push(`continuous smoke run-ingest terminal: ${(awaitingConfirmation.errors || []).join('; ')}`);
    return;
  }
  const finalLogReport = readNotificationLog(tempSampleDir, { runId: started.run_id });
  warnings.push(...(finalLogReport.warnings || []).map((warning) => `continuous smoke notification log after terminal ingest: ${warning}`));
  if (!finalLogReport.ok) {
    errors.push(`continuous smoke notification log after terminal ingest: ${(finalLogReport.errors || []).join('; ')}`);
    return;
  }
  if (finalLogReport.entry_count !== 2 || finalLogReport.entries[1]?.payload?.event !== 'awaiting_final_confirmation') {
    errors.push('continuous smoke expected awaiting_final_confirmation as the second notification');
    return;
  }

  const replayLogReport = readNotificationLog(tempSampleDir, { runId: started.run_id, afterCursor: 1 });
  warnings.push(...(replayLogReport.warnings || []).map((warning) => `continuous smoke replay notification log: ${warning}`));
  if (!replayLogReport.ok) {
    errors.push(`continuous smoke replay notification log: ${(replayLogReport.errors || []).join('; ')}`);
    return;
  }
  if (replayLogReport.returned_entry_count !== 1 || replayLogReport.entries[0]?.cursor !== 2) {
    errors.push('continuous smoke replay notification log expected one cursor=2 entry after after_cursor=1');
    return;
  }

  const initialAckStatus = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'smoke-consumer',
    runId: started.run_id,
  });
  warnings.push(...(initialAckStatus.warnings || []).map((warning) => `continuous smoke ack-status initial: ${warning}`));
  if (!initialAckStatus.ok) {
    errors.push(`continuous smoke ack-status initial: ${(initialAckStatus.errors || []).join('; ')}`);
    return;
  }
  if (initialAckStatus.exists || initialAckStatus.last_acked_cursor !== 0) {
    errors.push('continuous smoke initial ack-status expected missing checkpoint with last_acked_cursor=0');
    return;
  }

  const ackedOne = ackNotificationCheckpoint(tempSampleDir, {
    consumerId: 'smoke-consumer',
    runId: started.run_id,
    cursor: 1,
  });
  warnings.push(...(ackedOne.warnings || []).map((warning) => `continuous smoke ack cursor 1: ${warning}`));
  if (!ackedOne.ok) {
    errors.push(`continuous smoke ack cursor 1: ${(ackedOne.errors || []).join('; ')}`);
    return;
  }
  if (ackedOne.last_acked_cursor !== 1) {
    errors.push(`continuous smoke ack cursor 1 expected last_acked_cursor=1, got ${ackedOne.last_acked_cursor}`);
    return;
  }

  const replayAfterAck = readNotificationsAfterAck(tempSampleDir, {
    consumerId: 'smoke-consumer',
    runId: started.run_id,
  });
  warnings.push(...(replayAfterAck.warnings || []).map((warning) => `continuous smoke replay after ack: ${warning}`));
  if (!replayAfterAck.ok) {
    errors.push(`continuous smoke replay after ack: ${(replayAfterAck.errors || []).join('; ')}`);
    return;
  }
  if (replayAfterAck.last_acked_cursor !== 1 || replayAfterAck.returned_entry_count !== 1 || replayAfterAck.entries[0]?.cursor !== 2) {
    errors.push('continuous smoke replay after ack expected one cursor=2 entry after last_acked_cursor=1');
    return;
  }

  const transportRoot = path.join(tempRoot, 'delivered');
  const fileSinkSuccess = runNotifyFileSink(tempSampleDir, {
    consumerId: 'adapter-consumer',
    runId: started.run_id,
    sinkDir: transportRoot,
  });
  warnings.push(...(fileSinkSuccess.warnings || []).map((warning) => `continuous smoke run-notify success: ${warning}`));
  if (!fileSinkSuccess.ok) {
    errors.push(`continuous smoke run-notify success: ${(fileSinkSuccess.errors || []).join('; ')}`);
    return;
  }
  if (fileSinkSuccess.delivered_count !== 2 || fileSinkSuccess.last_acked_cursor_after !== 2) {
    errors.push('continuous smoke run-notify success expected delivered_count=2 and last_acked_cursor_after=2');
    return;
  }

  const replayAfterNotify = readNotificationsAfterAck(tempSampleDir, {
    consumerId: 'adapter-consumer',
    runId: started.run_id,
  });
  warnings.push(...(replayAfterNotify.warnings || []).map((warning) => `continuous smoke replay after run-notify: ${warning}`));
  if (!replayAfterNotify.ok) {
    errors.push(`continuous smoke replay after run-notify: ${(replayAfterNotify.errors || []).join('; ')}`);
    return;
  }
  if (replayAfterNotify.returned_entry_count !== 0 || replayAfterNotify.last_acked_cursor !== 2) {
    errors.push('continuous smoke replay after run-notify expected no pending entries and last_acked_cursor=2');
    return;
  }

  const ackedTwo = ackNotificationCheckpoint(tempSampleDir, {
    consumerId: 'smoke-consumer',
    runId: started.run_id,
    cursor: 2,
  });
  warnings.push(...(ackedTwo.warnings || []).map((warning) => `continuous smoke ack cursor 2: ${warning}`));
  if (!ackedTwo.ok) {
    errors.push(`continuous smoke ack cursor 2: ${(ackedTwo.errors || []).join('; ')}`);
    return;
  }
  if (ackedTwo.last_acked_cursor !== 2 || ackedTwo.pending_entry_count !== 0) {
    errors.push('continuous smoke ack cursor 2 expected last_acked_cursor=2 and pending_entry_count=0');
    return;
  }

  const missingLogReport = readNotificationLog(tempSampleDir, { runId: 'missing-run' });
  warnings.push(...(missingLogReport.warnings || []).map((warning) => `continuous smoke missing notification log: ${warning}`));
  if (!missingLogReport.ok) {
    errors.push(`continuous smoke missing notification log: ${(missingLogReport.errors || []).join('; ')}`);
    return;
  }
  if (missingLogReport.exists || missingLogReport.entry_count !== 0) {
    errors.push('continuous smoke missing notification log should report exists=false and entry_count=0');
    return;
  }

  const emptyLogPath = path.join(tempSampleDir, '.nimi-coding', 'notifications', 'empty-run.jsonl');
  fs.writeFileSync(emptyLogPath, '', 'utf8');
  const emptyLogReport = readNotificationLog(tempSampleDir, { runId: 'empty-run' });
  warnings.push(...(emptyLogReport.warnings || []).map((warning) => `continuous smoke empty notification log: ${warning}`));
  if (!emptyLogReport.ok) {
    errors.push(`continuous smoke empty notification log: ${(emptyLogReport.errors || []).join('; ')}`);
    return;
  }
  if (!emptyLogReport.exists || emptyLogReport.entry_count !== 0) {
    errors.push('continuous smoke empty notification log should report exists=true and entry_count=0');
    return;
  }

  const outOfRangeLogReport = readNotificationLog(tempSampleDir, { runId: started.run_id, afterCursor: 99 });
  if (outOfRangeLogReport.ok) {
    errors.push('continuous smoke out-of-range notification cursor should refuse');
    return;
  }

  const failingSinkPath = path.join(tempRoot, 'blocked-sink');
  fs.writeFileSync(failingSinkPath, 'not-a-directory\n', 'utf8');
  const fileSinkFailure = runNotifyFileSink(tempSampleDir, {
    consumerId: 'adapter-failing-consumer',
    runId: started.run_id,
    sinkDir: failingSinkPath,
  });
  if (fileSinkFailure.ok) {
    errors.push('continuous smoke run-notify failure path should refuse');
    return;
  }
  const failingAckStatus = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'adapter-failing-consumer',
    runId: started.run_id,
  });
  warnings.push(...(failingAckStatus.warnings || []).map((warning) => `continuous smoke run-notify failure ack-status: ${warning}`));
  if (!failingAckStatus.ok) {
    errors.push(`continuous smoke run-notify failure ack-status: ${(failingAckStatus.errors || []).join('; ')}`);
    return;
  }
  if (failingAckStatus.exists || failingAckStatus.last_acked_cursor !== 0) {
    errors.push('continuous smoke run-notify failure expected no ack progression');
    return;
  }

  const fileSinkReplay = runNotifyFileSink(tempSampleDir, {
    consumerId: 'adapter-failing-consumer',
    runId: started.run_id,
    sinkDir: path.join(tempRoot, 'recovered-sink'),
  });
  warnings.push(...(fileSinkReplay.warnings || []).map((warning) => `continuous smoke run-notify replay success: ${warning}`));
  if (!fileSinkReplay.ok) {
    errors.push(`continuous smoke run-notify replay success: ${(fileSinkReplay.errors || []).join('; ')}`);
    return;
  }
  if (fileSinkReplay.delivered_count !== 2 || fileSinkReplay.last_acked_cursor_after !== 2) {
    errors.push('continuous smoke run-notify replay success expected full replay and ack to cursor 2');
    return;
  }

  const webhookSuccess = await runNotifyWebhook(tempSampleDir, {
    consumerId: 'webhook-primary',
    runId: started.run_id,
    endpoint: webhookSuccessServer.endpoint,
    headerLines: ['X-Nimi-Test: webhook-smoke'],
  });
  warnings.push(...(webhookSuccess.warnings || []).map((warning) => `continuous smoke run-notify-webhook success: ${warning}`));
  if (!webhookSuccess.ok) {
    errors.push(`continuous smoke run-notify-webhook success: ${(webhookSuccess.errors || []).join('; ')}`);
    return;
  }
  if (webhookSuccess.delivered_count !== 2 || webhookSuccess.last_acked_cursor_after !== 2) {
    errors.push('continuous smoke run-notify-webhook success expected delivered_count=2 and last_acked_cursor_after=2');
    return;
  }
  if (webhookSuccessServer.requests.length !== 2) {
    errors.push(`continuous smoke run-notify-webhook success expected 2 HTTP requests, got ${webhookSuccessServer.requests.length}`);
    return;
  }
  const firstWebhookBody = JSON.parse(webhookSuccessServer.requests[0].body);
  if (webhookSuccessServer.requests[0].method !== 'POST' || firstWebhookBody.cursor !== 1 || firstWebhookBody.payload?.event !== 'run_paused') {
    errors.push('continuous smoke run-notify-webhook success expected first POST body to carry cursor 1 run_paused payload');
    return;
  }
  if (webhookSuccessServer.requests[0].headers['x-nimi-test'] !== 'webhook-smoke') {
    errors.push('continuous smoke run-notify-webhook success expected custom header propagation');
    return;
  }

  const replayAfterWebhook = readNotificationsAfterAck(tempSampleDir, {
    consumerId: 'webhook-primary',
    runId: started.run_id,
  });
  warnings.push(...(replayAfterWebhook.warnings || []).map((warning) => `continuous smoke replay after webhook notify: ${warning}`));
  if (!replayAfterWebhook.ok) {
    errors.push(`continuous smoke replay after webhook notify: ${(replayAfterWebhook.errors || []).join('; ')}`);
    return;
  }
  if (replayAfterWebhook.returned_entry_count !== 0 || replayAfterWebhook.last_acked_cursor !== 2) {
    errors.push('continuous smoke replay after webhook notify expected no pending entries and last_acked_cursor=2');
    return;
  }

  const webhookFailure = await runNotifyWebhook(tempSampleDir, {
    consumerId: 'webhook-failing',
    runId: started.run_id,
    endpoint: webhookFailureServer.endpoint,
  });
  if (webhookFailure.ok) {
    errors.push('continuous smoke run-notify-webhook HTTP failure path should refuse');
    return;
  }
  const webhookFailureAck = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'webhook-failing',
    runId: started.run_id,
  });
  warnings.push(...(webhookFailureAck.warnings || []).map((warning) => `continuous smoke run-notify-webhook failure ack-status: ${warning}`));
  if (!webhookFailureAck.ok) {
    errors.push(`continuous smoke run-notify-webhook failure ack-status: ${(webhookFailureAck.errors || []).join('; ')}`);
    return;
  }
  if (webhookFailureAck.exists || webhookFailureAck.last_acked_cursor !== 0) {
    errors.push('continuous smoke run-notify-webhook failure expected no ack progression');
    return;
  }

  const webhookReplay = await runNotifyWebhook(tempSampleDir, {
    consumerId: 'webhook-failing',
    runId: started.run_id,
    endpoint: webhookSuccessServer.endpoint,
  });
  warnings.push(...(webhookReplay.warnings || []).map((warning) => `continuous smoke run-notify-webhook replay success: ${warning}`));
  if (!webhookReplay.ok) {
    errors.push(`continuous smoke run-notify-webhook replay success: ${(webhookReplay.errors || []).join('; ')}`);
    return;
  }
  if (webhookReplay.delivered_count !== 2 || webhookReplay.last_acked_cursor_after !== 2) {
    errors.push('continuous smoke run-notify-webhook replay success expected full replay and ack to cursor 2');
    return;
  }

  const webhookBadJson = await runNotifyWebhook(tempSampleDir, {
    consumerId: 'webhook-bad-json',
    runId: started.run_id,
    endpoint: webhookBadJsonServer.endpoint,
  });
  if (webhookBadJson.ok) {
    errors.push('continuous smoke run-notify-webhook malformed response should refuse');
    return;
  }
  const webhookBadJsonAck = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'webhook-bad-json',
    runId: started.run_id,
  });
  if (!webhookBadJsonAck.ok) {
    errors.push(`continuous smoke run-notify-webhook malformed response ack-status: ${(webhookBadJsonAck.errors || []).join('; ')}`);
    return;
  }
  if (webhookBadJsonAck.exists || webhookBadJsonAck.last_acked_cursor !== 0) {
    errors.push('continuous smoke run-notify-webhook malformed response expected no ack progression');
    return;
  }

  const telegramMissingEnv = await runNotifyTelegram(tempSampleDir, {
    consumerId: 'telegram-missing-env',
    runId: started.run_id,
    envFilePaths: missingTelegramEnvPaths,
    apiBaseUrl: telegramSuccessServer.baseUrl,
  });
  if (telegramMissingEnv.ok) {
    errors.push('continuous smoke run-notify-telegram missing env should refuse');
    return;
  }
  const telegramMissingEnvAck = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'telegram-missing-env',
    runId: started.run_id,
  });
  if (!telegramMissingEnvAck.ok) {
    errors.push(`continuous smoke run-notify-telegram missing env ack-status: ${(telegramMissingEnvAck.errors || []).join('; ')}`);
    return;
  }
  if (telegramMissingEnvAck.exists || telegramMissingEnvAck.last_acked_cursor !== 0) {
    errors.push('continuous smoke run-notify-telegram missing env expected no ack progression');
    return;
  }

  const telegramSuccess = await runNotifyTelegram(tempSampleDir, {
    consumerId: 'telegram-primary',
    runId: started.run_id,
    envFilePaths: telegramEnvPaths,
    apiBaseUrl: telegramSuccessServer.baseUrl,
  });
  warnings.push(...(telegramSuccess.warnings || []).map((warning) => `continuous smoke run-notify-telegram success: ${warning}`));
  if (!telegramSuccess.ok) {
    errors.push(`continuous smoke run-notify-telegram success: ${(telegramSuccess.errors || []).join('; ')}`);
    return;
  }
  if (telegramSuccess.delivered_count !== 2 || telegramSuccess.last_acked_cursor_after !== 2) {
    errors.push('continuous smoke run-notify-telegram success expected delivered_count=2 and last_acked_cursor_after=2');
    return;
  }
  if (telegramSuccessServer.requests.length !== 2) {
    errors.push(`continuous smoke run-notify-telegram success expected 2 HTTP requests, got ${telegramSuccessServer.requests.length}`);
    return;
  }
  const firstTelegramRequest = telegramSuccessServer.requests[0];
  const firstTelegramBody = JSON.parse(firstTelegramRequest.body);
  if (firstTelegramRequest.method !== 'POST' || !firstTelegramRequest.url.includes('/bot654321:moduleModuleModuleMod/sendMessage')) {
    errors.push('continuous smoke run-notify-telegram success expected token-derived sendMessage endpoint from module env override');
    return;
  }
  if (firstTelegramBody.chat_id !== '-1009876543210') {
    errors.push('continuous smoke run-notify-telegram success expected TG_CHAT_ID from module env override');
    return;
  }
  if (typeof firstTelegramBody.text !== 'string' || !firstTelegramBody.text.includes('Notification: run_paused | Topic minimum-topic')) {
    errors.push('continuous smoke run-notify-telegram success expected plain-text rendered payload');
    return;
  }
  const replayAfterTelegram = readNotificationsAfterAck(tempSampleDir, {
    consumerId: 'telegram-primary',
    runId: started.run_id,
  });
  if (!replayAfterTelegram.ok) {
    errors.push(`continuous smoke replay after telegram notify: ${(replayAfterTelegram.errors || []).join('; ')}`);
    return;
  }
  if (replayAfterTelegram.returned_entry_count !== 0 || replayAfterTelegram.last_acked_cursor !== 2) {
    errors.push('continuous smoke replay after telegram notify expected no pending entries and last_acked_cursor=2');
    return;
  }

  const telegramFailure = await runNotifyTelegram(tempSampleDir, {
    consumerId: 'telegram-failing',
    runId: started.run_id,
    envFilePaths: telegramEnvPaths,
    apiBaseUrl: telegramFailureServer.baseUrl,
  });
  if (telegramFailure.ok) {
    errors.push('continuous smoke run-notify-telegram API failure path should refuse');
    return;
  }
  const telegramFailureAck = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'telegram-failing',
    runId: started.run_id,
  });
  if (!telegramFailureAck.ok) {
    errors.push(`continuous smoke run-notify-telegram failure ack-status: ${(telegramFailureAck.errors || []).join('; ')}`);
    return;
  }
  if (telegramFailureAck.exists || telegramFailureAck.last_acked_cursor !== 0) {
    errors.push('continuous smoke run-notify-telegram failure expected no ack progression');
    return;
  }

  const telegramReplay = await runNotifyTelegram(tempSampleDir, {
    consumerId: 'telegram-failing',
    runId: started.run_id,
    envFilePaths: telegramEnvPaths,
    apiBaseUrl: telegramSuccessServer.baseUrl,
  });
  warnings.push(...(telegramReplay.warnings || []).map((warning) => `continuous smoke run-notify-telegram replay success: ${warning}`));
  if (!telegramReplay.ok) {
    errors.push(`continuous smoke run-notify-telegram replay success: ${(telegramReplay.errors || []).join('; ')}`);
    return;
  }
  if (telegramReplay.delivered_count !== 2 || telegramReplay.last_acked_cursor_after !== 2) {
    errors.push('continuous smoke run-notify-telegram replay success expected full replay and ack to cursor 2');
    return;
  }

  const telegramBadJson = await runNotifyTelegram(tempSampleDir, {
    consumerId: 'telegram-bad-json',
    runId: started.run_id,
    envFilePaths: telegramEnvPaths,
    apiBaseUrl: telegramBadJsonServer.baseUrl,
  });
  if (telegramBadJson.ok) {
    errors.push('continuous smoke run-notify-telegram malformed response should refuse');
    return;
  }
  const telegramBadJsonAck = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'telegram-bad-json',
    runId: started.run_id,
  });
  if (!telegramBadJsonAck.ok) {
    errors.push(`continuous smoke run-notify-telegram malformed response ack-status: ${(telegramBadJsonAck.errors || []).join('; ')}`);
    return;
  }
  if (telegramBadJsonAck.exists || telegramBadJsonAck.last_acked_cursor !== 0) {
    errors.push('continuous smoke run-notify-telegram malformed response expected no ack progression');
    return;
  }

  const ackBeyondMax = ackNotificationCheckpoint(tempSampleDir, {
    consumerId: 'smoke-consumer',
    runId: started.run_id,
    cursor: 99,
  });
  if (ackBeyondMax.ok) {
    errors.push('continuous smoke ack beyond max cursor should refuse');
    return;
  }

  const ackRegression = ackNotificationCheckpoint(tempSampleDir, {
    consumerId: 'smoke-consumer',
    runId: started.run_id,
    cursor: 1,
  });
  if (ackRegression.ok) {
    errors.push('continuous smoke ack regression should refuse');
    return;
  }

  const malformedLogPath = path.join(tempSampleDir, '.nimi-coding', 'notifications', 'malformed-run.jsonl');
  fs.writeFileSync(malformedLogPath, '{"event":"run_paused"\n', 'utf8');
  const malformedLogReport = readNotificationLog(tempSampleDir, { runId: 'malformed-run' });
  if (malformedLogReport.ok) {
    errors.push('continuous smoke malformed notification log should refuse');
    return;
  }

  const malformedNotifyReport = runNotifyFileSink(tempSampleDir, {
    consumerId: 'malformed-adapter-consumer',
    runId: 'malformed-run',
    sinkDir: path.join(tempRoot, 'malformed-sink'),
  });
  if (malformedNotifyReport.ok) {
    errors.push('continuous smoke malformed handoff run-notify should refuse');
    return;
  }

  const malformedWebhookReport = await runNotifyWebhook(tempSampleDir, {
    consumerId: 'malformed-webhook-consumer',
    runId: 'malformed-run',
    endpoint: webhookSuccessServer.endpoint,
  });
  if (malformedWebhookReport.ok) {
    errors.push('continuous smoke malformed handoff run-notify-webhook should refuse');
    return;
  }

  const malformedTelegramReport = await runNotifyTelegram(tempSampleDir, {
    consumerId: 'malformed-telegram-consumer',
    runId: 'malformed-run',
    envFilePaths: telegramEnvPaths,
    apiBaseUrl: telegramSuccessServer.baseUrl,
  });
  if (malformedTelegramReport.ok) {
    errors.push('continuous smoke malformed handoff run-notify-telegram should refuse');
    return;
  }

  const unknownEventLogPath = path.join(tempSampleDir, '.nimi-coding', 'notifications', 'unknown-run.jsonl');
  fs.writeFileSync(
    unknownEventLogPath,
    `${JSON.stringify({
      event: 'unexpected_event',
      correlation_id: 'unknown-run:unexpected_event:1',
      topic_id: 'minimum-topic',
      run_id: 'unknown-run',
      packet_ref: 'sample.execution-packet.yaml',
      phase_id: 'sample-phase',
      run_status: 'paused',
      reason: 'unexpected event',
      required_human_action: 'manual-review',
      artifact_refs: {
        baseline_ref: 'methodology.baseline.md',
        packet_ref: 'sample.execution-packet.yaml',
        state_ref: 'sample.orchestration-state.yaml',
        prompt_ref: 'sample-phase.prompt.md',
        worker_output_ref: 'sample-phase.worker-output.md',
        acceptance_ref: 'sample-phase.acceptance.md',
        evidence_refs: ['audit.evidence.md'],
      },
      emitted_at: '2026-04-08T16:00:00+08:00',
    })}\n`,
    'utf8',
  );
  const unknownEventLogReport = readNotificationLog(tempSampleDir, { runId: 'unknown-run' });
  if (unknownEventLogReport.ok) {
    errors.push('continuous smoke unknown-event notification log should refuse');
    return;
  }

  const duplicateCorrelationLogPath = path.join(tempSampleDir, '.nimi-coding', 'notifications', 'duplicate-run.jsonl');
  fs.writeFileSync(
    duplicateCorrelationLogPath,
    [
      JSON.stringify({
        event: 'run_paused',
        correlation_id: 'duplicate-run:run_paused:1',
        topic_id: 'minimum-topic',
        run_id: 'duplicate-run',
        packet_ref: 'sample.execution-packet.yaml',
        phase_id: 'sample-phase',
        run_status: 'paused',
        reason: 'authority conflict',
        required_human_action: 'resolve-escalation-and-resume',
        artifact_refs: {
          baseline_ref: 'methodology.baseline.md',
          packet_ref: 'sample.execution-packet.yaml',
          state_ref: 'sample.orchestration-state.yaml',
          prompt_ref: 'sample-phase.prompt.md',
          worker_output_ref: 'sample-phase.worker-output.md',
          acceptance_ref: 'sample-phase.acceptance.md',
          evidence_refs: ['audit.evidence.md'],
        },
        emitted_at: '2026-04-08T16:00:00+08:00',
      }),
      JSON.stringify({
        event: 'awaiting_final_confirmation',
        correlation_id: 'duplicate-run:run_paused:1',
        topic_id: 'minimum-topic',
        run_id: 'duplicate-run',
        packet_ref: 'sample.execution-packet.yaml',
        phase_id: 'sample-closeout',
        run_status: 'awaiting_confirmation',
        reason: 'terminal packet phase completed mechanically',
        required_human_action: 'final-confirmation',
        artifact_refs: {
          baseline_ref: 'methodology.baseline.md',
          packet_ref: 'sample.execution-packet.yaml',
          state_ref: 'sample.orchestration-state.yaml',
          prompt_ref: 'sample-phase.prompt.md',
          worker_output_ref: 'sample-phase.worker-output.md',
          acceptance_ref: 'sample-phase.acceptance.md',
          evidence_refs: ['audit.evidence.md'],
        },
        emitted_at: '2026-04-08T16:10:00+08:00',
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  const duplicateCorrelationLogReport = readNotificationLog(tempSampleDir, { runId: 'duplicate-run' });
  if (duplicateCorrelationLogReport.ok) {
    errors.push('continuous smoke duplicate correlation notification log should refuse');
    return;
  }

  const malformedCheckpointPath = path.join(
    tempSampleDir,
    '.nimi-coding',
    'transport-state',
    'broken-consumer',
    `${started.run_id}.checkpoint.yaml`,
  );
  fs.mkdirSync(path.dirname(malformedCheckpointPath), { recursive: true });
  fs.writeFileSync(malformedCheckpointPath, 'last_acked_cursor: nope\n', 'utf8');
  const malformedCheckpointReport = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'broken-consumer',
    runId: started.run_id,
  });
  if (malformedCheckpointReport.ok) {
    errors.push('continuous smoke malformed checkpoint state should refuse');
    return;
  }

  const unknownRunAckStatus = readNotificationCheckpoint(tempSampleDir, {
    consumerId: 'missing-consumer',
    runId: 'missing-run',
  });
  if (unknownRunAckStatus.ok) {
    errors.push('continuous smoke unknown run ack-status should refuse');
    return;
  }

  const refusedMissingFinalEvidence = runConfirm(tempSampleDir);
  warnings.push(...(refusedMissingFinalEvidence.warnings || []).map((warning) => `continuous smoke run-confirm refusal missing final evidence: ${warning}`));
  if (refusedMissingFinalEvidence.ok) {
    errors.push('continuous smoke expected run-confirm without final evidence to refuse');
    return;
  }

  const refusedInvalidFinalEvidence = runConfirm(tempSampleDir, {
    finalEvidence: 'audit.evidence.md',
  });
  warnings.push(...(refusedInvalidFinalEvidence.warnings || []).map((warning) => `continuous smoke run-confirm refusal invalid final evidence: ${warning}`));
  if (refusedInvalidFinalEvidence.ok) {
    errors.push('continuous smoke expected run-confirm with non-final evidence to refuse');
    return;
  }

  const awaitingStatus = runStatus(tempSampleDir);
  warnings.push(...(awaitingStatus.warnings || []).map((warning) => `continuous smoke awaiting status: ${warning}`));
  if (!awaitingStatus.ok) {
    errors.push(`continuous smoke awaiting status: ${(awaitingStatus.errors || []).join('; ')}`);
    return;
  }
  if (awaitingStatus.run_status !== 'awaiting_confirmation') {
    errors.push(`continuous smoke expected awaiting_confirmation after refusal, got ${awaitingStatus.run_status}`);
    return;
  }

  const confirmed = runConfirm(tempSampleDir, {
    finalEvidence: 'final.audit.evidence.md',
  });
  warnings.push(...(confirmed.warnings || []).map((warning) => `continuous smoke run-confirm success: ${warning}`));
  if (!confirmed.ok) {
    errors.push(`continuous smoke run-confirm success: ${(confirmed.errors || []).join('; ')}`);
    return;
  }

  const finalStatus = runStatus(tempSampleDir);
  warnings.push(...(finalStatus.warnings || []).map((warning) => `continuous smoke final status: ${warning}`));
  if (!finalStatus.ok) {
    errors.push(`continuous smoke final status: ${(finalStatus.errors || []).join('; ')}`);
  } else if (finalStatus.run_status !== 'completed') {
    errors.push(`continuous smoke final status expected completed, got ${finalStatus.run_status}`);
  }

  const finalTopicIndex = loadYamlFile(path.join(tempSampleDir, 'topic.index.yaml')) || {};
  if (finalTopicIndex.status !== 'closed') {
    errors.push(`continuous smoke final topic status expected closed, got ${finalTopicIndex.status}`);
  }
  if (finalTopicIndex.final_evidence !== 'final.audit.evidence.md') {
    errors.push(`continuous smoke final_evidence expected final.audit.evidence.md, got ${finalTopicIndex.final_evidence}`);
  }

  const finalTopic = validateTopic(tempSampleDir);
  warnings.push(...finalTopic.warnings.map((warning) => `continuous smoke topic warning: ${warning}`));
  errors.push(...finalTopic.errors.map((error) => `continuous smoke topic invalid: ${error}`));
  } finally {
    await webhookSuccessServer.close();
    await webhookFailureServer.close();
    await webhookBadJsonServer.close();
    await telegramSuccessServer.close();
    await telegramFailureServer.close();
    await telegramBadJsonServer.close();
  }
}

export async function main() {
  const errors = [];
  const warnings = [];
  const moduleRoot = moduleRootFrom(import.meta.url);

  checkRequiredFiles(moduleRoot, errors);
  checkSchemaFiles(moduleRoot, errors);
  checkProtocolFiles(moduleRoot, errors);
  checkGateFiles(moduleRoot, errors);
  checkSample(moduleRoot, errors, warnings);
  await checkContinuousRunSmoke(moduleRoot, errors, warnings);

  for (const warning of warnings) {
    process.stderr.write(`WARN: ${warning}\n`);
  }
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`ERROR: ${error}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`validate-module: OK ${moduleRoot}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`ERROR: ${String(error.message || error)}\n`);
    process.exit(1);
  });
}
