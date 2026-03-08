import { asNimiError, createNimiError, isNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';
import { hasTauriInvoke } from './env';
import { emitRendererLog, resolveRendererSessionTraceId, toRendererLogMessage } from './logging';
import type { RuntimeBridgeStructuredError } from './types';

const BRIDGE_ERROR_CODE_MAP: Record<string, string> = {
  LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT: '导入路径无效，请将模型放到 Local Runtime models 目录后重试',
  LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: '仅支持导入 model.manifest.json 清单文件',
  LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID: '仅支持导入 artifact.manifest.json 清单文件',
  LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND: '未找到待导入的 companion 文件，请刷新后重试',
  LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID: '请选择有效的 companion 资源类型',
  LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS: '目标 companion 目录已存在，请更换文件名或移除旧资源后重试',
  LOCAL_AI_ARTIFACT_ORPHAN_DIR_FAILED: '无法创建 companion 资源目录，请检查本地文件权限',
  LOCAL_AI_ARTIFACT_ORPHAN_MOVE_FAILED: '无法整理 companion 资源文件，请检查文件占用或权限',
  LOCAL_AI_ARTIFACT_ORPHAN_SOURCE_CLEANUP_FAILED: 'companion 文件复制后清理原文件失败，请手动检查文件状态',
  LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_SERIALIZE_FAILED: 'companion 清单生成失败，请重试',
  LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_WRITE_FAILED: 'companion 清单写入失败，请检查本地文件权限',
  LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND: '未找到模型清单文件，请检查导入路径',
  LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED: '模型清单解析失败，请检查 JSON 格式',
  LOCAL_AI_IMPORT_HASH_MISMATCH: '模型文件校验失败，请确认文件完整后重试',
  LOCAL_AI_ENDPOINT_NOT_LOOPBACK: '本地运行时 endpoint 仅支持 localhost/127.0.0.1/[::1]',
  LOCAL_AI_ENDPOINT_INVALID: '本地运行时 endpoint 格式无效，请检查地址',
  LOCAL_AI_MODEL_NOT_FOUND: '未找到可用模型，请先安装并启用模型',
  LOCAL_AI_MODEL_HASHES_EMPTY: '模型未完成完整性校验，无法启动',
  LOCAL_AI_MODEL_CAPABILITY_INVALID: '模型能力配置无效，请检查 manifest.capabilities',
  LOCAL_AI_HF_DOWNLOAD_INTERRUPTED: '下载已中断，重启后请手动恢复任务',
  LOCAL_AI_HF_DOWNLOAD_PAUSED: '下载已暂停，可稍后继续',
  LOCAL_AI_HF_DOWNLOAD_CANCELLED: '下载已取消',
  LOCAL_AI_HF_DOWNLOAD_DISK_FULL: '磁盘空间不足，请释放空间后继续下载',
  LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: '模型文件校验失败，请重新下载',
  LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE: '当前下载会话不可恢复，请重新安装模型',
  LOCAL_AI_HF_DOWNLOAD_SESSION_EXISTS: '该模型已有进行中的下载任务',
  LOCAL_AI_DOWNLOAD_SESSION_NOT_FOUND: '未找到下载会话，请刷新后重试',
  LOCAL_LIFECYCLE_WRITE_DENIED: '当前来源无权执行模型生命周期写操作',
  RUNTIME_ROUTE_CAPABILITY_MISMATCH: '当前路由绑定的本地模型不具备所需能力，请切换匹配模型',
  LOCAL_AI_QWEN_GPU_REQUIRED: 'Qwen TTS 需要可用 NVIDIA GPU，本机未检测到支持环境',
  LOCAL_AI_QWEN_PYTHON_REQUIRED: 'Qwen TTS 需要 Python 3.10+，请先安装后重试',
  LOCAL_AI_QWEN_PYTHON_VERSION_UNSUPPORTED: 'Qwen TTS 需要 Python 3.10+，当前版本不满足要求',
  LOCAL_AI_QWEN_BOOTSTRAP_FAILED: 'Qwen TTS 运行时依赖安装失败，请检查 Python/pip 与网络环境',

  // Phase 1: AI Provider reason codes (D-ERR-007)
  AI_PROVIDER_TIMEOUT: 'AI 服务超时',
  AI_PROVIDER_UNAVAILABLE: 'AI 服务不可用',
  AI_PROVIDER_RATE_LIMITED: 'AI 服务请求频率受限',
  AI_PROVIDER_INTERNAL: 'AI 服务内部错误',
  AI_PROVIDER_ENDPOINT_FORBIDDEN: 'AI 服务端点被禁止',
  AI_PROVIDER_AUTH_FAILED: 'AI 服务认证失败',
  AI_STREAM_BROKEN: 'AI 流式响应中断',

  // Phase 1: AI Connector reason codes
  AI_CONNECTOR_CREDENTIAL_MISSING: 'AI 连接器凭证缺失',
  AI_CONNECTOR_DISABLED: 'AI 连接器已禁用',
  AI_CONNECTOR_NOT_FOUND: 'AI 连接器未找到',
  AI_CONNECTOR_INVALID: 'AI 连接器配置无效',
  AI_CONNECTOR_IMMUTABLE: 'AI 连接器不可修改',
  AI_CONNECTOR_LIMIT_EXCEEDED: 'AI 连接器数量超限',

  // Phase 1: AI Model reason codes
  AI_MODEL_NOT_FOUND: 'AI 模型未找到',
  AI_MODALITY_NOT_SUPPORTED: 'AI 模态不支持',
  AI_MODEL_PROVIDER_MISMATCH: 'AI 模型与供应商不匹配',

  // Phase 1: AI Media reason codes
  AI_MEDIA_IDEMPOTENCY_CONFLICT: '媒体任务幂等冲突',
  AI_MEDIA_JOB_NOT_FOUND: '媒体任务未找到',
  AI_MEDIA_SPEC_INVALID: '媒体规格无效',
  AI_MEDIA_OPTION_UNSUPPORTED: '媒体选项不支持',
  AI_MEDIA_JOB_NOT_CANCELLABLE: '媒体任务不可取消',

  // Phase 1: AI Local Model reason codes
  AI_LOCAL_MODEL_UNAVAILABLE: '本地模型不可用',
  AI_LOCAL_MODEL_PROFILE_MISSING: '本地模型配置缺失',
  AI_LOCAL_MODEL_ALREADY_INSTALLED: '本地模型已安装',
  AI_LOCAL_ENDPOINT_REQUIRED: '本地 AI 端点配置缺失',
  AI_LOCAL_TEMPLATE_NOT_FOUND: '本地模板未找到',
  AI_LOCAL_MANIFEST_INVALID: '本地清单无效',

  // Phase 1: Auth & Session reason codes
  AUTH_TOKEN_INVALID: '认证令牌无效',
  SESSION_EXPIRED: '会话已过期',

  // Phase 1: App Mode reason codes
  APP_MODE_DOMAIN_FORBIDDEN: '应用模式域禁止',
  APP_MODE_SCOPE_FORBIDDEN: '应用模式范围禁止',
  APP_MODE_MANIFEST_INVALID: '应用模式清单无效',

  // Phase 1: Runtime reason codes
  RUNTIME_UNAVAILABLE: '运行时不可用',
  RUNTIME_BRIDGE_DAEMON_UNAVAILABLE: '运行时守护进程不可用',
};

const BRIDGE_ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /桥接不可用|Tauri.*不可用/i, message: '桌面运行时未就绪，请重启应用' },
  { pattern: /不支持的协议/i, message: '请求地址无效，请检查配置' },
  { pattern: /当前环境不支持/i, message: '当前环境暂不支持此功能' },
  { pattern: /请求载荷无效/i, message: '请求参数异常，请重试' },
  { pattern: /HF 下载失败|hugging ?face|download failed/i, message: '模型下载失败，请检查网络或仓库地址' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_DISK_FULL|ENOSPC|disk full/i, message: '磁盘空间不足，请释放空间后继续下载' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_INTERRUPTED|interrupted/i, message: '下载已中断，请手动恢复下载任务' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_PAUSED|paused/i, message: '下载已暂停' },
  { pattern: /LOCAL_AI_HF_DOWNLOAD_CANCELLED|cancelled/i, message: '下载已取消' },
  { pattern: /hash 校验失败|checksum|sha256/i, message: '模型文件校验失败，请重新下载或导入' },
  { pattern: /LOCAL_AI_QWEN_GPU_REQUIRED|NVIDIA GPU/i, message: 'Qwen TTS 需要可用 NVIDIA GPU' },
  { pattern: /LOCAL_AI_QWEN_PYTHON_REQUIRED|Python 3\\.10/i, message: 'Qwen TTS 需要 Python 3.10+' },
  { pattern: /LOCAL_AI_QWEN_BOOTSTRAP_FAILED|qwen-tts-python|pip install/i, message: 'Qwen TTS 环境初始化失败，请检查 Python 与依赖安装' },
  { pattern: /manifest.*不能为空|manifest.*失败|model\.manifest\.json/i, message: '模型清单无效，请检查 manifest 文件' },
  { pattern: /模型不存在|model.*missing|RUNTIME_ROUTE_MODEL_MISSING/i, message: '未找到可用模型，请先安装并启用模型' },
  { pattern: /connector.*missing|RUNTIME_ROUTE_CONNECTOR/i, message: 'Token API 连接器不可用，请检查连接器配置' },
  { pattern: /RUNTIME_ROUTE_CAPABILITY_MISMATCH|capability mismatch/i, message: '当前路由绑定模型能力不匹配，请切换模型' },
  { pattern: /unhealthy|engine.*failed|llama\.cpp/i, message: '本地引擎不可用，请检查引擎状态或二进制路径' },
  { pattern: /LOCAL_LIFECYCLE_WRITE_DENIED/i, message: '当前来源无权执行模型生命周期写操作' },
];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseBridgeJsonPayload(input: unknown): RuntimeBridgeStructuredError | null {
  if (!input) {
    return null;
  }
  const directRecord = asRecord(input);
  if (Object.keys(directRecord).length > 0) {
    const reasonCode = String(directRecord.reasonCode || directRecord.reason_code || '').trim();
    const actionHint = String(directRecord.actionHint || directRecord.action_hint || '').trim();
    const traceId = String(directRecord.traceId || directRecord.trace_id || '').trim();
    const message = String(directRecord.message || '').trim();
    const retryableRaw = directRecord.retryable;
    const retryable = typeof retryableRaw === 'boolean'
      ? retryableRaw
      : undefined;
    const hasStructuredFields = Boolean(
      reasonCode
      || actionHint
      || traceId
      || typeof retryable === 'boolean',
    );
    if (!hasStructuredFields) {
      return null;
    }
    return {
      code: String(directRecord.code || '').trim() || undefined,
      reasonCode: reasonCode || undefined,
      actionHint: actionHint || undefined,
      traceId: traceId || undefined,
      retryable,
      message: message || undefined,
      details: asRecord(directRecord.details),
    };
  }

  const raw = String(input || '').trim();
  if (!raw) {
    return null;
  }
  const parseObject = (candidate: string): RuntimeBridgeStructuredError | null => {
    try {
      return parseBridgeJsonPayload(JSON.parse(candidate));
    } catch {
      return null;
    }
  };

  const directParsed = parseObject(raw);
  if (directParsed) {
    return directParsed;
  }
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    return parseObject(raw.slice(braceStart, braceEnd + 1));
  }
  return null;
}

function extractBridgeErrorCode(raw: string): string {
  const normalized = String(raw || '').trim();
  const matched = normalized.match(/^([A-Z0-9_]+):/);
  return matched?.[1] || '';
}

export function toBridgeUserMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const codeFromNimiError = isNimiError(error) ? String(error.reasonCode || '').trim() : '';
  const codeFromPayload = parseBridgeJsonPayload(error)?.reasonCode || '';
  const errorCode = codeFromNimiError || codeFromPayload || extractBridgeErrorCode(raw);
  if (errorCode && BRIDGE_ERROR_CODE_MAP[errorCode]) {
    return BRIDGE_ERROR_CODE_MAP[errorCode];
  }
  for (const entry of BRIDGE_ERROR_MAP) {
    if (entry.pattern.test(raw)) {
      return entry.message;
    }
  }
  return raw || '操作失败，请稍后重试';
}

export function toBridgeNimiError(error: unknown): NimiError {
  const rawMessage = error instanceof Error ? error.message : String(error || '');
  const normalized: NimiError = (() => {
    if (isNimiError(error)) {
      return error;
    }

    const parsedPayload = parseBridgeJsonPayload(error) || parseBridgeJsonPayload(rawMessage);
    if (parsedPayload) {
      return createNimiError({
        message: parsedPayload.message || rawMessage || 'Runtime call failed',
        code: parsedPayload.code || parsedPayload.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
        reasonCode: parsedPayload.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
        actionHint: parsedPayload.actionHint || 'retry_or_check_runtime_status',
        traceId: parsedPayload.traceId || '',
        retryable: parsedPayload.retryable ?? false,
        source: 'runtime',
        details: parsedPayload.details,
      });
    }

    const prefixedCode = extractBridgeErrorCode(rawMessage);
    if (prefixedCode) {
      return createNimiError({
        message: rawMessage || prefixedCode,
        code: prefixedCode,
        reasonCode: prefixedCode,
        actionHint: 'check_runtime_bridge_logs',
        source: 'runtime',
      });
    }

    return asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: 'retry_or_check_runtime_status',
      source: 'runtime',
    });
  })();

  const userMessage = toBridgeUserMessage(normalized);
  normalized.details = {
    ...(normalized.details || {}),
    userMessage,
    rawMessage: rawMessage || normalized.message,
  };
  return normalized;
}

export function toBridgeUserError(error: unknown): NimiError {
  return toBridgeNimiError(error);
}

function summarizeInvokePayload(command: string, payload: unknown): Record<string, unknown> {
  if (command !== 'http_request' || !payload || typeof payload !== 'object') {
    return {};
  }

  const root = payload as Record<string, unknown>;
  const inner = root.payload && typeof root.payload === 'object'
    ? (root.payload as Record<string, unknown>)
    : {};
  const url = String(inner.url || '').trim();
  const method = String(inner.method || 'GET').toUpperCase();
  const body = typeof inner.body === 'string' ? inner.body : '';

  return {
    requestUrl: url,
    requestMethod: method,
    requestBodyBytes: body.length,
  };
}

type TauriInvokeFn = (command: string, payload?: unknown) => Promise<unknown>;

function resolveTauriInvoke(): TauriInvokeFn {
  const invokeFn = window.__TAURI__?.core?.invoke;
  if (typeof invokeFn !== 'function') {
    throw toBridgeNimiError(new Error('RUNTIME_UNAVAILABLE: Tauri 运行时桥接不可用'));
  }
  return invokeFn.bind(window.__TAURI__?.core);
}

export async function invoke(command: string, payload: unknown = {}): Promise<unknown> {
  const startedAt = performance.now();
  if (!hasTauriInvoke()) {
    throw toBridgeNimiError(new Error('RUNTIME_UNAVAILABLE: Tauri 运行时桥接不可用'));
  }
  const tauriInvoke = resolveTauriInvoke();
  const invokeId = `${command}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionTraceId = resolveRendererSessionTraceId();
  const payloadSummary = summarizeInvokePayload(command, payload);
  const commandLog = {
    level: 'debug' as const,
    area: 'bridge',
    message: toRendererLogMessage(`action:invoke-start:${command}`),
    details: {
      invokeId,
      command,
      hasPayload: Boolean(payload),
      sessionTraceId,
      ...payloadSummary,
    },
  };
  void emitRendererLog(commandLog);
  try {
    const result = await tauriInvoke(command, payload);
    const costMs = Number((performance.now() - startedAt).toFixed(2));
    void emitRendererLog({
      level: 'debug',
      area: 'bridge',
      message: toRendererLogMessage(`action:invoke-success:${command}`),
      details: {
        invokeId,
        command,
        costMs,
        sessionTraceId,
        ...payloadSummary,
      },
      costMs,
    });
    return result;
  } catch (error) {
    const bridgeError = toBridgeNimiError(error);
    const costMs = Number((performance.now() - startedAt).toFixed(2));
    const rawMessage = String(bridgeError.details?.rawMessage || bridgeError.message || '').trim();
    void emitRendererLog({
      level: 'error',
      area: 'bridge',
      message: toRendererLogMessage(`action:invoke-failed:${command}`),
      details: {
        invokeId,
        command,
        costMs,
        sessionTraceId,
        ...payloadSummary,
        reasonCode: bridgeError.reasonCode,
        actionHint: bridgeError.actionHint,
        traceId: bridgeError.traceId || null,
        retryable: bridgeError.retryable,
        rawMessage,
        userMessage: bridgeError.details?.userMessage,
      },
      costMs,
    });
    throw bridgeError;
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: unknown,
  parseResult: (value: unknown) => T,
): Promise<T> {
  return parseResult(await invoke(command, payload));
}
