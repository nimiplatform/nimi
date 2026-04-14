import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { buildMergedEnv } from './live-env.mjs';

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = 'doubao-seedance-2-0-260128';
const DEFAULT_SCENARIO = 'minimal-t2v';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

const MULTIMODAL_DEMO_CONTENT = [
  {
    type: 'text',
    text: '全程使用视频1的第一视角构图，全程使用音频1作为背景音乐。第一人称视角果茶宣传广告，seedance牌「苹苹安安」苹果果茶限定款；首帧为图片1，你的手摘下一颗带晨露的阿克苏红苹果，轻脆的苹果碰撞声；2-4 秒：快速切镜，你的手将苹果块投入雪克杯，加入冰块与茶底，用力摇晃，冰块碰撞声与摇晃声卡点轻快鼓点，背景音：「鲜切现摇」；4-6 秒：第一人称成品特写，分层果茶倒入透明杯，你的手轻挤奶盖在顶部铺展，在杯身贴上粉红包标，镜头拉近看奶盖与果茶的分层纹理；6-8 秒：第一人称手持举杯，你将图片2中的果茶举到镜头前（模拟递到观众面前的视角），杯身标签清晰可见，背景音「来一口鲜爽」，尾帧定格为图片2。背景声音统一为女生音色。',
  },
  {
    type: 'image_url',
    image_url: {
      url: 'https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic1.jpg',
    },
    role: 'reference_image',
  },
  {
    type: 'image_url',
    image_url: {
      url: 'https://ark-project.tos-cn-beijing.volces.com/doc_image/r2v_tea_pic2.jpg',
    },
    role: 'reference_image',
  },
  {
    type: 'video_url',
    video_url: {
      url: 'https://ark-project.tos-cn-beijing.volces.com/doc_video/r2v_tea_video1.mp4',
    },
    role: 'reference_video',
  },
  {
    type: 'audio_url',
    audio_url: {
      url: 'https://ark-project.tos-cn-beijing.volces.com/doc_audio/r2v_tea_audio1.mp3',
    },
    role: 'reference_audio',
  },
];

const SCENARIOS = {
  'minimal-t2v': {
    description: 'Lowest-cost prompt-only smoke for create/query/delete verification.',
    request: {
      resolution: '480p',
      ratio: '16:9',
      duration: 4,
      watermark: false,
      generate_audio: false,
      content: [
        {
          type: 'text',
          text: 'A short cinematic sunrise over a calm sea, steady camera, natural light, clean composition.',
        },
      ],
    },
  },
  'multimodal-demo': {
    description: 'Official-style Seedance multimodal demo with reference images, video, and audio.',
    request: {
      ratio: '16:9',
      duration: 11,
      watermark: false,
      return_last_frame: true,
      generate_audio: true,
      content: MULTIMODAL_DEMO_CONTENT,
    },
  },
};

function hasFlag(args, flag) {
  return args.includes(flag);
}

function readArg(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return String(args[index + 1] || '').trim();
}

function parseNumberArg(args, flag, fallback) {
  const raw = readArg(args, flag);
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function resolvePath(repoRoot, candidate) {
  if (!candidate) {
    return '';
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
}

function safeJSONParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizeErrorBody(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }
  const cloned = structuredClone(value);
  if (cloned.error && typeof cloned.error === 'object') {
    delete cloned.error.stack;
  }
  return cloned;
}

function selectApiKey(env) {
  const keys = [
    'SEEDANCE_API_KEY',
    'ARK_API_KEY',
    'VOLCENGINE_API_KEY',
    'NIMI_LIVE_VOLCENGINE_API_KEY',
  ];
  for (const key of keys) {
    const value = String(env[key] || '').trim();
    if (value) {
      return { key, value };
    }
  }
  throw new Error(`missing API key; set one of ${keys.join(', ')}`);
}

function resolveModel(env, explicitModel) {
  if (explicitModel) {
    return explicitModel;
  }
  const candidates = [
    'SEEDANCE_MODEL_ID',
    'ARK_VIDEO_MODEL_ID',
    'NIMI_LIVE_VOLCENGINE_VIDEO_MODEL_ID',
  ];
  for (const key of candidates) {
    const value = String(env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return DEFAULT_MODEL;
}

function resolveBaseURL(env, explicitBaseURL) {
  if (explicitBaseURL) {
    return explicitBaseURL.replace(/\/+$/u, '');
  }
  const candidates = [
    'SEEDANCE_BASE_URL',
    'ARK_BASE_URL',
    'NIMI_LIVE_VOLCENGINE_BASE_URL',
  ];
  for (const key of candidates) {
    const value = String(env[key] || '').trim();
    if (value) {
      return value.replace(/\/+$/u, '');
    }
  }
  return DEFAULT_BASE_URL;
}

function loadRequestBody({ scenario, requestFile, requestJSON, env, model }) {
  if (requestFile) {
    const parsed = safeJSONParse(readFileSync(requestFile, 'utf8'));
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`invalid JSON request file: ${requestFile}`);
    }
    return {
      ...parsed,
      model: String(parsed.model || model).trim() || model,
    };
  }

  if (requestJSON) {
    const parsed = safeJSONParse(requestJSON);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('--request-json must be a valid JSON object');
    }
    return {
      ...parsed,
      model: String(parsed.model || model).trim() || model,
    };
  }

  const selected = SCENARIOS[scenario] || SCENARIOS[DEFAULT_SCENARIO];
  const request = structuredClone(selected.request);
  const subjectUserID = String(env.SEEDANCE_SMOKE_SUBJECT_USER_ID || '').trim();
  return {
    model,
    ...request,
    ...(subjectUserID ? { safety_identifier: subjectUserID } : {}),
  };
}

function ensureReportDir(reportPath) {
  const dir = path.dirname(reportPath);
  mkdirSync(dir, { recursive: true });
}

async function readJSONResponse(response) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  if (!text) {
    return null;
  }
  if (contentType.includes('application/json')) {
    return safeJSONParse(text, { raw_text: text });
  }
  return { raw_text: text };
}

async function arkRequest({ method, url, apiKey, body, expectEmpty = false }) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (expectEmpty && response.ok) {
    return { status: response.status, data: null };
  }

  const data = await readJSONResponse(response);
  if (!response.ok) {
    const message = data?.error?.message || data?.raw_text || `${method} ${url} failed with ${response.status}`;
    const error = new Error(String(message));
    error.name = 'ArkAPIError';
    error.status = response.status;
    error.payload = sanitizeErrorBody(data);
    throw error;
  }

  return { status: response.status, data };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyArtifactURL(url) {
  const response = await fetch(url, {
    headers: {
      Range: 'bytes=0-1023',
    },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    ok: response.ok,
    status: response.status,
    contentType: String(response.headers.get('content-type') || '').trim(),
    contentLengthHeader: String(response.headers.get('content-length') || '').trim(),
    bytesRead: bytes.length,
  };
}

function taskSummary(task) {
  if (!task || typeof task !== 'object') {
    return null;
  }
  return {
    id: String(task.id || '').trim(),
    model: String(task.model || '').trim(),
    status: String(task.status || '').trim(),
    created_at: task.created_at || null,
    updated_at: task.updated_at || null,
    error: task.error || null,
    content: task.content || null,
    generate_audio: task.generate_audio ?? null,
    resolution: task.resolution || null,
    ratio: task.ratio || null,
    duration: task.duration ?? null,
    service_tier: task.service_tier || null,
    usage: task.usage || null,
  };
}

async function createTask(context, requestBody) {
  const { baseURL, apiKey } = context;
  const result = await arkRequest({
    method: 'POST',
    url: `${baseURL}/contents/generations/tasks`,
    apiKey,
    body: requestBody,
  });
  if (!result.data?.id) {
    throw new Error('create task succeeded but response did not contain id');
  }
  return {
    httpStatus: result.status,
    task: taskSummary(result.data),
    raw: result.data,
  };
}

async function getTask(context, taskID) {
  const { baseURL, apiKey } = context;
  const result = await arkRequest({
    method: 'GET',
    url: `${baseURL}/contents/generations/tasks/${encodeURIComponent(taskID)}`,
    apiKey,
  });
  return {
    httpStatus: result.status,
    task: taskSummary(result.data),
    raw: result.data,
  };
}

async function deleteTask(context, taskID) {
  const { baseURL, apiKey } = context;
  const result = await arkRequest({
    method: 'DELETE',
    url: `${baseURL}/contents/generations/tasks/${encodeURIComponent(taskID)}`,
    apiKey,
    expectEmpty: true,
  });
  return {
    httpStatus: result.status,
    taskID,
  };
}

async function pollTask(context, taskID, timeoutMs, pollIntervalMs) {
  const startedAt = Date.now();
  const history = [];
  while (true) {
    const result = await getTask(context, taskID);
    history.push({
      at: new Date().toISOString(),
      status: result.task?.status || '',
      httpStatus: result.httpStatus,
      error: result.task?.error || null,
    });
    const status = String(result.task?.status || '').trim().toLowerCase();
    if (TERMINAL_STATUSES.has(status)) {
      return {
        final: result,
        history,
      };
    }
    if ((Date.now() - startedAt) > timeoutMs) {
      throw new Error(`poll timeout after ${Math.round(timeoutMs / 1000)}s for task ${taskID}`);
    }
    await sleep(pollIntervalMs);
  }
}

async function runSuccessFlow(context, requestBody, options) {
  const created = await createTask(context, requestBody);
  const taskID = created.task?.id;
  const queried = await getTask(context, taskID);
  const polled = await pollTask(context, taskID, options.timeoutMs, options.pollIntervalMs);
  const finalStatus = String(polled.final.task?.status || '').trim().toLowerCase();
  const artifactURL = String(polled.final.task?.content?.video_url || '').trim();
  const result = {
    request: requestBody,
    create: created,
    first_query: queried,
    poll_history: polled.history,
    final: polled.final,
    artifact_check: null,
    cleanup: null,
    cleanup_verify: null,
  };

  if (finalStatus !== 'succeeded') {
    return result;
  }

  if (!artifactURL) {
    throw new Error(`task ${taskID} succeeded but content.video_url is empty`);
  }

  if (!options.skipArtifactCheck) {
    result.artifact_check = await verifyArtifactURL(artifactURL);
  }

  if (!options.keepTasks) {
    result.cleanup = await deleteTask(context, taskID);
    try {
      await getTask(context, taskID);
      result.cleanup_verify = {
        ok: false,
        message: 'task still queryable after success cleanup delete',
      };
    } catch (error) {
      result.cleanup_verify = {
        ok: true,
        status: error.status || null,
        message: error.message || String(error),
      };
    }
  }

  return result;
}

async function runCancelDeleteFlow(context, requestBody, options) {
  const created = await createTask(context, requestBody);
  const taskID = created.task?.id;
  const result = {
    request: requestBody,
    create: created,
    cancel_attempt: null,
    cancel_poll: null,
    delete_attempt: null,
    post_delete_query: null,
    fallback_terminal_poll: null,
    fallback_delete: null,
    fallback_delete_verify: null,
  };

  try {
    result.cancel_attempt = await deleteTask(context, taskID);
  } catch (error) {
    result.cancel_attempt = {
      error: {
        name: error.name || 'Error',
        status: error.status || null,
        message: error.message || String(error),
        payload: sanitizeErrorBody(error.payload || null),
      },
    };
    if (error.status === 409) {
      try {
        result.fallback_terminal_poll = await pollTask(context, taskID, options.timeoutMs, options.pollIntervalMs);
        result.fallback_delete = await deleteTask(context, taskID);
        try {
          await getTask(context, taskID);
          result.fallback_delete_verify = {
            ok: false,
            message: 'task still queryable after fallback delete',
          };
        } catch (verifyError) {
          result.fallback_delete_verify = {
            ok: true,
            status: verifyError.status || null,
            message: verifyError.message || String(verifyError),
          };
        }
      } catch (fallbackError) {
        result.fallback_delete = {
          error: {
            name: fallbackError.name || 'Error',
            status: fallbackError.status || null,
            message: fallbackError.message || String(fallbackError),
            payload: sanitizeErrorBody(fallbackError.payload || null),
          },
        };
      }
    }
    return result;
  }

  try {
    result.cancel_poll = await pollTask(context, taskID, options.timeoutMs, options.pollIntervalMs);
  } catch (error) {
    result.cancel_poll = {
      error: {
        name: error.name || 'Error',
        status: error.status || null,
        message: error.message || String(error),
      },
    };
    return result;
  }

  const finalStatus = String(result.cancel_poll?.final?.task?.status || '').trim().toLowerCase();
  if (finalStatus === 'cancelled') {
    try {
      result.delete_attempt = await deleteTask(context, taskID);
    } catch (error) {
      result.delete_attempt = {
        error: {
          name: error.name || 'Error',
          status: error.status || null,
          message: error.message || String(error),
          payload: sanitizeErrorBody(error.payload || null),
        },
      };
      return result;
    }
    try {
      await getTask(context, taskID);
      result.post_delete_query = {
        ok: false,
        message: 'task still queryable after delete',
      };
    } catch (error) {
      result.post_delete_query = {
        ok: true,
        status: error.status || null,
        message: error.message || String(error),
      };
    }
  }

  return result;
}

function summarizeFlow(flow) {
  const successStatus = String(flow?.success_flow?.final?.task?.status || '').trim().toLowerCase();
  const cancelStatus = String(flow?.cancel_delete_flow?.cancel_poll?.final?.task?.status || '').trim().toLowerCase();
  const deleteVerified = Boolean(
    flow?.success_flow?.cleanup_verify?.ok
    || flow?.cancel_delete_flow?.post_delete_query?.ok
    || flow?.cancel_delete_flow?.fallback_delete_verify?.ok,
  );
  return {
    success_status: successStatus || 'unknown',
    cancel_status: cancelStatus || 'not-verified',
    delete_verified: deleteVerified,
  };
}

function redactEnvKey(envKey) {
  return envKey ? `${envKey}:<set>` : '<missing>';
}

export function parseSeedanceSmokeArgs({ repoRoot, argv = process.argv.slice(2) }) {
  const valueFlags = new Set([
    '--task-id',
    '--env-file',
    '--report',
    '--request-file',
    '--request-json',
    '--scenario',
    '--model',
    '--base-url',
    '--timeout-sec',
    '--poll-interval-sec',
  ]);
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] || '');
    if (!item || item.startsWith('--')) {
      if (valueFlags.has(item)) {
        index += 1;
      }
      continue;
    }
    positional.push(item);
  }
  const operation = positional[0] || 'full';
  return {
    operation,
    envFile: resolvePath(repoRoot, readArg(argv, '--env-file')),
    reportPath: resolvePath(repoRoot, readArg(argv, '--report')),
    requestFile: resolvePath(repoRoot, readArg(argv, '--request-file')),
    requestJSON: readArg(argv, '--request-json'),
    scenario: readArg(argv, '--scenario') || DEFAULT_SCENARIO,
    model: readArg(argv, '--model'),
    baseURL: readArg(argv, '--base-url'),
    taskID: readArg(argv, '--task-id'),
    timeoutMs: parseNumberArg(argv, '--timeout-sec', DEFAULT_TIMEOUT_MS / 1000) * 1000,
    pollIntervalMs: parseNumberArg(argv, '--poll-interval-sec', DEFAULT_POLL_INTERVAL_MS / 1000) * 1000,
    keepTasks: hasFlag(argv, '--keep-tasks'),
    skipArtifactCheck: hasFlag(argv, '--skip-artifact-check'),
    dryRun: hasFlag(argv, '--dry-run'),
  };
}

function normalizeOperation(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'full';
  }
  return normalized;
}

function buildContext({ repoRoot, options }) {
  const mergedEnv = buildMergedEnv({
    baseEnv: process.env,
    filePaths: options.envFile ? [options.envFile] : [path.join(repoRoot, '.env')],
  });
  const selectedKey = selectApiKey(mergedEnv);
  const model = resolveModel(mergedEnv, options.model);
  const baseURL = resolveBaseURL(mergedEnv, options.baseURL);
  const reportPath = options.reportPath || path.join(repoRoot, '.local', 'report', 'seedance-video-smoke-report.json');
  const requestBody = loadRequestBody({
    scenario: options.scenario,
    requestFile: options.requestFile,
    requestJSON: options.requestJSON,
    env: mergedEnv,
    model,
  });

  return {
    env: mergedEnv,
    apiKey: selectedKey.value,
    apiKeySource: selectedKey.key,
    baseURL,
    model,
    reportPath,
    requestBody,
    requestScenario: options.scenario,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    keepTasks: options.keepTasks,
    skipArtifactCheck: options.skipArtifactCheck,
  };
}

function minimalOptionsSummary(context, options) {
  return {
    operation: normalizeOperation(options.operation),
    base_url: context.baseURL,
    model: context.model,
    scenario: context.requestScenario,
    api_key_source: redactEnvKey(context.apiKeySource),
    env_file: options.envFile || path.join(process.cwd(), '.env'),
    report_path: context.reportPath,
    timeout_ms: context.timeoutMs,
    poll_interval_ms: context.pollIntervalMs,
    keep_tasks: context.keepTasks,
    skip_artifact_check: context.skipArtifactCheck,
  };
}

export async function runSeedanceSmoke({ repoRoot, options }) {
  const context = buildContext({ repoRoot, options });
  const normalizedOperation = normalizeOperation(options.operation);

  if (options.dryRun) {
    return {
      dry_run: true,
      options: minimalOptionsSummary(context, options),
      request: context.requestBody,
      scenario_description: SCENARIOS[context.requestScenario]?.description || null,
    };
  }

  const report = {
    started_at: new Date().toISOString(),
    options: minimalOptionsSummary(context, options),
    scenario_description: SCENARIOS[context.requestScenario]?.description || null,
    request_preview: context.requestBody,
  };

  if (normalizedOperation === 'create') {
    report.create = await createTask(context, context.requestBody);
  } else if (normalizedOperation === 'get' || normalizedOperation === 'query') {
    if (!options.taskID) {
      throw new Error(`${normalizedOperation} requires --task-id`);
    }
    report.query = await getTask(context, options.taskID);
  } else if (normalizedOperation === 'cancel') {
    if (!options.taskID) {
      throw new Error('cancel requires --task-id');
    }
    report.cancel = await deleteTask(context, options.taskID);
  } else if (normalizedOperation === 'delete') {
    if (!options.taskID) {
      throw new Error('delete requires --task-id');
    }
    report.delete = await deleteTask(context, options.taskID);
  } else if (normalizedOperation === 'success') {
    report.success_flow = await runSuccessFlow(context, context.requestBody, context);
  } else if (normalizedOperation === 'cancel-delete') {
    report.cancel_delete_flow = await runCancelDeleteFlow(context, context.requestBody, context);
  } else if (normalizedOperation === 'full' || normalizedOperation === 'smoke') {
    report.success_flow = await runSuccessFlow(context, context.requestBody, context);
    report.cancel_delete_flow = await runCancelDeleteFlow(context, context.requestBody, context);
    report.summary = summarizeFlow(report);
  } else {
    throw new Error(`unsupported operation: ${normalizedOperation}`);
  }

  report.finished_at = new Date().toISOString();
  ensureReportDir(context.reportPath);
  writeFileSync(context.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
