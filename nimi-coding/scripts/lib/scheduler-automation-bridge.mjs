import path from 'node:path';
import { buildCodexAutomationSetup } from './scheduler-automation-setup.mjs';
import { upsertCodexAutomationFromSetup } from './scheduler-automation-upsert.mjs';

function summarizeSetup(setup) {
  if (!setup || typeof setup !== 'object') {
    return null;
  }
  return {
    contract: setup.contract || null,
    backend: setup.backend || null,
    topic_id: setup.topic_id || null,
    topic_target: setup.target?.topic_path || null,
    explicit_topic_only: setup.target?.explicit_topic_only === true,
    cwd: setup.execution?.cwd || null,
    preflight_command: setup.execution?.preflight_command || null,
    invoke_command: setup.execution?.invoke_command || null,
    expected_preflight_contract: setup.execution?.expected_preflight_contract || null,
    expected_result_contract: setup.execution?.expected_result_contract || null,
  };
}

function summarizeCommandBinding(setup, upsertResult) {
  return upsertResult?.scheduler_binding || {
    preflight_command: setup?.execution?.preflight_command || null,
    invoke_command: setup?.execution?.invoke_command || null,
    expected_preflight_contract: setup?.execution?.expected_preflight_contract || null,
    expected_result_contract: setup?.execution?.expected_result_contract || null,
    stop_conditions: setup?.execution?.stop_conditions || [],
  };
}

export function bridgeCodexAutomationForTopic(topicDir, options = {}) {
  const resolvedTopicDir = path.resolve(topicDir);
  const setup = buildCodexAutomationSetup(resolvedTopicDir, options.setupOptions || {});
  const setupSummary = summarizeSetup(setup);
  if (!setup.ok) {
    return {
      contract: 'codex-automation-bridge-result.v1',
      ok: false,
      errors: [...(setup.errors || [])],
      warnings: [...(setup.warnings || [])],
      bridge_outcome: 'refusal',
      setup_payload_summary: setupSummary,
      upsert_action: null,
      automation_identity: null,
      topic_id: setup.topic_id || null,
      topic_target: resolvedTopicDir,
      command_binding: summarizeCommandBinding(setup, null),
      refusal: setup.refusal || null,
    };
  }

  const upsertResult = upsertCodexAutomationFromSetup(setup, options.upsertOptions || {});
  return {
    contract: 'codex-automation-bridge-result.v1',
    ok: upsertResult.ok,
    errors: [...(upsertResult.errors || [])],
    warnings: [...new Set([...(setup.warnings || []), ...(upsertResult.warnings || [])])],
    bridge_outcome: upsertResult.ok ? upsertResult.action : 'refusal',
    setup_payload_summary: setupSummary,
    upsert_action: upsertResult.action || null,
    automation_identity: upsertResult.automation ? {
      contract: upsertResult.automation.contract || null,
      automation_id: upsertResult.automation.automation_id || null,
      topic_binding_key: upsertResult.automation.topic_binding_key || null,
      codex_home: upsertResult.automation.codex_home || null,
      automation_dir: upsertResult.automation.automation_dir || null,
      automation_toml_path: upsertResult.automation.automation_toml_path || null,
    } : null,
    topic_id: upsertResult.topic_id || setup.topic_id || null,
    topic_target: upsertResult.topic_target || setup.target?.topic_path || resolvedTopicDir,
    command_binding: summarizeCommandBinding(setup, upsertResult),
    refusal: upsertResult.refusal || null,
  };
}
