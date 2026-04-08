import path from 'node:path';
import { repoRootFrom } from './module-paths.mjs';
import { runScheduleStatus } from './scheduler-foreground.mjs';

const REPO_ROOT = repoRootFrom(import.meta.url);
const STOP_CONDITIONS = ['paused', 'failed', 'awaiting_confirmation', 'completed', 'superseded'];

function suggestedAutomationName(topicId, topicDir) {
  return `Schedule ${topicId || path.basename(topicDir)}`;
}

function suggestedAutomationPrompt(topicDir) {
  return [
    `From the repository root, run \`pnpm nimi-coding:run-schedule-status -- ${topicDir}\`.`,
    'Read only the returned JSON control surface.',
    'If it returns `contract=scheduler-preflight.v1` and `eligible=true`, then run:',
    `\`pnpm nimi-coding:run-schedule-codex-once -- ${topicDir}\`.`,
    'Read only the returned `scheduler-result.v1` JSON.',
    'Do not parse topic files directly as the primary control surface.',
    'Do not invent retry logic, semantic acceptance logic, or finding lifecycle logic.',
  ].join(' ');
}

function buildCommand(commandName, topicDir) {
  return {
    executable: 'pnpm',
    args: [commandName, '--', topicDir],
  };
}

export function buildCodexAutomationSetup(topicDir, options = {}) {
  const resolvedTopicDir = path.resolve(topicDir);
  const preflight = runScheduleStatus(resolvedTopicDir, options.preflightOptions || {});
  const bindingOk = Boolean(
    preflight.topic_id
    && preflight.scheduler_status !== 'missing_provider_backed_prerequisites'
    && preflight.scheduler_status !== 'invalid_operational_lease'
  );

  return {
    contract: 'codex-automation-setup.v1',
    ok: bindingOk,
    errors: bindingOk ? [] : (preflight.errors || []),
    warnings: preflight.warnings || [],
    backend: 'codex-automation',
    topic_id: preflight.topic_id || null,
    target: {
      topic_path: resolvedTopicDir,
      explicit_topic_only: true,
      implicit_topic_selection: false,
    },
    execution: {
      cwd: REPO_ROOT,
      preflight_command: buildCommand('nimi-coding:run-schedule-status', resolvedTopicDir),
      invoke_command: buildCommand('nimi-coding:run-schedule-codex-once', resolvedTopicDir),
      expected_preflight_contract: 'scheduler-preflight.v1',
      expected_result_contract: 'scheduler-result.v1',
      stop_conditions: STOP_CONDITIONS,
    },
    suggested_automation: {
      name: suggestedAutomationName(preflight.topic_id, resolvedTopicDir),
      prompt: suggestedAutomationPrompt(resolvedTopicDir),
      cwds: [REPO_ROOT],
      explicit_topic_only: true,
    },
    refusal: bindingOk ? null : (preflight.refusal || {
      code: 'SCHEDULER_PREREQUISITES_MISSING',
      message: 'codex automation setup requires one explicit provider-backed topic target',
      details: {},
    }),
    preflight,
  };
}
