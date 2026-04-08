import fs from 'node:fs';
import path from 'node:path';
import { exists, loadYamlFile, normalizeRel } from './doc-utils.mjs';
import { validateNotificationPayloadData } from './validators.mjs';

export function notificationLogRelPath(runId) {
  return normalizeRel(path.join('.nimi-coding', 'notifications', `${runId}.jsonl`));
}

function loadTopic(topicDir) {
  const topicPath = path.join(topicDir, 'topic.index.yaml');
  if (!exists(topicPath)) {
    return {
      ok: false,
      errors: [`missing topic.index.yaml in ${topicDir}`],
    };
  }
  return {
    ok: true,
    topic: loadYamlFile(topicPath) || {},
  };
}

function loadState(topicDir, topic) {
  if (!topic.orchestration_state_ref) {
    return null;
  }
  const statePath = path.join(topicDir, topic.orchestration_state_ref);
  if (!exists(statePath)) {
    return null;
  }
  return loadYamlFile(statePath) || {};
}

function expectedCorrelationId(runId, event, ordinal) {
  return `${runId}:${event}:${ordinal}`;
}

function normalizeAfterCursor(rawAfterCursor) {
  if (rawAfterCursor === undefined || rawAfterCursor === null || rawAfterCursor === '') {
    return {
      ok: true,
      value: 0,
    };
  }
  const parsed = Number(rawAfterCursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return {
      ok: false,
      error: `after_cursor must be a non-negative integer, got ${rawAfterCursor}`,
    };
  }
  return {
    ok: true,
    value: parsed,
  };
}

export function readNotificationLog(topicDir, options = {}) {
  const warnings = [];
  const afterCursorReport = normalizeAfterCursor(options.afterCursor);
  if (!afterCursorReport.ok) {
    return {
      ok: false,
      errors: [afterCursorReport.error],
      warnings,
    };
  }
  const afterCursor = afterCursorReport.value;
  const topicReport = loadTopic(topicDir);
  if (!topicReport.ok) {
    return {
      ok: false,
      errors: topicReport.errors,
      warnings,
    };
  }

  const topic = topicReport.topic;
  const state = loadState(topicDir, topic);
  const runId = options.runId || state?.state_id || null;
  if (!runId) {
    return {
      ok: false,
      errors: ['run-notifications requires --run-id when no orchestration state is present'],
      warnings,
    };
  }

  const logRelPath = notificationLogRelPath(runId);
  const logAbsPath = path.join(topicDir, logRelPath);
  if (!exists(logAbsPath)) {
    if (Array.isArray(state?.notification_refs) && state.notification_refs.length > 0 && state.state_id === runId) {
      warnings.push('notification log file is missing even though orchestration state records notification_refs');
    }
    return {
      ok: true,
      errors: [],
      warnings,
      topic_id: topic.topic_id || null,
      run_id: runId,
      state_ref: topic.orchestration_state_ref || null,
      log_ref: logRelPath,
      exists: false,
      handoff_protocol: 'notification-handoff.v1',
      cursor_kind: 'append-ordinal-1-based',
      after_cursor: afterCursor,
      max_cursor: 0,
      entry_count: 0,
      returned_entry_count: 0,
      entries: [],
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(logAbsPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      errors: [`unable to read notification log ${logRelPath}: ${String(error.message || error)}`],
      warnings,
    };
  }

  const physicalLines = raw.split(/\r?\n/u);
  if (physicalLines.length > 0 && physicalLines[physicalLines.length - 1] === '') {
    physicalLines.pop();
  }

  const entries = [];
  const errors = [];
  const seenCorrelationIds = new Set();

  for (const [index, rawLine] of physicalLines.entries()) {
    if (rawLine.trim() === '') {
      errors.push(`notification log contains blank line at ${index + 1}`);
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(rawLine);
    } catch (error) {
      errors.push(`notification log line ${index + 1} is not valid JSON: ${String(error.message || error)}`);
      continue;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      errors.push(`notification log line ${index + 1} must be a JSON object`);
      continue;
    }

    const payloadReport = validateNotificationPayloadData(logAbsPath, payload, { topicDir });
    warnings.push(...payloadReport.warnings.map((warning) => `line ${index + 1}: ${warning}`));
    errors.push(...payloadReport.errors.map((error) => `line ${index + 1}: ${error}`));

    if (payload.run_id !== runId) {
      errors.push(`notification log line ${index + 1} run_id mismatch: expected ${runId}, got ${payload.run_id}`);
    }
    if (topic.topic_id && payload.topic_id !== topic.topic_id) {
      errors.push(`notification log line ${index + 1} topic_id mismatch: expected ${topic.topic_id}, got ${payload.topic_id}`);
    }
    if (seenCorrelationIds.has(payload.correlation_id)) {
      errors.push(`notification log line ${index + 1} repeats correlation_id ${payload.correlation_id}`);
    } else {
      seenCorrelationIds.add(payload.correlation_id);
    }
    const cursor = index + 1;
    const expectedCorrelation = expectedCorrelationId(runId, payload.event, cursor);
    if (payload.correlation_id !== expectedCorrelation) {
      errors.push(`notification log line ${index + 1} correlation_id must equal ${expectedCorrelation}`);
    }

    entries.push({
      cursor,
      payload,
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
    };
  }

  if (afterCursor > entries.length) {
    return {
      ok: false,
      errors: [`after_cursor ${afterCursor} exceeds max cursor ${entries.length} for run ${runId}`],
      warnings,
    };
  }

  if (Array.isArray(state?.notification_refs) && state.state_id === runId && state.notification_refs.length !== entries.length) {
    warnings.push(
      `notification log entry count ${entries.length} does not match orchestration state notification_refs count ${state.notification_refs.length}`,
    );
  }

  const replayEntries = entries.filter((entry) => entry.cursor > afterCursor);

  return {
    ok: true,
    errors: [],
    warnings,
    topic_id: topic.topic_id || null,
    run_id: runId,
    state_ref: topic.orchestration_state_ref || null,
    log_ref: logRelPath,
    exists: true,
    handoff_protocol: 'notification-handoff.v1',
    cursor_kind: 'append-ordinal-1-based',
    after_cursor: afterCursor,
    max_cursor: entries.length,
    entry_count: entries.length,
    returned_entry_count: replayEntries.length,
    entries: replayEntries,
  };
}
