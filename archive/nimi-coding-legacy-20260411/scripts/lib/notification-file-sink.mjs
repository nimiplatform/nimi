import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, timestampNow } from './doc-utils.mjs';
import { ackNotificationCheckpoint, readNotificationsAfterAck } from './notification-checkpoint.mjs';

const FILE_SINK_ADAPTER = 'notification-file-sink.v1';

function normalizeSinkDir(rawSinkDir) {
  if (typeof rawSinkDir !== 'string' || rawSinkDir.trim() === '') {
    return {
      ok: false,
      error: 'sink_dir is required',
    };
  }
  return {
    ok: true,
    value: path.resolve(rawSinkDir),
  };
}

function sanitizeName(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120) || 'entry';
}

function deliveryFileName(consumerId, runId, cursor, event) {
  return `${sanitizeName(consumerId)}--${sanitizeName(runId)}--${String(cursor).padStart(6, '0')}--${sanitizeName(event)}.json`;
}

function writeDeliveredEnvelope(sinkDir, consumerId, runId, entry, deliveredAt) {
  ensureDir(sinkDir);
  const filePath = path.join(sinkDir, deliveryFileName(consumerId, runId, entry.cursor, entry.payload?.event));
  const envelope = {
    adapter: FILE_SINK_ADAPTER,
    consumer_id: consumerId,
    run_id: runId,
    cursor: entry.cursor,
    delivered_at: deliveredAt,
    payload: entry.payload,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  return filePath;
}

export function runNotifyFileSink(topicDir, options = {}) {
  const warnings = [];
  const sinkDirReport = normalizeSinkDir(options.sinkDir);
  if (!sinkDirReport.ok) {
    return {
      ok: false,
      errors: [sinkDirReport.error],
      warnings,
    };
  }

  const handoffReport = readNotificationsAfterAck(topicDir, {
    consumerId: options.consumerId,
    runId: options.runId,
  });
  warnings.push(...(handoffReport.warnings || []));
  if (!handoffReport.ok) {
    return {
      ok: false,
      errors: handoffReport.errors || [],
      warnings,
    };
  }

  const deliveries = [];
  let lastAckedCursor = handoffReport.last_acked_cursor;

  for (const entry of handoffReport.entries || []) {
    const deliveredAt = timestampNow();
    let deliveredPath;
    try {
      deliveredPath = writeDeliveredEnvelope(
        sinkDirReport.value,
        handoffReport.consumer_id,
        handoffReport.run_id,
        entry,
        deliveredAt,
      );
    } catch (error) {
      return {
        ok: false,
        errors: [`file-sink delivery failed at cursor ${entry.cursor}: ${String(error.message || error)}`],
        warnings,
        adapter: FILE_SINK_ADAPTER,
        consumer_id: handoffReport.consumer_id,
        run_id: handoffReport.run_id,
        sink_dir: sinkDirReport.value,
        attempted_count: (handoffReport.entries || []).length,
        delivered_count: deliveries.length,
        last_acked_cursor_before: handoffReport.last_acked_cursor,
        last_acked_cursor_after: lastAckedCursor,
        deliveries,
        failed_cursor: entry.cursor,
      };
    }

    const ackReport = ackNotificationCheckpoint(topicDir, {
      consumerId: handoffReport.consumer_id,
      runId: handoffReport.run_id,
      cursor: entry.cursor,
    });
    warnings.push(...(ackReport.warnings || []));
    if (!ackReport.ok) {
      return {
        ok: false,
        errors: (ackReport.errors || []).map((error) => `ack failed after cursor ${entry.cursor} delivery: ${error}`),
        warnings,
        adapter: FILE_SINK_ADAPTER,
        consumer_id: handoffReport.consumer_id,
        run_id: handoffReport.run_id,
        sink_dir: sinkDirReport.value,
        attempted_count: (handoffReport.entries || []).length,
        delivered_count: deliveries.length + 1,
        last_acked_cursor_before: handoffReport.last_acked_cursor,
        last_acked_cursor_after: lastAckedCursor,
        deliveries: [
          ...deliveries,
          {
            cursor: entry.cursor,
            correlation_id: entry.payload?.correlation_id || null,
            file_path: deliveredPath,
            acked: false,
          },
        ],
        failed_cursor: entry.cursor,
      };
    }

    lastAckedCursor = ackReport.last_acked_cursor;
    deliveries.push({
      cursor: entry.cursor,
      correlation_id: entry.payload?.correlation_id || null,
      file_path: deliveredPath,
      acked: true,
    });
  }

  return {
    ok: true,
    errors: [],
    warnings,
    adapter: FILE_SINK_ADAPTER,
    consumer_id: handoffReport.consumer_id,
    run_id: handoffReport.run_id,
    sink_dir: sinkDirReport.value,
    attempted_count: (handoffReport.entries || []).length,
    delivered_count: deliveries.length,
    last_acked_cursor_before: handoffReport.last_acked_cursor,
    last_acked_cursor_after: lastAckedCursor,
    deliveries,
  };
}
