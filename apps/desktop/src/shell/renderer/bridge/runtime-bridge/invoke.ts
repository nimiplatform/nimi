import { hasTauriInvoke } from './env';
import { emitRendererLog, resolveRendererSessionTraceId, toRendererLogMessage } from './logging';

const BRIDGE_ERROR_CODE_MAP: Record<string, string> = {
  LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT: '导入路径无效，请将模型放到 Local Runtime models 目录后重试',
  LOCAL_AI_IMPORT_MANIFEST_FILE_NAME_INVALID: '仅支持导入 model.manifest.json 清单文件',
  LOCAL_AI_IMPORT_MANIFEST_NOT_FOUND: '未找到模型清单文件，请检查导入路径',
  LOCAL_AI_IMPORT_MANIFEST_PARSE_FAILED: '模型清单解析失败，请检查 JSON 格式',
  LOCAL_AI_IMPORT_HASH_MISMATCH: '模型文件校验失败，请确认文件完整后重试',
  LOCAL_AI_ENDPOINT_NOT_LOOPBACK: '本地运行时 endpoint 仅支持 localhost/127.0.0.1/[::1]',
  LOCAL_AI_ENDPOINT_INVALID: '本地运行时 endpoint 格式无效，请检查地址',
  LOCAL_AI_MODEL_NOT_FOUND: '未找到可用模型，请先安装并启用模型',
  LOCAL_AI_MODEL_HASHES_EMPTY: '模型未完成完整性校验，无法启动',
  LOCAL_AI_MODEL_CAPABILITY_INVALID: '模型能力配置无效，请检查 manifest.capabilities',
  LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED: '当前来源无权执行模型生命周期写操作',
  RUNTIME_ROUTE_CAPABILITY_MISMATCH: '当前路由绑定的本地模型不具备所需能力，请切换匹配模型',
  LOCAL_AI_QWEN_GPU_REQUIRED: 'Qwen TTS 需要可用 NVIDIA GPU，本机未检测到支持环境',
  LOCAL_AI_QWEN_PYTHON_REQUIRED: 'Qwen TTS 需要 Python 3.10+，请先安装后重试',
  LOCAL_AI_QWEN_PYTHON_VERSION_UNSUPPORTED: 'Qwen TTS 需要 Python 3.10+，当前版本不满足要求',
  LOCAL_AI_QWEN_BOOTSTRAP_FAILED: 'Qwen TTS 运行时依赖安装失败，请检查 Python/pip 与网络环境',
};

const BRIDGE_ERROR_MAP: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /桥接不可用|Tauri.*不可用/i, message: '桌面运行时未就绪，请重启应用' },
  { pattern: /不支持的协议/i, message: '请求地址无效，请检查配置' },
  { pattern: /当前环境不支持/i, message: '当前环境暂不支持此功能' },
  { pattern: /请求载荷无效/i, message: '请求参数异常，请重试' },
  { pattern: /HF 下载失败|hugging ?face|download failed/i, message: '模型下载失败，请检查网络或仓库地址' },
  { pattern: /hash 校验失败|checksum|sha256/i, message: '模型文件校验失败，请重新下载或导入' },
  { pattern: /LOCAL_AI_QWEN_GPU_REQUIRED|NVIDIA GPU/i, message: 'Qwen TTS 需要可用 NVIDIA GPU' },
  { pattern: /LOCAL_AI_QWEN_PYTHON_REQUIRED|Python 3\\.10/i, message: 'Qwen TTS 需要 Python 3.10+' },
  { pattern: /LOCAL_AI_QWEN_BOOTSTRAP_FAILED|qwen-tts-python|pip install/i, message: 'Qwen TTS 环境初始化失败，请检查 Python 与依赖安装' },
  { pattern: /manifest.*不能为空|manifest.*失败|model\.manifest\.json/i, message: '模型清单无效，请检查 manifest 文件' },
  { pattern: /模型不存在|model.*missing|RUNTIME_ROUTE_MODEL_MISSING/i, message: '未找到可用模型，请先安装并启用模型' },
  { pattern: /connector.*missing|RUNTIME_ROUTE_CONNECTOR/i, message: 'Token API 连接器不可用，请检查连接器配置' },
  { pattern: /RUNTIME_ROUTE_CAPABILITY_MISMATCH|capability mismatch/i, message: '当前路由绑定模型能力不匹配，请切换模型' },
  { pattern: /unhealthy|engine.*failed|llama\.cpp/i, message: '本地引擎不可用，请检查引擎状态或二进制路径' },
  { pattern: /LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED/i, message: '当前来源无权执行模型生命周期写操作' },
];

function extractBridgeErrorCode(raw: string): string {
  const normalized = String(raw || '').trim();
  const matched = normalized.match(/^([A-Z0-9_]+):/);
  return matched?.[1] || '';
}

export function toBridgeUserError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error || '');
  const errorCode = extractBridgeErrorCode(raw);
  if (errorCode && BRIDGE_ERROR_CODE_MAP[errorCode]) {
    return new Error(BRIDGE_ERROR_CODE_MAP[errorCode]);
  }
  for (const entry of BRIDGE_ERROR_MAP) {
    if (entry.pattern.test(raw)) {
      return new Error(entry.message);
    }
  }
  return error instanceof Error ? error : new Error('操作失败，请稍后重试');
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
    throw toBridgeUserError(new Error('Tauri 运行时桥接不可用'));
  }
  return invokeFn.bind(window.__TAURI__?.core);
}

export async function invoke(command: string, payload: unknown = {}): Promise<unknown> {
  const startedAt = performance.now();
  if (!hasTauriInvoke()) {
    throw toBridgeUserError(new Error('Tauri 运行时桥接不可用'));
  }
  const tauriInvoke = resolveTauriInvoke();
  const invokeId = `${command}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const sessionTraceId = resolveRendererSessionTraceId();
  const payloadSummary = summarizeInvokePayload(command, payload);
  const commandLog = {
    level: 'info' as const,
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
    const costMs = Number((performance.now() - startedAt).toFixed(2));
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
        error: error instanceof Error ? error.message : String(error || ''),
      },
      costMs,
    });
    throw toBridgeUserError(error);
  }
}

export async function invokeChecked<T>(
  command: string,
  payload: unknown,
  parseResult: (value: unknown) => T,
): Promise<T> {
  return parseResult(await invoke(command, payload));
}
