import path from 'node:path';
import {
  ensureDir,
  exists,
  loadYamlFile,
  normalizeRel,
  timestampNow,
  writeYamlFile,
} from './doc-utils.mjs';
import { readNotificationLog } from './notification-log.mjs';

const CHECKPOINT_PROTOCOL = 'notification-ack-checkpoint.v1';

function invalidConsumerError(rawConsumerId) {
  return `consumer_id must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$, got ${rawConsumerId}`;
}

function normalizeConsumerId(rawConsumerId) {
  const value = String(rawConsumerId || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    return {
      ok: false,
      error: invalidConsumerError(rawConsumerId),
    };
  }
  return {
    ok: true,
    value,
  };
}

function normalizeAckCursor(rawCursor) {
  const parsed = Number(rawCursor);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      ok: false,
      error: `cursor must be a positive integer, got ${rawCursor}`,
    };
  }
  return {
    ok: true,
    value: parsed,
  };
}

function unknownRunError(runId) {
  return `unknown run_id ${runId}: notification log not found`;
}

function validateCheckpointData(checkpointPath, checkpoint, expectedConsumerId, expectedRunId, maxCursor) {
  const errors = [];
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    return {
      ok: false,
      errors: [`checkpoint ${checkpointPath} must be a YAML mapping`],
    };
  }
  if (checkpoint.protocol !== CHECKPOINT_PROTOCOL) {
    errors.push(`checkpoint ${checkpointPath} protocol must equal ${CHECKPOINT_PROTOCOL}`);
  }
  if (checkpoint.consumer_id !== expectedConsumerId) {
    errors.push(`checkpoint ${checkpointPath} consumer_id must equal ${expectedConsumerId}`);
  }
  if (checkpoint.run_id !== expectedRunId) {
    errors.push(`checkpoint ${checkpointPath} run_id must equal ${expectedRunId}`);
  }
  if (!Number.isInteger(checkpoint.last_acked_cursor) || checkpoint.last_acked_cursor < 0) {
    errors.push(`checkpoint ${checkpointPath} last_acked_cursor must be a non-negative integer`);
  } else if (checkpoint.last_acked_cursor > maxCursor) {
    errors.push(
      `checkpoint ${checkpointPath} last_acked_cursor ${checkpoint.last_acked_cursor} exceeds max cursor ${maxCursor} for run ${expectedRunId}`,
    );
  }
  if (typeof checkpoint.updated_at !== 'string' || checkpoint.updated_at.trim() === '') {
    errors.push(`checkpoint ${checkpointPath} updated_at must be a non-empty string`);
  }
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function notificationCheckpointRelPath(consumerId, runId) {
  return normalizeRel(path.join('.nimi-coding', 'transport-state', consumerId, `${runId}.checkpoint.yaml`));
}

export function readNotificationCheckpoint(topicDir, options = {}) {
  const warnings = [];
  const consumerReport = normalizeConsumerId(options.consumerId);
  if (!consumerReport.ok) {
    return {
      ok: false,
      errors: [consumerReport.error],
      warnings,
    };
  }

  const logReport = readNotificationLog(topicDir, {
    runId: options.runId,
  });
  warnings.push(...(logReport.warnings || []));
  if (!logReport.ok) {
    return {
      ok: false,
      errors: logReport.errors || [],
      warnings,
    };
  }
  if (!logReport.exists) {
    return {
      ok: false,
      errors: [unknownRunError(logReport.run_id)],
      warnings,
    };
  }

  const checkpointRelPath = notificationCheckpointRelPath(consumerReport.value, logReport.run_id);
  const checkpointAbsPath = path.join(topicDir, checkpointRelPath);
  if (!exists(checkpointAbsPath)) {
    return {
      ok: true,
      errors: [],
      warnings,
      consumer_id: consumerReport.value,
      run_id: logReport.run_id,
      log_ref: logReport.log_ref,
      checkpoint_ref: checkpointRelPath,
      exists: false,
      last_acked_cursor: 0,
      max_cursor: logReport.max_cursor,
      pending_entry_count: logReport.max_cursor,
      updated_at: null,
    };
  }

  let checkpoint;
  try {
    checkpoint = loadYamlFile(checkpointAbsPath);
  } catch (error) {
    return {
      ok: false,
      errors: [`unable to read checkpoint ${checkpointRelPath}: ${String(error.message || error)}`],
      warnings,
    };
  }

  const validation = validateCheckpointData(
    checkpointRelPath,
    checkpoint,
    consumerReport.value,
    logReport.run_id,
    logReport.max_cursor,
  );
  if (!validation.ok) {
    return {
      ok: false,
      errors: validation.errors,
      warnings,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings,
    consumer_id: consumerReport.value,
    run_id: logReport.run_id,
    log_ref: logReport.log_ref,
    checkpoint_ref: checkpointRelPath,
    exists: true,
    last_acked_cursor: checkpoint.last_acked_cursor,
    max_cursor: logReport.max_cursor,
    pending_entry_count: logReport.max_cursor - checkpoint.last_acked_cursor,
    updated_at: checkpoint.updated_at,
  };
}

export function ackNotificationCheckpoint(topicDir, options = {}) {
  const warnings = [];
  const cursorReport = normalizeAckCursor(options.cursor);
  if (!cursorReport.ok) {
    return {
      ok: false,
      errors: [cursorReport.error],
      warnings,
    };
  }

  const checkpointReport = readNotificationCheckpoint(topicDir, {
    consumerId: options.consumerId,
    runId: options.runId,
  });
  warnings.push(...(checkpointReport.warnings || []));
  if (!checkpointReport.ok) {
    return {
      ok: false,
      errors: checkpointReport.errors || [],
      warnings,
    };
  }

  if (cursorReport.value > checkpointReport.max_cursor) {
    return {
      ok: false,
      errors: [`cursor ${cursorReport.value} exceeds max cursor ${checkpointReport.max_cursor} for run ${checkpointReport.run_id}`],
      warnings,
    };
  }
  if (cursorReport.value < checkpointReport.last_acked_cursor) {
    return {
      ok: false,
      errors: [
        `cursor regression is forbidden: checkpoint already at ${checkpointReport.last_acked_cursor}, requested ${cursorReport.value}`,
      ],
      warnings,
    };
  }

  const updatedAt = options.updatedAt || timestampNow();
  const checkpointData = {
    protocol: CHECKPOINT_PROTOCOL,
    consumer_id: checkpointReport.consumer_id,
    run_id: checkpointReport.run_id,
    last_acked_cursor: cursorReport.value,
    updated_at: updatedAt,
  };
  const checkpointAbsPath = path.join(topicDir, checkpointReport.checkpoint_ref);
  ensureDir(path.dirname(checkpointAbsPath));
  writeYamlFile(checkpointAbsPath, checkpointData);

  return {
    ok: true,
    errors: [],
    warnings,
    consumer_id: checkpointReport.consumer_id,
    run_id: checkpointReport.run_id,
    log_ref: checkpointReport.log_ref,
    checkpoint_ref: checkpointReport.checkpoint_ref,
    exists: true,
    last_acked_cursor: cursorReport.value,
    max_cursor: checkpointReport.max_cursor,
    pending_entry_count: checkpointReport.max_cursor - cursorReport.value,
    updated_at: updatedAt,
    changed: cursorReport.value !== checkpointReport.last_acked_cursor,
  };
}

export function readNotificationsAfterAck(topicDir, options = {}) {
  const checkpointReport = readNotificationCheckpoint(topicDir, {
    consumerId: options.consumerId,
    runId: options.runId,
  });
  if (!checkpointReport.ok) {
    return checkpointReport;
  }

  const logReport = readNotificationLog(topicDir, {
    runId: checkpointReport.run_id,
    afterCursor: checkpointReport.last_acked_cursor,
  });
  const warnings = [...(checkpointReport.warnings || []), ...(logReport.warnings || [])];
  if (!logReport.ok) {
    return {
      ok: false,
      errors: logReport.errors || [],
      warnings,
    };
  }

  return {
    ...logReport,
    warnings,
    consumer_id: checkpointReport.consumer_id,
    checkpoint_ref: checkpointReport.checkpoint_ref,
    checkpoint_exists: checkpointReport.exists,
    last_acked_cursor: checkpointReport.last_acked_cursor,
  };
}
