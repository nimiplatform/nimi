import type {
  AIConfig,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/ai';
import type {
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
} from '@renderer/bridge';
import {
  getDaemonStatus,
  hasTauriInvoke,
} from '@renderer/bridge';
import {
  isRuntimeAccountAccessUnavailable,
  isMissingRuntimeAccountService,
  loadPolyinfoRuntimeAccountUser,
} from '@renderer/infra/bootstrap/polyinfo-runtime-account.js';
import {
  fetchRuntimeHealthSummary,
  loadTextGenerateRouteOptions,
  resolveTextGenerateRouteStatus,
  type TextGenerateRouteStatus,
} from '@renderer/data/runtime-routes.js';

type AuthStatus = 'bootstrapping' | 'authenticated' | 'anonymous';

export type PolyinfoSmokeCheckStatus = 'pass' | 'warn' | 'fail';

export type PolyinfoSmokeCheck = {
  id: string;
  title: string;
  status: PolyinfoSmokeCheckStatus;
  detail: string;
};

export type PolyinfoSmokeSnapshot = {
  status: PolyinfoSmokeCheckStatus;
  completedAt: string;
  checks: PolyinfoSmokeCheck[];
};

type RuntimeHealthSummary = Awaited<ReturnType<typeof fetchRuntimeHealthSummary>>;

export type PolyinfoSmokeInput = {
  aiConfig: AIConfig;
  runtimeDefaults?: RuntimeDefaults | null;
  authStatus?: AuthStatus;
};

export type PolyinfoSmokeDeps = {
  hasTauriInvoke: () => boolean;
  getDaemonStatus: () => Promise<RuntimeBridgeDaemonStatus>;
  getRuntimeAccountStatus: () => Promise<unknown>;
  loadTextGenerateRouteOptions: typeof loadTextGenerateRouteOptions;
  fetchRuntimeHealthSummary: typeof fetchRuntimeHealthSummary;
};

const defaultDeps: PolyinfoSmokeDeps = {
  hasTauriInvoke,
  getDaemonStatus,
  getRuntimeAccountStatus: loadPolyinfoRuntimeAccountUser,
  loadTextGenerateRouteOptions,
  fetchRuntimeHealthSummary,
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

function summarizeOverallStatus(checks: PolyinfoSmokeCheck[]): PolyinfoSmokeCheckStatus {
  if (checks.some((check) => check.status === 'fail')) {
    return 'fail';
  }
  if (checks.some((check) => check.status === 'warn')) {
    return 'warn';
  }
  return 'pass';
}

function summarizeRuntimeStatus(status: RuntimeBridgeDaemonStatus): PolyinfoSmokeCheck {
  if (!status.running) {
    const lastError = normalizeText(status.lastError);
    return {
      id: 'runtime-bridge',
      title: 'Runtime bridge',
      status: 'fail',
      detail: lastError ? `runtime 未连接：${lastError}` : 'runtime 未连接。',
    };
  }

  return {
    id: 'runtime-bridge',
    title: 'Runtime bridge',
    status: 'pass',
    detail: normalizeText(status.grpcAddr) || 'runtime 已连接。',
  };
}

function summarizeRuntimeHealth(summary: RuntimeHealthSummary): PolyinfoSmokeCheck {
  const runtimeHealth = summary.runtimeHealth;
  if (!runtimeHealth) {
    return {
      id: 'runtime-health',
      title: 'Runtime health',
      status: 'warn',
      detail: 'runtime 没有返回健康状态。',
    };
  }

  const status = normalizeText(runtimeHealth.status).toLowerCase();
  const reason = normalizeText(runtimeHealth.reason);
  const ready = !status || status === 'ok' || status === 'healthy' || status === 'ready';
  return {
    id: 'runtime-health',
    title: 'Runtime health',
    status: ready ? 'pass' : 'warn',
    detail: reason || runtimeHealth.status || 'runtime 健康状态可读取。',
  };
}

function summarizeRuntimeAccountStatus(): PolyinfoSmokeCheck {
  return {
    id: 'runtime-account',
    title: 'Runtime account',
    status: 'pass',
    detail: '账号服务可读取。',
  };
}

function summarizeLoginRequiredRuntimeDetail(id: string, title: string): PolyinfoSmokeCheck {
  return {
    id,
    title,
    status: 'warn',
    detail: '当前未登录，已跳过需要账号的云端检查。',
  };
}

function summarizeRouteStatus(routeStatus: TextGenerateRouteStatus): PolyinfoSmokeCheck {
  if (routeStatus.ready) {
    return {
      id: 'analyst-route',
      title: 'Analyst route',
      status: 'pass',
      detail: routeStatus.detail,
    };
  }

  return {
    id: 'analyst-route',
    title: 'Analyst route',
    status: 'fail',
    detail: routeStatus.detail,
  };
}

function routeOptionsSummary(options: RuntimeRouteOptionsSnapshot): string {
  const localCount = options.local.models.length;
  const cloudCount = options.connectors.length;
  return `本地模型 ${localCount} 个，云端连接器 ${cloudCount} 个。`;
}

export async function runPolyinfoAppSmoke(
  input: PolyinfoSmokeInput,
  deps: PolyinfoSmokeDeps = defaultDeps,
): Promise<PolyinfoSmokeSnapshot> {
  const checks: PolyinfoSmokeCheck[] = [];
  const tauriReady = deps.hasTauriInvoke();

  checks.push({
    id: 'desktop-shell',
    title: 'Desktop shell',
    status: tauriReady ? 'pass' : 'fail',
    detail: tauriReady ? '当前在桌面 App 内。' : '当前不是桌面 App，无法验证本地 runtime 通道。',
  });

  checks.push({
    id: 'runtime-defaults',
    title: 'Runtime defaults',
    status: input.runtimeDefaults?.realm.realmBaseUrl ? 'pass' : 'fail',
    detail: input.runtimeDefaults?.realm.realmBaseUrl || '启动默认值没有准备好。',
  });

  let daemonStatus: RuntimeBridgeDaemonStatus | null = null;
  try {
    daemonStatus = await deps.getDaemonStatus();
    checks.push(summarizeRuntimeStatus(daemonStatus));
  } catch (error) {
    checks.push({
      id: 'runtime-bridge',
      title: 'Runtime bridge',
      status: 'fail',
      detail: errorMessage(error),
    });
  }

  try {
    const healthSummary = await deps.fetchRuntimeHealthSummary();
    checks.push(summarizeRuntimeHealth(healthSummary));
  } catch (error) {
    if (input.authStatus !== 'authenticated' && isRuntimeAccountAccessUnavailable(error)) {
      checks.push(summarizeLoginRequiredRuntimeDetail('runtime-health', 'Runtime health'));
    } else {
      checks.push({
        id: 'runtime-health',
        title: 'Runtime health',
        status: 'fail',
        detail: errorMessage(error),
      });
    }
  }

  try {
    await deps.getRuntimeAccountStatus();
    checks.push(summarizeRuntimeAccountStatus());
  } catch (error) {
    checks.push({
      id: 'runtime-account',
      title: 'Runtime account',
      status: 'fail',
      detail: isMissingRuntimeAccountService(error)
        ? 'runtime 版本过旧，缺少新的账号服务。请停止旧 runtime 后用最新代码重新启动。'
        : errorMessage(error),
    });
  }

  try {
    const routeOptions = await deps.loadTextGenerateRouteOptions({
      aiConfig: input.aiConfig,
      runtimeDefaults: input.runtimeDefaults,
    });
    checks.push({
      id: 'route-options',
      title: 'Route options',
      status: 'pass',
      detail: routeOptionsSummary(routeOptions),
    });
    checks.push(summarizeRouteStatus(resolveTextGenerateRouteStatus({
      aiConfig: input.aiConfig,
      runtimeDefaults: input.runtimeDefaults,
      routeOptions,
      daemonStatus,
      authStatus: input.authStatus,
    })));
  } catch (error) {
    if (input.authStatus !== 'authenticated' && isRuntimeAccountAccessUnavailable(error)) {
      checks.push(summarizeLoginRequiredRuntimeDetail('route-options', 'Route options'));
      checks.push({
        id: 'analyst-route',
        title: 'Analyst route',
        status: 'warn',
        detail: '本地/云端路由详情需要登录后重新检查。',
      });
    } else {
      checks.push({
        id: 'route-options',
        title: 'Route options',
        status: 'fail',
        detail: errorMessage(error),
      });
    }
  }

  return {
    status: summarizeOverallStatus(checks),
    completedAt: new Date().toISOString(),
    checks,
  };
}
