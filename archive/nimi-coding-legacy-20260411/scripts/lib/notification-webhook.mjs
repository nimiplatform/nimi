import { ackNotificationCheckpoint, readNotificationsAfterAck } from './notification-checkpoint.mjs';

const WEBHOOK_ADAPTER = 'notification-webhook-adapter.v1';
const DEFAULT_TIMEOUT_MS = 10000;

function normalizeEndpoint(rawEndpoint) {
  if (typeof rawEndpoint !== 'string' || rawEndpoint.trim() === '') {
    return {
      ok: false,
      error: 'endpoint is required',
    };
  }
  let url;
  try {
    url = new URL(rawEndpoint);
  } catch {
    return {
      ok: false,
      error: `endpoint must be a valid URL, got ${rawEndpoint}`,
    };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      ok: false,
      error: `endpoint protocol must be http or https, got ${url.protocol}`,
    };
  }
  return {
    ok: true,
    value: url.toString(),
  };
}

function normalizeTimeoutMs(rawTimeoutMs) {
  if (rawTimeoutMs === undefined || rawTimeoutMs === null || rawTimeoutMs === '') {
    return {
      ok: true,
      value: DEFAULT_TIMEOUT_MS,
    };
  }
  const parsed = Number(rawTimeoutMs);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return {
      ok: false,
      error: `timeout_ms must be a positive integer, got ${rawTimeoutMs}`,
    };
  }
  return {
    ok: true,
    value: parsed,
  };
}

function parseHeaderLine(rawHeaderLine) {
  if (typeof rawHeaderLine !== 'string' || rawHeaderLine.trim() === '') {
    return {
      ok: false,
      error: 'header must be a non-empty string formatted as Name: Value',
    };
  }
  const separatorIndex = rawHeaderLine.indexOf(':');
  if (separatorIndex <= 0) {
    return {
      ok: false,
      error: `header must be formatted as Name: Value, got ${rawHeaderLine}`,
    };
  }
  const name = rawHeaderLine.slice(0, separatorIndex).trim();
  const value = rawHeaderLine.slice(separatorIndex + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) {
    return {
      ok: false,
      error: `header name is invalid: ${name}`,
    };
  }
  if (value.includes('\r') || value.includes('\n')) {
    return {
      ok: false,
      error: `header value must not contain newlines: ${name}`,
    };
  }
  return {
    ok: true,
    header: [name, value],
  };
}

function normalizeHeaders(rawHeaderLines) {
  const errors = [];
  const headers = new Headers();
  for (const rawHeaderLine of rawHeaderLines || []) {
    const report = parseHeaderLine(rawHeaderLine);
    if (!report.ok) {
      errors.push(report.error);
      continue;
    }
    headers.set(report.header[0], report.header[1]);
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('accept', 'application/json, text/plain;q=0.9, */*;q=0.1');
  return {
    ok: true,
    headers,
  };
}

function buildWebhookEnvelope(handoffReport, entry) {
  return {
    adapter: WEBHOOK_ADAPTER,
    consumer_id: handoffReport.consumer_id,
    run_id: handoffReport.run_id,
    cursor: entry.cursor,
    payload: entry.payload,
  };
}

async function postWebhookEntry(endpoint, headers, timeoutMs, body) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || null;
    if (!response.ok) {
      return {
        ok: false,
        error: `webhook delivery returned HTTP ${response.status}${responseText.trim() ? `: ${responseText.trim().slice(0, 200)}` : ''}`,
      };
    }
    if (responseText.trim() !== '' && contentType && /\bjson\b/iu.test(contentType)) {
      try {
        JSON.parse(responseText);
      } catch (error) {
        return {
          ok: false,
          error: `webhook response declared JSON but could not be parsed: ${String(error.message || error)}`,
        };
      }
    }
    return {
      ok: true,
      statusCode: response.status,
      contentType,
    };
  } catch (error) {
    const isAbort = error && typeof error === 'object' && error.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `webhook delivery timed out after ${timeoutMs}ms` : `webhook delivery failed: ${String(error.message || error)}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runNotifyWebhook(topicDir, options = {}) {
  const warnings = [];
  const endpointReport = normalizeEndpoint(options.endpoint);
  if (!endpointReport.ok) {
    return {
      ok: false,
      errors: [endpointReport.error],
      warnings,
    };
  }
  const timeoutReport = normalizeTimeoutMs(options.timeoutMs);
  if (!timeoutReport.ok) {
    return {
      ok: false,
      errors: [timeoutReport.error],
      warnings,
    };
  }
  const headersReport = normalizeHeaders(options.headerLines || []);
  if (!headersReport.ok) {
    return {
      ok: false,
      errors: headersReport.errors,
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
    const deliveryReport = await postWebhookEntry(
      endpointReport.value,
      headersReport.headers,
      timeoutReport.value,
      buildWebhookEnvelope(handoffReport, entry),
    );
    if (!deliveryReport.ok) {
      return {
        ok: false,
        errors: [`webhook delivery failed at cursor ${entry.cursor}: ${deliveryReport.error}`],
        warnings,
        adapter: WEBHOOK_ADAPTER,
        consumer_id: handoffReport.consumer_id,
        run_id: handoffReport.run_id,
        endpoint: endpointReport.value,
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
        errors: (ackReport.errors || []).map((error) => `ack failed after cursor ${entry.cursor} webhook delivery: ${error}`),
        warnings,
        adapter: WEBHOOK_ADAPTER,
        consumer_id: handoffReport.consumer_id,
        run_id: handoffReport.run_id,
        endpoint: endpointReport.value,
        attempted_count: (handoffReport.entries || []).length,
        delivered_count: deliveries.length + 1,
        last_acked_cursor_before: handoffReport.last_acked_cursor,
        last_acked_cursor_after: lastAckedCursor,
        deliveries: [
          ...deliveries,
          {
            cursor: entry.cursor,
            correlation_id: entry.payload?.correlation_id || null,
            status_code: deliveryReport.statusCode,
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
      status_code: deliveryReport.statusCode,
      acked: true,
    });
  }

  return {
    ok: true,
    errors: [],
    warnings,
    adapter: WEBHOOK_ADAPTER,
    consumer_id: handoffReport.consumer_id,
    run_id: handoffReport.run_id,
    endpoint: endpointReport.value,
    attempted_count: (handoffReport.entries || []).length,
    delivered_count: deliveries.length,
    last_acked_cursor_before: handoffReport.last_acked_cursor,
    last_acked_cursor_after: lastAckedCursor,
    deliveries,
  };
}
