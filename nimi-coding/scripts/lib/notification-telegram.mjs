import fs from 'node:fs';
import path from 'node:path';
import { ackNotificationCheckpoint, readNotificationsAfterAck } from './notification-checkpoint.mjs';
import { moduleRootFrom, repoRootFrom } from './module-paths.mjs';

const TELEGRAM_ADAPTER = 'notification-telegram-adapter.v1';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const REPO_ROOT = repoRootFrom(import.meta.url);
const MODULE_ROOT = moduleRootFrom(import.meta.url);

function parseEnvFile(content) {
  const output = {};
  for (const line of String(content || '').split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    if (key) {
      output[key] = value;
    }
  }
  return output;
}

function allowedEnvFilePaths(options = {}) {
  if (Array.isArray(options.envFilePaths) && options.envFilePaths.length > 0) {
    return options.envFilePaths.map((item) => path.resolve(String(item)));
  }
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const moduleRoot = path.resolve(options.moduleRoot || MODULE_ROOT);
  return [
    path.join(repoRoot, '.env'),
    path.join(moduleRoot, '.env'),
  ];
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

function normalizeTelegramApiBaseUrl(rawApiBaseUrl) {
  if (rawApiBaseUrl === undefined || rawApiBaseUrl === null || rawApiBaseUrl === '') {
    return {
      ok: true,
      value: DEFAULT_TELEGRAM_API_BASE_URL,
    };
  }
  let url;
  try {
    url = new URL(String(rawApiBaseUrl));
  } catch {
    return {
      ok: false,
      error: `telegram api base url must be a valid URL, got ${rawApiBaseUrl}`,
    };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return {
      ok: false,
      error: `telegram api base url protocol must be http or https, got ${url.protocol}`,
    };
  }
  return {
    ok: true,
    value: url.toString().replace(/\/+$/u, ''),
  };
}

function validateBotToken(rawToken) {
  const value = String(rawToken || '').trim();
  if (!value) {
    return {
      ok: false,
      error: 'TG_BOT_TOKEN is required and must be non-empty',
    };
  }
  if (!/^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/u.test(value)) {
    return {
      ok: false,
      error: 'TG_BOT_TOKEN is present but malformed',
    };
  }
  return {
    ok: true,
    value,
  };
}

function validateChatId(rawChatId) {
  const value = String(rawChatId || '').trim();
  if (!value) {
    return {
      ok: false,
      error: 'TG_CHAT_ID is required and must be non-empty',
    };
  }
  if (!/^-?[0-9]+$/u.test(value)) {
    return {
      ok: false,
      error: 'TG_CHAT_ID is present but malformed',
    };
  }
  return {
    ok: true,
    value,
  };
}

export function loadTelegramConfig(options = {}) {
  const envPaths = allowedEnvFilePaths(options);
  const layers = [];
  const envFiles = [];

  for (const envPath of envPaths) {
    const fileExists = fs.existsSync(envPath);
    envFiles.push({
      path: envPath,
      exists: fileExists,
    });
    if (!fileExists) {
      layers.push({});
      continue;
    }
    layers.push(parseEnvFile(fs.readFileSync(envPath, 'utf8')));
  }

  if (!envFiles.some((item) => item.exists)) {
    return {
      ok: false,
      errors: [
        `telegram adapter requires at least one env file: ${envPaths.join(', ')}`,
      ],
      warnings: [],
      env_files: envFiles,
    };
  }

  const mergedEnv = Object.assign({}, ...layers);
  const tokenReport = validateBotToken(mergedEnv.TG_BOT_TOKEN);
  const chatIdReport = validateChatId(mergedEnv.TG_CHAT_ID);
  const errors = [];
  if (!tokenReport.ok) {
    errors.push(tokenReport.error);
  }
  if (!chatIdReport.ok) {
    errors.push(chatIdReport.error);
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings: [],
      env_files: envFiles,
    };
  }

  return {
    ok: true,
    errors: [],
    warnings: [],
    env_files: envFiles,
    bot_token: tokenReport.value,
    chat_id: chatIdReport.value,
  };
}

function renderArtifactRefs(artifactRefs) {
  const lines = [];
  for (const [key, value] of Object.entries(artifactRefs || {})) {
    if (!value) {
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      lines.push(`${key}: ${value.join(', ')}`);
      continue;
    }
    lines.push(`${key}: ${String(value)}`);
  }
  return lines;
}

export function renderTelegramMessage(payload) {
  const lines = [
    `Notification: ${payload.event} | Topic ${payload.topic_id}`,
    `Run: ${payload.run_id}`,
    `Phase: ${payload.phase_id || '(none)'}`,
    `Status: ${payload.run_status}`,
  ];
  if (payload.reason) {
    lines.push('');
    lines.push('Reason:');
    lines.push(String(payload.reason));
  }
  if (payload.required_human_action) {
    lines.push('');
    lines.push('Required Human Action:');
    lines.push(String(payload.required_human_action));
  }
  const artifactRefLines = renderArtifactRefs(payload.artifact_refs || {});
  if (artifactRefLines.length > 0) {
    lines.push('');
    lines.push('Artifact Refs:');
    lines.push(...artifactRefLines);
  }
  return `${lines.join('\n')}\n`;
}

function buildTelegramEndpoint(apiBaseUrl, botToken) {
  return `${apiBaseUrl}/bot${botToken}/sendMessage`;
}

async function postTelegramMessage(endpoint, timeoutMs, body, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `telegram delivery returned HTTP ${response.status}${responseText.trim() ? `: ${responseText.trim().slice(0, 200)}` : ''}`,
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (error) {
      return {
        ok: false,
        error: `telegram response is not valid JSON: ${String(error.message || error)}`,
      };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'telegram response must be a JSON object',
      };
    }
    if (parsed.ok !== true) {
      return {
        ok: false,
        error: 'telegram response must contain ok=true',
      };
    }
    return {
      ok: true,
      statusCode: response.status,
    };
  } catch (error) {
    const isAbort = error && typeof error === 'object' && error.name === 'AbortError';
    return {
      ok: false,
      error: isAbort ? `telegram delivery timed out after ${timeoutMs}ms` : `telegram delivery failed: ${String(error.message || error)}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runNotifyTelegram(topicDir, options = {}) {
  const warnings = [];
  const timeoutReport = normalizeTimeoutMs(options.timeoutMs);
  if (!timeoutReport.ok) {
    return {
      ok: false,
      errors: [timeoutReport.error],
      warnings,
    };
  }
  const apiBaseUrlReport = normalizeTelegramApiBaseUrl(options.apiBaseUrl);
  if (!apiBaseUrlReport.ok) {
    return {
      ok: false,
      errors: [apiBaseUrlReport.error],
      warnings,
    };
  }

  const configReport = loadTelegramConfig(options);
  warnings.push(...(configReport.warnings || []));
  if (!configReport.ok) {
    return {
      ok: false,
      errors: configReport.errors || [],
      warnings,
      adapter: TELEGRAM_ADAPTER,
      env_files: configReport.env_files || [],
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
      adapter: TELEGRAM_ADAPTER,
      env_files: configReport.env_files,
    };
  }

  const deliveries = [];
  let lastAckedCursor = handoffReport.last_acked_cursor;
  const endpoint = buildTelegramEndpoint(apiBaseUrlReport.value, configReport.bot_token);

  for (const entry of handoffReport.entries || []) {
    const text = renderTelegramMessage(entry.payload || {});
    const deliveryReport = await postTelegramMessage(
      endpoint,
      timeoutReport.value,
      {
        chat_id: configReport.chat_id,
        text,
      },
      options.fetchImpl,
    );
    if (!deliveryReport.ok) {
      return {
        ok: false,
        errors: [`telegram delivery failed at cursor ${entry.cursor}: ${deliveryReport.error}`],
        warnings,
        adapter: TELEGRAM_ADAPTER,
        consumer_id: handoffReport.consumer_id,
        run_id: handoffReport.run_id,
        attempted_count: (handoffReport.entries || []).length,
        delivered_count: deliveries.length,
        last_acked_cursor_before: handoffReport.last_acked_cursor,
        last_acked_cursor_after: lastAckedCursor,
        env_files: configReport.env_files,
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
        errors: (ackReport.errors || []).map((error) => `ack failed after cursor ${entry.cursor} telegram delivery: ${error}`),
        warnings,
        adapter: TELEGRAM_ADAPTER,
        consumer_id: handoffReport.consumer_id,
        run_id: handoffReport.run_id,
        attempted_count: (handoffReport.entries || []).length,
        delivered_count: deliveries.length + 1,
        last_acked_cursor_before: handoffReport.last_acked_cursor,
        last_acked_cursor_after: lastAckedCursor,
        env_files: configReport.env_files,
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
    adapter: TELEGRAM_ADAPTER,
    consumer_id: handoffReport.consumer_id,
    run_id: handoffReport.run_id,
    attempted_count: (handoffReport.entries || []).length,
    delivered_count: deliveries.length,
    last_acked_cursor_before: handoffReport.last_acked_cursor,
    last_acked_cursor_after: lastAckedCursor,
    env_files: configReport.env_files,
    deliveries,
  };
}
