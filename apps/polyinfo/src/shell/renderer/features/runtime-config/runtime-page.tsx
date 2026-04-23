import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getDaemonStatus,
  restartDaemon,
  startDaemon,
  stopDaemon,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  fetchRuntimeHealthSummary,
  getTextGenerateBinding,
  loadTextGenerateRouteOptions,
  resolveTextGenerateRouteStatus,
  summarizeRuntimeBinding,
  updateTextGenerateBinding,
} from '@renderer/data/runtime-routes.js';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-semibold text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function RuntimeBadge({ label, tone }: { label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const classes = tone === 'good'
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
    : tone === 'warn'
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
      : tone === 'bad'
        ? 'border-rose-400/20 bg-rose-400/10 text-rose-100'
        : 'border-white/10 bg-white/[0.03] text-slate-300';
  return (
    <span className={`rounded-md border px-3 py-2 text-xs ${classes}`}>
      {label}
    </span>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 break-all text-sm text-white">{value}</p>
    </div>
  );
}

export function RuntimePage() {
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const aiConfig = useAppStore((state) => state.aiConfig);
  const setAIConfig = useAppStore((state) => state.setAIConfig);
  const auth = useAppStore((state) => state.auth);
  const [daemonActionBusy, setDaemonActionBusy] = useState<'start' | 'restart' | 'stop' | null>(null);
  const [daemonActionError, setDaemonActionError] = useState('');

  const daemonQuery = useQuery({
    queryKey: ['polyinfo', 'runtime-daemon-status'],
    queryFn: () => getDaemonStatus(),
    refetchInterval: 10_000,
    retry: false,
  });

  const routeOptionsQuery = useQuery({
    queryKey: ['polyinfo', 'runtime-route-options', JSON.stringify(aiConfig.capabilities.selectedBindings['text.generate'] || null)],
    queryFn: () => loadTextGenerateRouteOptions({ aiConfig, runtimeDefaults }),
    staleTime: 15_000,
    retry: false,
  });

  const healthQuery = useQuery({
    queryKey: ['polyinfo', 'runtime-health-summary'],
    queryFn: () => fetchRuntimeHealthSummary(),
    refetchInterval: 15_000,
    retry: false,
  });

  const selectedBinding = getTextGenerateBinding(aiConfig);
  const routeStatus = resolveTextGenerateRouteStatus({
    aiConfig,
    runtimeDefaults,
    routeOptions: routeOptionsQuery.data,
    daemonStatus: daemonQuery.data ?? null,
    authStatus: auth.status,
  });
  const effectiveBinding = routeStatus.binding;
  const bindingSummary = routeStatus.ready
    ? summarizeRuntimeBinding(effectiveBinding, daemonQuery.data ?? null)
    : {
      title: routeStatus.title,
      detail: routeStatus.detail,
      ready: routeStatus.ready,
    };

  const selectedCloudConnector = useMemo(() => {
    const connectorId = effectiveBinding?.source === 'cloud' ? effectiveBinding.connectorId : '';
    return routeOptionsQuery.data?.connectors.find((item) => item.id === connectorId) ?? null;
  }, [effectiveBinding, routeOptionsQuery.data?.connectors]);

  const localModelOptions = routeOptionsQuery.data?.local.models ?? [];
  const cloudConnectors = routeOptionsQuery.data?.connectors ?? [];
  const providerHealth = healthQuery.data?.providers ?? [];

  const applyBinding = (binding: RuntimeRouteBinding | null) => {
    setAIConfig(updateTextGenerateBinding(aiConfig, binding));
  };

  const handleSetRoute = (source: 'local' | 'cloud') => {
    if (!routeOptionsQuery.data) {
      return;
    }
    if (source === 'local') {
      const fallback = routeOptionsQuery.data.local.models[0] || null;
      applyBinding(fallback ? {
        source: 'local',
        connectorId: '',
        model: fallback.model,
        modelId: fallback.modelId,
        localModelId: fallback.localModelId,
        provider: fallback.provider,
        engine: fallback.engine,
        endpoint: fallback.endpoint,
        goRuntimeLocalModelId: fallback.goRuntimeLocalModelId,
        goRuntimeStatus: fallback.goRuntimeStatus,
      } : null);
      return;
    }
    const connector = routeOptionsQuery.data.connectors[0] || null;
    applyBinding(connector ? {
      source: 'cloud',
      connectorId: connector.id,
      model: connector.models[0] || 'auto',
      provider: connector.provider,
    } : null);
  };

  const handleSelectLocalModel = (localModelId: string) => {
    const option = localModelOptions.find((item) => item.localModelId === localModelId) ?? null;
    if (!option) {
      return;
    }
    applyBinding({
      source: 'local',
      connectorId: '',
      model: option.model,
      modelId: option.modelId,
      localModelId: option.localModelId,
      provider: option.provider,
      engine: option.engine,
      endpoint: option.endpoint,
      goRuntimeLocalModelId: option.goRuntimeLocalModelId,
      goRuntimeStatus: option.goRuntimeStatus,
    });
  };

  const handleSelectCloudConnector = (connectorId: string) => {
    const connector = cloudConnectors.find((item) => item.id === connectorId) ?? null;
    if (!connector) {
      applyBinding(null);
      return;
    }
    applyBinding({
      source: 'cloud',
      connectorId: connector.id,
      model: connector.models[0] || 'auto',
      provider: connector.provider,
    });
  };

  const handleSelectCloudModel = (model: string) => {
    if (!selectedCloudConnector) {
      return;
    }
    applyBinding({
      source: 'cloud',
      connectorId: selectedCloudConnector.id,
      model,
      provider: selectedCloudConnector.provider,
    });
  };

  const runDaemonAction = async (action: 'start' | 'restart' | 'stop') => {
    setDaemonActionBusy(action);
    setDaemonActionError('');
    try {
      if (action === 'start') {
        await startDaemon();
      } else if (action === 'restart') {
        await restartDaemon();
      } else {
        await stopDaemon();
      }
      await Promise.all([daemonQuery.refetch(), healthQuery.refetch(), routeOptionsQuery.refetch()]);
    } catch (error) {
      setDaemonActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setDaemonActionBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Section eyebrow="Runtime" title="聊天运行设置">
        <div className="flex flex-wrap items-center gap-3">
          <RuntimeBadge
            label={bindingSummary.title}
            tone={bindingSummary.ready ? 'good' : 'warn'}
          />
          <RuntimeBadge
            label={routeStatus.source === 'selected'
              ? '当前是手动选择'
              : routeStatus.source === 'runtime-default'
                ? '当前跟随 runtime 默认'
                : routeStatus.source === 'fallback'
                  ? '当前使用可用回退'
                  : '当前未选路由'}
            tone={routeStatus.source === 'selected' ? 'neutral' : routeStatus.ready ? 'good' : 'warn'}
          />
          {daemonQuery.data ? (
            <RuntimeBadge
              label={daemonQuery.data.running ? 'runtime 已连接' : 'runtime 未运行'}
              tone={daemonQuery.data.running ? 'good' : 'bad'}
            />
          ) : null}
          <RuntimeBadge
            label={auth.status === 'authenticated' ? '当前已登录' : '当前是游客模式'}
            tone={auth.status === 'authenticated' ? 'neutral' : 'warn'}
          />
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-300">{bindingSummary.detail}</p>
        {selectedBinding && !routeStatus.ready ? (
          <p className="mt-2 text-xs leading-6 text-amber-200">
            这是你之前手动保存过的路由，但它现在不能直接用。Polyinfo 不会偷偷帮你切走，请在下面手动改。
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          {([
            { id: 'local', label: '本地模型' },
            { id: 'cloud', label: '云端连接器' },
          ] as const).map((option) => {
            const active = effectiveBinding?.source === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSetRoute(option.id)}
                className={`rounded-md px-4 py-3 text-sm transition-colors ${
                  active
                    ? 'bg-sky-400 text-slate-950'
                    : 'border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section eyebrow="Routing" title="模型与连接器">
          {routeOptionsQuery.isError ? (
            <div className="rounded-md border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
              运行配置读取失败：{routeOptionsQuery.error instanceof Error ? routeOptionsQuery.error.message : 'unknown error'}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">本地模型</p>
              <select
                value={effectiveBinding?.source === 'local' ? effectiveBinding.localModelId || effectiveBinding.modelId || effectiveBinding.model : ''}
                onChange={(event) => handleSelectLocalModel(event.target.value)}
                className="mt-4 w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">请选择</option>
                {localModelOptions.map((option) => (
                  <option key={option.localModelId} value={option.localModelId}>
                    {option.label} {option.status ? `(${option.status})` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                这里显示 runtime 里当前可用的本地文本模型。只有你手动选了，才会写进聊天配置。
              </p>
            </div>

            <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">云端连接器</p>
              <select
                value={effectiveBinding?.source === 'cloud' ? effectiveBinding.connectorId : ''}
                onChange={(event) => handleSelectCloudConnector(event.target.value)}
                className="mt-4 w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              >
                <option value="">请选择</option>
                {cloudConnectors.map((connector) => (
                  <option key={connector.id} value={connector.id}>
                    {connector.label} {connector.provider ? `(${connector.provider})` : ''}
                  </option>
                ))}
              </select>
              <select
                value={effectiveBinding?.source === 'cloud' ? effectiveBinding.model : ''}
                onChange={(event) => handleSelectCloudModel(event.target.value)}
                disabled={!selectedCloudConnector}
                className="mt-3 w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none disabled:opacity-50"
              >
                <option value="">请选择模型</option>
                {(selectedCloudConnector?.models ?? []).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                云端调用需要有效登录态；Polyinfo 会像 Desktop 一样复用登录态，如果当前是游客模式会直接提示你先登录。
              </p>
            </div>
          </div>
        </Section>

        <Section eyebrow="Daemon" title="runtime 连接">
          <div className="space-y-3">
            <Field label="运行状态" value={daemonQuery.data?.running ? '运行中' : '未运行'} />
            <Field label="gRPC 地址" value={daemonQuery.data?.grpcAddr || '空'} />
            <Field label="版本" value={daemonQuery.data?.version || '空'} />
            <Field label="最近错误" value={daemonQuery.data?.lastError || daemonActionError || '空'} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={daemonActionBusy !== null}
              onClick={() => void runDaemonAction('start')}
              className="rounded-md bg-emerald-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {daemonActionBusy === 'start' ? '启动中…' : '启动'}
            </button>
            <button
              type="button"
              disabled={daemonActionBusy !== null}
              onClick={() => void runDaemonAction('restart')}
              className="rounded-md bg-white/8 px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
            >
              {daemonActionBusy === 'restart' ? '重启中…' : '重启'}
            </button>
            <button
              type="button"
              disabled={daemonActionBusy !== null}
              onClick={() => void runDaemonAction('stop')}
              className="rounded-md bg-white/8 px-4 py-3 text-sm text-slate-200 disabled:opacity-50"
            >
              {daemonActionBusy === 'stop' ? '停止中…' : '停止'}
            </button>
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section eyebrow="Health" title="runtime 当前健康状态">
          {healthQuery.isError ? (
            <div className="rounded-md border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
              健康状态读取失败：{healthQuery.error instanceof Error ? healthQuery.error.message : 'unknown error'}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="整体状态" value={healthQuery.data?.runtimeHealth?.status || '空'} />
              <Field label="队列深度" value={String(healthQuery.data?.runtimeHealth?.queueDepth ?? 0)} />
              <Field label="活跃推理" value={String(healthQuery.data?.runtimeHealth?.activeInferenceJobs ?? 0)} />
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {providerHealth.length === 0 ? (
              <RuntimeBadge label="还没有 provider 健康数据" tone="neutral" />
            ) : providerHealth.map((provider) => (
              <RuntimeBadge
                key={provider.providerName}
                label={`${provider.providerName}: ${provider.state}`}
                tone={provider.state.toLowerCase() === 'healthy' ? 'good' : provider.state.toLowerCase() === 'degraded' ? 'warn' : 'bad'}
              />
            ))}
          </div>
        </Section>

        <Section eyebrow="Defaults" title="当前默认值">
          <div className="space-y-3">
            <Field label="Realm" value={runtimeDefaults?.realm.realmBaseUrl || '空'} />
            <Field label="默认本地模型" value={runtimeDefaults?.runtime.localProviderModel || '空'} />
            <Field label="默认连接器" value={runtimeDefaults?.runtime.connectorId || '空'} />
            <Field label="默认 provider" value={runtimeDefaults?.runtime.provider || '空'} />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-400">
            这些是启动时 runtime 给出来的默认值。它们只当参考，不会自动覆盖你手动选过的聊天路由。
          </p>
          <Link to="/settings" className="mt-4 inline-flex rounded-md border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
            去 Settings 管理账号
          </Link>
        </Section>
      </div>
    </div>
  );
}
