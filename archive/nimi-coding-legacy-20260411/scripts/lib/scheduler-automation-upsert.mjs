import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureDir,
  exists,
} from './doc-utils.mjs';
import { buildCodexAutomationSetup } from './scheduler-automation-setup.mjs';

const DEFAULT_AUTOMATION_STATUS = 'PAUSED';
const DEFAULT_AUTOMATION_RRULE = 'FREQ=HOURLY;INTERVAL=1';
const DEFAULT_AUTOMATION_MODEL = 'gpt-5.4';
const DEFAULT_AUTOMATION_REASONING_EFFORT = 'high';
const DEFAULT_AUTOMATION_EXECUTION_ENVIRONMENT = 'local';
const VALID_AUTOMATION_STATUS = new Set(['ACTIVE', 'PAUSED']);
const VALID_EXECUTION_ENVIRONMENT = new Set(['local', 'worktree']);

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    || 'topic';
}

function timestampMsNow() {
  return Date.now();
}

function detectCodexHome(explicitCodexHome) {
  if (explicitCodexHome) {
    return path.resolve(explicitCodexHome);
  }
  if (process.env.CODEX_HOME) {
    return path.resolve(process.env.CODEX_HOME);
  }
  return path.join(os.homedir(), '.codex');
}

function buildAutomationIdentity(setup) {
  const basis = [
    setup.execution?.cwd || '',
    setup.target?.topic_path || '',
    setup.topic_id || '',
  ].join('\0');
  const bindingKey = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 12);
  const automationId = `nimi-coding-${slug(setup.topic_id)}-${bindingKey}`;
  return {
    contract: 'codex-automation-identity.v1',
    topic_binding_key: bindingKey,
    automation_id: automationId,
  };
}

function parseExistingCreatedAt(filePath) {
  if (!exists(filePath)) {
    return null;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const match = text.match(/^created_at\s*=\s*(\d+)\s*$/mu);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function quoteTomlString(value) {
  return JSON.stringify(String(value));
}

function quoteTomlArray(values) {
  return `[${values.map((value) => quoteTomlString(value)).join(', ')}]`;
}

function buildAutomationToml(doc) {
  return [
    'version = 1',
    `id = ${quoteTomlString(doc.id)}`,
    'kind = "cron"',
    `name = ${quoteTomlString(doc.name)}`,
    `prompt = ${quoteTomlString(doc.prompt)}`,
    `status = ${quoteTomlString(doc.status)}`,
    `rrule = ${quoteTomlString(doc.rrule)}`,
    `model = ${quoteTomlString(doc.model)}`,
    `reasoning_effort = ${quoteTomlString(doc.reasoning_effort)}`,
    `execution_environment = ${quoteTomlString(doc.execution_environment)}`,
    `cwds = ${quoteTomlArray(doc.cwds)}`,
    `created_at = ${doc.created_at}`,
    `updated_at = ${doc.updated_at}`,
    '',
  ].join('\n');
}

function buildRefusal(code, message, details = {}) {
  return {
    code,
    message,
    details,
  };
}

function validateSetupPayload(setup) {
  const errors = [];
  if (!setup || typeof setup !== 'object' || Array.isArray(setup)) {
    errors.push('automation setup payload must be an object');
  }
  if (setup?.contract !== 'codex-automation-setup.v1') {
    errors.push(`automation setup payload requires contract=codex-automation-setup.v1, got ${setup?.contract || '(missing)'}`);
  }
  if (setup?.ok !== true) {
    errors.push('automation setup payload must be ok=true');
  }
  if (!setup?.topic_id || typeof setup.topic_id !== 'string') {
    errors.push('automation setup payload requires topic_id');
  }
  if (!setup?.target?.topic_path || typeof setup.target.topic_path !== 'string') {
    errors.push('automation setup payload requires target.topic_path');
  }
  if (setup?.target?.explicit_topic_only !== true || setup?.target?.implicit_topic_selection !== false) {
    errors.push('automation setup payload must remain one explicit topic only');
  }
  if (!setup?.execution?.cwd || typeof setup.execution.cwd !== 'string') {
    errors.push('automation setup payload requires execution.cwd');
  }
  if (!setup?.execution?.invoke_command?.executable || !Array.isArray(setup?.execution?.invoke_command?.args)) {
    errors.push('automation setup payload requires execution.invoke_command');
  }
  if (!setup?.execution?.preflight_command?.executable || !Array.isArray(setup?.execution?.preflight_command?.args)) {
    errors.push('automation setup payload requires execution.preflight_command');
  }
  if (setup?.execution?.expected_result_contract !== 'scheduler-result.v1') {
    errors.push('automation setup payload requires expected_result_contract=scheduler-result.v1');
  }
  if (setup?.execution?.expected_preflight_contract !== 'scheduler-preflight.v1') {
    errors.push('automation setup payload requires expected_preflight_contract=scheduler-preflight.v1');
  }
  return errors;
}

export function upsertCodexAutomationFromSetup(setup, options = {}) {
  const setupErrors = validateSetupPayload(setup);
  if (setupErrors.length > 0) {
    return {
      contract: 'codex-automation-upsert-result.v1',
      ok: false,
      errors: setupErrors,
      warnings: [],
      action: null,
      topic_id: setup?.topic_id || null,
      topic_target: setup?.target?.topic_path || null,
      automation: null,
      scheduler_binding: null,
      refusal: buildRefusal(
        'AUTOMATION_SETUP_INVALID',
        'codex automation upsert requires a valid codex-automation-setup.v1 payload',
      ),
      setup: setup || null,
    };
  }

  const status = String(options.status || DEFAULT_AUTOMATION_STATUS).toUpperCase();
  if (!VALID_AUTOMATION_STATUS.has(status)) {
    return {
      contract: 'codex-automation-upsert-result.v1',
      ok: false,
      errors: [`invalid automation status: ${status}`],
      warnings: [],
      action: null,
      topic_id: setup.topic_id,
      topic_target: setup.target.topic_path,
      automation: null,
      scheduler_binding: null,
      refusal: buildRefusal(
        'AUTOMATION_STATUS_INVALID',
        'automation status must be ACTIVE or PAUSED',
      ),
      setup,
    };
  }

  const executionEnvironment = String(options.executionEnvironment || DEFAULT_AUTOMATION_EXECUTION_ENVIRONMENT);
  if (!VALID_EXECUTION_ENVIRONMENT.has(executionEnvironment)) {
    return {
      contract: 'codex-automation-upsert-result.v1',
      ok: false,
      errors: [`invalid execution environment: ${executionEnvironment}`],
      warnings: [],
      action: null,
      topic_id: setup.topic_id,
      topic_target: setup.target.topic_path,
      automation: null,
      scheduler_binding: null,
      refusal: buildRefusal(
        'AUTOMATION_EXECUTION_ENVIRONMENT_INVALID',
        'automation execution_environment must be local or worktree',
      ),
      setup,
    };
  }

  const identity = buildAutomationIdentity(setup);
  const codexHome = detectCodexHome(options.codexHome);
  const automationDir = path.join(codexHome, 'automations', identity.automation_id);
  const automationTomlPath = path.join(automationDir, 'automation.toml');
  const existed = exists(automationTomlPath);
  const createdAt = parseExistingCreatedAt(automationTomlPath) || timestampMsNow();
  const updatedAt = timestampMsNow();
  const doc = {
    id: identity.automation_id,
    name: options.name || setup.suggested_automation?.name || `Schedule ${setup.topic_id}`,
    prompt: options.prompt || setup.suggested_automation?.prompt || '',
    status,
    rrule: options.rrule || DEFAULT_AUTOMATION_RRULE,
    model: options.model || DEFAULT_AUTOMATION_MODEL,
    reasoning_effort: options.reasoningEffort || DEFAULT_AUTOMATION_REASONING_EFFORT,
    execution_environment: executionEnvironment,
    cwds: Array.isArray(setup.suggested_automation?.cwds) && setup.suggested_automation.cwds.length > 0
      ? setup.suggested_automation.cwds
      : [setup.execution.cwd],
    created_at: createdAt,
    updated_at: updatedAt,
  };

  ensureDir(automationDir);
  fs.writeFileSync(automationTomlPath, buildAutomationToml(doc), 'utf8');

  return {
    contract: 'codex-automation-upsert-result.v1',
    ok: true,
    errors: [],
    warnings: [],
    action: existed ? 'updated' : 'created',
    topic_id: setup.topic_id,
    topic_target: setup.target.topic_path,
    automation: {
      ...identity,
      codex_home: codexHome,
      automation_dir: automationDir,
      automation_toml_path: automationTomlPath,
      name: doc.name,
      status: doc.status,
      rrule: doc.rrule,
      model: doc.model,
      reasoning_effort: doc.reasoning_effort,
      execution_environment: doc.execution_environment,
      cwds: doc.cwds,
    },
    scheduler_binding: {
      preflight_command: setup.execution.preflight_command,
      invoke_command: setup.execution.invoke_command,
      expected_preflight_contract: setup.execution.expected_preflight_contract,
      expected_result_contract: setup.execution.expected_result_contract,
      stop_conditions: setup.execution.stop_conditions,
    },
    refusal: null,
    setup,
  };
}

export function upsertCodexAutomationForTopic(topicDir, options = {}) {
  const setup = buildCodexAutomationSetup(topicDir, options.setupOptions || {});
  if (!setup.ok) {
    return {
      contract: 'codex-automation-upsert-result.v1',
      ok: false,
      errors: setup.errors || [],
      warnings: setup.warnings || [],
      action: null,
      topic_id: setup.topic_id || null,
      topic_target: setup.target?.topic_path || null,
      automation: null,
      scheduler_binding: null,
      refusal: setup.refusal || buildRefusal(
        'AUTOMATION_SETUP_INVALID',
        'codex automation upsert requires a valid explicit topic target',
      ),
      setup,
    };
  }
  return upsertCodexAutomationFromSetup(setup, options);
}
