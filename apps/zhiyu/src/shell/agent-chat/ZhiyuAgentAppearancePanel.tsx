import { useCallback, useEffect, useMemo, useState } from 'react';
import { Upload, X } from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { BehaviorControlRow } from './ZhiyuAgentChatPieces';
import { avatarStatusMessage } from './ZhiyuAgentChatLabels';
import {
  clearZhiyuAgentCenterAvatarAsset,
  clearZhiyuAgentCenterBackground,
  getZhiyuAgentCenterLocalConfig,
  hasZhiyuAgentCenterLocalConfigBridge,
  importZhiyuAgentCenterAvatarAsset,
  importZhiyuAgentCenterBackground,
  importZhiyuAgentCenterLive2dAdapterManifest,
  type ZhiyuAgentCenterAvatarAssetKind,
  type ZhiyuAgentCenterLocalConfig,
  type ZhiyuAgentCenterLocalConfigScope,
} from './zhiyu-agent-center-local-config';

type ZhiyuAgentCenterAppearanceConfigState = {
  readonly scope: ZhiyuAgentCenterLocalConfigScope | null;
  readonly config: ZhiyuAgentCenterLocalConfig | null;
  readonly ready: boolean;
  readonly loading: boolean;
  readonly pendingAction: string | null;
  readonly error: string | null;
  readonly blockedReason: string | null;
  readonly importAvatar: (kind: ZhiyuAgentCenterAvatarAssetKind) => Promise<void>;
  readonly importLive2dAdapter: () => Promise<void>;
  readonly clearAvatar: () => Promise<void>;
  readonly importBackground: () => Promise<void>;
  readonly clearBackground: () => Promise<void>;
};

function useZhiyuAgentCenterAppearanceConfig(evidence: ZhiyuEvidence): ZhiyuAgentCenterAppearanceConfigState {
  const scope = useMemo(() => zhiyuAgentCenterLocalConfigScope(evidence), [
    evidence.auth.accountId,
    evidence.localAgent.ownerUserId,
    evidence.localAgent.runtimeSourceRef,
    evidence.localAgent.localAgentRef,
  ]);
  const [config, setConfig] = useState<ZhiyuAgentCenterLocalConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bridgeAvailable = hasZhiyuAgentCenterLocalConfigBridge();
  const blockedReason = !scope
    ? 'zhiyu-agent-center-local-config-scope-required'
    : !bridgeAvailable
      ? 'zhiyu-agent-center-local-config-bridge-unavailable'
      : null;
  const ready = Boolean(scope && bridgeAvailable && !loading && !error);

  const refresh = useCallback(async () => {
    if (!scope || !bridgeAvailable) {
      setConfig(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setConfig(await getZhiyuAgentCenterLocalConfig(scope));
    } catch (refreshError) {
      setConfig(null);
      setError(errorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }, [bridgeAvailable, scope]);

  useEffect(() => {
    let active = true;
    if (!scope || !bridgeAvailable) {
      setConfig(null);
      setError(null);
      return undefined;
    }
    setLoading(true);
    setError(null);
    void getZhiyuAgentCenterLocalConfig(scope)
      .then((nextConfig) => {
        if (active) {
          setConfig(nextConfig);
        }
      })
      .catch((loadError) => {
        if (active) {
          setConfig(null);
          setError(errorMessage(loadError));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [bridgeAvailable, scope]);

  const runMutation = useCallback(async (
    action: string,
    operation: () => Promise<boolean | void | ZhiyuAgentCenterLocalConfig>,
  ) => {
    if (!scope || !bridgeAvailable) {
      setError(blockedReason ?? 'zhiyu-agent-center-local-config-unavailable');
      return;
    }
    setPendingAction(action);
    setError(null);
    try {
      const result = await operation();
      if (result && typeof result === 'object' && 'config_kind' in result) {
        setConfig(result as ZhiyuAgentCenterLocalConfig);
      } else if (result !== false) {
        await refresh();
      }
    } catch (mutationError) {
      setError(errorMessage(mutationError));
    } finally {
      setPendingAction(null);
    }
  }, [blockedReason, bridgeAvailable, refresh, scope]);

  return {
    scope,
    config,
    ready,
    loading,
    pendingAction,
    error,
    blockedReason,
    importAvatar: (kind) => runMutation(`avatar:${kind}`, () => importZhiyuAgentCenterAvatarAsset({ scope: scope as ZhiyuAgentCenterLocalConfigScope, kind })),
    importLive2dAdapter: () => runMutation('avatar:live2d-adapter', () => {
      const localAssetId = config?.modules.avatar_asset.local_avatar_asset_ref;
      if (!localAssetId || !scope) {
        throw new Error('Select a Live2D Avatar asset before importing an adapter manifest.');
      }
      return importZhiyuAgentCenterLive2dAdapterManifest({ scope, localAssetId });
    }),
    clearAvatar: () => runMutation('avatar:clear', () => {
      if (!config) {
        throw new Error('Avatar config is not loaded.');
      }
      return clearZhiyuAgentCenterAvatarAsset(config);
    }),
    importBackground: () => runMutation('background:import', () => importZhiyuAgentCenterBackground(scope as ZhiyuAgentCenterLocalConfigScope)),
    clearBackground: () => runMutation('background:clear', () => {
      const backgroundAssetId = config?.modules.appearance.background_asset_id;
      if (!backgroundAssetId || !scope) {
        throw new Error('Select a background before clearing it.');
      }
      return clearZhiyuAgentCenterBackground(scope, backgroundAssetId);
    }),
  };
}

function zhiyuAgentCenterLocalConfigScope(evidence: ZhiyuEvidence): ZhiyuAgentCenterLocalConfigScope | null {
  if (
    !evidence.auth.accountId
    || !evidence.localAgent.ownerUserId
    || !evidence.localAgent.runtimeSourceRef
    || !evidence.localAgent.localAgentRef
  ) {
    return null;
  }
  return {
    accountId: evidence.auth.accountId,
    ownerUserId: evidence.localAgent.ownerUserId,
    runtimeSourceRef: evidence.localAgent.runtimeSourceRef,
    localAgentRef: evidence.localAgent.localAgentRef,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AgentCenterAppearancePanel({
  evidence,
  avatarLaunchAction,
  onAvatarLaunch,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly onAvatarLaunch?: () => void;
}) {
  const localConfig = useZhiyuAgentCenterAppearanceConfig(evidence);
  const avatar = evidence.avatar;
  const localAvatarAsset = localConfig.config?.modules.avatar_asset ?? null;
  const localAppearance = localConfig.config?.modules.appearance ?? null;
  const selectedAvatarAssetRef = localAvatarAsset?.local_avatar_asset_ref ?? null;
  const backendKind = localAvatarAsset?.backend_kind ?? avatar.backendKind ?? 'live2d';
  const avatarProfileProjected = avatar.ready && avatar.visualReadiness === 'projected';
  const assetConfigured = Boolean(selectedAvatarAssetRef);
  const avatarAssetRef = selectedAvatarAssetRef;
  const avatarStatusLabel = assetConfigured ? '已就绪' : avatarProfileProjected ? '待导入' : '需要设置';
  const adapterLinked = localAvatarAsset?.live2d_adapter_manifest_source !== undefined
    && localAvatarAsset.live2d_adapter_manifest_source !== 'none';
  const adapterState = backendKind === 'live2d' && adapterLinked ? 'ready' : backendKind === 'live2d' && assetConfigured ? 'missing' : 'blocked';
  const localConfigBlockReason = localConfig.blockedReason ?? localConfig.error ?? 'zhiyu-agent-center-local-config-unavailable';
  const avatarImportAvailable = localConfig.ready && !localConfig.pendingAction;
  const live2dAdapterAvailable = Boolean(
    localConfig.ready
    && !localConfig.pendingAction
    && selectedAvatarAssetRef
    && backendKind === 'live2d',
  );
  const clearAvatarAvailable = Boolean(localConfig.ready && !localConfig.pendingAction && selectedAvatarAssetRef);
  const backgroundImportAvailable = localConfig.ready && !localConfig.pendingAction;
  const backgroundAssetRef = localAppearance?.background_asset_id ?? null;
  const clearBackgroundAvailable = Boolean(localConfig.ready && !localConfig.pendingAction && backgroundAssetRef);
  const live2dWorkbenchState = backendKind === 'live2d' && assetConfigured
    ? 'effect_projection_pending'
    : 'asset_required';
  const live2dReviewItems = [
    {
      itemId: 'preview_artifact',
      title: '预览产物',
      detail: assetConfigured ? '等待 Electron 本地渲染桥证据。' : '需要本地资源和能力证据。',
      state: assetConfigured ? 'pending' : 'blocked',
    },
    {
      itemId: 'model_framing',
      title: '模型构图',
      detail: assetConfigured ? '等待 Live2D viewport framing 证据。' : '需要本地资源和能力证据。',
      state: assetConfigured ? 'pending' : 'blocked',
    },
    {
      itemId: 'render_policy',
      title: '渲染策略',
      detail: assetConfigured ? '等待 Runtime/Avatar 渲染策略证据。' : '需要本地资源和能力证据。',
      state: assetConfigured ? 'pending' : 'blocked',
    },
    {
      itemId: 'expression_inventory',
      title: '表情清单',
      detail: avatar.backendKind ? '等待后端能力档案证据。' : '需要后端能力档案证据。',
      state: avatar.backendKind ? 'pending' : 'blocked',
    },
    {
      itemId: 'adapter_manifest',
      title: 'Adapter manifest',
      detail: adapterLinked ? '已链接 Live2D adapter sidecar。' : backendKind === 'live2d' ? '等待 Live2D adapter sidecar 证据。' : '仅 Live2D 资源需要此证据。',
      state: backendKind === 'live2d' ? adapterState : 'blocked',
    },
  ] as const;
  const avatarPolicyRows = [
    {
      dataKey: 'avatar_instance_policy',
      label: '实例策略',
      value: '复用当前实例',
      detail: '对应 Desktop reuse_active_instance，未接入本地启动桥前不可切换。',
      policyValue: 'reuse_active_instance',
    },
    {
      dataKey: 'generated_motion_provider_policy',
      label: '生成动效',
      value: '需要档案支持',
      detail: '对应 Desktop require_profile_support，缺少 profile 证据时保持关闭。',
      policyValue: 'require_profile_support',
    },
    {
      dataKey: 'avatar_launch_mode',
      label: '启动方式',
      value: '手动',
      detail: 'start_with_chat 需要 Zhiyu avatar spec admission 后才可启用。',
      policyValue: 'manual',
    },
    {
      dataKey: 'avatar_debug_profile',
      label: '调试档案',
      value: '标准',
      detail: '严格后端证据和路由矩阵探针等待 Electron bridge。',
      policyValue: 'standard',
    },
  ] as const;
  const avatarDebugShortcuts = [
    { dataKey: 'backend', label: '后端' },
    { dataKey: 'profile', label: '档案' },
    { dataKey: 'routes', label: '路由' },
    { dataKey: 'motion', label: '动效' },
    { dataKey: 'emotion', label: '情绪' },
    { dataKey: 'speech', label: '语音' },
    { dataKey: 'window', label: '窗口' },
  ] as const;
  return (
    <div
      className="zhiyu-home__agent-appearance-tab"
      data-zhiyu-agent-appearance-panel="true"
      data-zhiyu-agent-center-local-config={localConfig.ready ? 'electron' : 'blocked'}
      data-zhiyu-agent-center-local-config-reason={localConfigBlockReason}
      data-zhiyu-avatar-appearance-ready={String(assetConfigured)}
      data-zhiyu-avatar-appearance-reason={avatar.reasonCode}
    >
      <section className="zhiyu-home__agent-section">
        <div className="zhiyu-home__agent-section-head">
          <span>外观</span>
          <div>
            <h2>Avatar 设置</h2>
            <em className={`zhiyu-home__agent-model-status is-${assetConfigured ? 'ready' : 'attention'}`}>
              {avatarStatusLabel}
            </em>
          </div>
        </div>
        <div className="zhiyu-home__avatar-setup-card">
          <div className="zhiyu-home__avatar-asset-summary">
            <div className={`zhiyu-home__avatar-asset-mark is-${backendKind === 'vrm' ? 'vrm' : 'live2d'}`}>
              {backendKind === 'vrm' ? '3D' : '2D'}
            </div>
            <div>
              <div>
                <strong>Avatar 资源</strong>
                <span>{backendKind.toUpperCase()}</span>
              </div>
              <small>{avatarAssetRef ?? '缺失'}</small>
            </div>
            <em className={`zhiyu-home__panel-row-status is-${assetConfigured ? 'ready' : 'attention'}`}>
              {avatarStatusLabel}
            </em>
          </div>
        </div>
      </section>

      <section
        className="zhiyu-home__avatar-config-card"
        data-zhiyu-avatar-import-surface={localConfig.ready ? 'electron-local-config' : 'blocked'}
        data-zhiyu-avatar-import-surface-reason={localConfigBlockReason}
      >
        <div className="zhiyu-home__avatar-config-head">
          <h2>导入来源</h2>
          <span>Avatar 拥有的证据</span>
        </div>
        <div className="zhiyu-home__avatar-import-grid">
          <AvatarImportButton
            kind="live2d"
            title="导入 Live2D 文件夹"
            detail="model3.json + textures"
            state={avatarImportAvailable ? 'available' : 'blocked'}
            reasonCode={avatarImportAvailable ? 'zhiyu-electron-agent-center-local-config-ready' : localConfigBlockReason}
            disabled={!avatarImportAvailable}
            onClick={() => void localConfig.importAvatar('live2d')}
          />
          <AvatarImportButton
            kind="vrm"
            title="导入 VRM 文件"
            detail=".vrm - 单个文件"
            state={avatarImportAvailable ? 'available' : 'blocked'}
            reasonCode={avatarImportAvailable ? 'zhiyu-electron-agent-center-local-config-ready' : localConfigBlockReason}
            disabled={!avatarImportAvailable}
            onClick={() => void localConfig.importAvatar('vrm')}
          />
        </div>
        <div className="zhiyu-home__avatar-secondary-grid">
          <button
            type="button"
            disabled={!live2dAdapterAvailable}
            onClick={() => void localConfig.importLive2dAdapter()}
            data-zhiyu-avatar-import-action="live2d-adapter"
            data-zhiyu-avatar-import-state={live2dAdapterAvailable ? 'available' : 'blocked'}
            data-zhiyu-avatar-import-reason={live2dAdapterAvailable ? 'zhiyu-electron-agent-center-local-config-ready' : backendKind === 'live2d' && assetConfigured ? localConfigBlockReason : 'zhiyu-live2d-asset-required'}
          >
            导入 Live2D adapter sidecar
          </button>
          <button
            type="button"
            disabled={!clearAvatarAvailable}
            onClick={() => void localConfig.clearAvatar()}
            data-zhiyu-avatar-import-action="clear"
            data-zhiyu-avatar-import-state={clearAvatarAvailable ? 'available' : 'blocked'}
            data-zhiyu-avatar-import-reason={clearAvatarAvailable ? 'zhiyu-electron-agent-center-local-config-ready' : 'zhiyu-avatar-selection-missing'}
          >
            移除 Avatar 资源
          </button>
        </div>
      </section>

      <section className="zhiyu-home__avatar-config-card" data-zhiyu-avatar-evidence="true">
        <div className="zhiyu-home__avatar-config-head">
          <h2>证据</h2>
        </div>
        <AvatarEvidenceRow label="当前资源" value={avatarAssetRef ?? '缺失'} state={assetConfigured ? 'ready' : 'missing'} />
        <AvatarEvidenceRow label="验证状态" value={assetConfigured ? 'projected' : 'selection missing'} state={assetConfigured ? 'ready' : 'missing'} />
        <AvatarEvidenceRow label="能力档案" value={avatar.backendKind ? '已投影' : '等待证据'} state={avatar.backendKind ? 'ready' : 'pending'} />
        <AvatarEvidenceRow label="Live2D adapter manifest" value={adapterState === 'ready' ? '已链接' : backendKind === 'live2d' ? '未选择' : '不适用'} state={adapterState} />
      </section>

      <section
        className="zhiyu-home__avatar-config-card zhiyu-home__live2d-workbench-card"
        data-zhiyu-live2d-workbench="true"
        data-zhiyu-live2d-workbench-state={live2dWorkbenchState}
        data-zhiyu-live2d-workbench-shortcuts="backend,profile,routes,motion,emotion,speech,window"
      >
        <div className="zhiyu-home__avatar-config-head">
          <div>
            <h2>Live2D 工作台</h2>
            <p>资源 {avatarAssetRef ?? '缺失'} · 未选择</p>
          </div>
          <span>{assetConfigured && backendKind === 'live2d' ? '等待证据' : '需要资源'}</span>
        </div>
        <div className="zhiyu-home__live2d-review-grid">
          {live2dReviewItems.map((item) => (
            <Live2dReviewItem
              key={item.itemId}
              itemId={item.itemId}
              title={item.title}
              detail={item.detail}
              state={item.state}
            />
          ))}
        </div>
      </section>

      <section
        className={`zhiyu-home__avatar-launch-card is-${avatarLaunchAction.state === 'ready' ? 'ready' : 'attention'}`}
        data-zhiyu-avatar-launch-card={avatarLaunchAction.state}
        data-zhiyu-avatar-launch-reason={avatarLaunchAction.reasonCode}
      >
        <span>{avatarLaunchAction.state === 'ready' ? 'OK' : '!'}</span>
        <div>
          <strong>{avatarLaunchAction.state === 'ready' ? '可以启动' : 'Avatar 启动不可用'}</strong>
          <p>{avatarStatusMessage(avatarLaunchAction)}</p>
        </div>
        {avatarLaunchAction.state === 'ready' ? (
          <button type="button" onClick={onAvatarLaunch} disabled={!onAvatarLaunch}>
            启动
          </button>
        ) : null}
      </section>

      <section
        className="zhiyu-home__avatar-config-card zhiyu-home__avatar-background-card"
        data-zhiyu-agent-background-card={localConfig.ready ? 'electron-local-config' : 'blocked'}
        data-zhiyu-agent-background-reason={localConfigBlockReason}
      >
        <div className="zhiyu-home__avatar-config-head">
          <h2>背景</h2>
          <span>{backgroundAssetRef ? '已选择' : localConfig.ready ? '可导入' : '受阻'}</span>
        </div>
        <BehaviorControlRow
          label="对话背景"
          detail={backgroundAssetRef ?? '导入本地背景图片后写入 Zhiyu Agent Center local config。'}
          status={backgroundAssetRef ? '已选择' : '未提供'}
          dataKey="background"
        />
        <div className="zhiyu-home__background-action-grid">
          <button
            type="button"
            disabled={!backgroundImportAvailable}
            onClick={() => void localConfig.importBackground()}
            data-zhiyu-background-import-action="import"
            data-zhiyu-background-import-state={backgroundImportAvailable ? 'available' : 'blocked'}
            data-zhiyu-background-import-reason={backgroundImportAvailable ? 'zhiyu-electron-agent-center-local-config-ready' : localConfigBlockReason}
          >
            <Upload size={16} aria-hidden="true" />
            <span>导入背景图片</span>
          </button>
          <button
            type="button"
            disabled={!clearBackgroundAvailable}
            onClick={() => void localConfig.clearBackground()}
            data-zhiyu-background-import-action="clear"
            data-zhiyu-background-import-state={clearBackgroundAvailable ? 'available' : 'blocked'}
            data-zhiyu-background-import-reason={clearBackgroundAvailable ? 'zhiyu-electron-agent-center-local-config-ready' : 'zhiyu-avatar-background-selection-missing'}
          >
            <X size={16} aria-hidden="true" />
            <span>移除背景</span>
          </button>
        </div>
      </section>

      <section className="zhiyu-home__avatar-config-card" data-zhiyu-agent-motion-card="read-only">
        <div className="zhiyu-home__avatar-config-head">
          <h2>动效</h2>
          <span>只读</span>
        </div>
        <BehaviorControlRow
          label="减少动效"
          detail="当前跟随系统与 Kit shell，不在 Zhiyu 内维护独立动效偏好。"
          status="关闭"
          dataKey="reduce-motion"
        />
      </section>

      <section
        className="zhiyu-home__avatar-config-card zhiyu-home__avatar-debug-card"
        data-zhiyu-avatar-advanced-diagnostics="deferred"
        data-zhiyu-avatar-advanced-diagnostics-reason={localConfigBlockReason}
      >
        <div className="zhiyu-home__avatar-config-head">
          <div>
            <h2>高级诊断</h2>
            <p>保留 Desktop 外观配置的策略与探针入口；Avatar/背景资源由 Zhiyu Electron local config bridge 写入。</p>
          </div>
          <span>只读</span>
        </div>
        <div className="zhiyu-home__avatar-policy-grid">
          {avatarPolicyRows.map((row) => (
            <AvatarPolicyRow
              key={row.dataKey}
              dataKey={row.dataKey}
              label={row.label}
              value={row.value}
              detail={row.detail}
              policyValue={row.policyValue}
            />
          ))}
        </div>
        <div
          className="zhiyu-home__avatar-debug-shortcuts"
          data-zhiyu-avatar-debug-shortcuts="backend,profile,routes,motion,emotion,speech,window"
        >
          {avatarDebugShortcuts.map((shortcut) => (
            <button
              key={shortcut.dataKey}
              type="button"
              disabled
              data-zhiyu-avatar-debug-shortcut={shortcut.dataKey}
              data-zhiyu-avatar-debug-state="deferred"
              data-zhiyu-avatar-debug-reason={localConfigBlockReason}
            >
              {shortcut.label}
            </button>
          ))}
        </div>
      </section>
      {localConfig.error ? (
        <section className="zhiyu-home__avatar-config-card" data-zhiyu-agent-center-local-config-error="true">
          <div className="zhiyu-home__avatar-config-head">
            <h2>本地配置错误</h2>
            <span>受阻</span>
          </div>
          <p>{localConfig.error}</p>
        </section>
      ) : null}
    </div>
  );
}

function AvatarImportButton({
  kind,
  title,
  detail,
  state,
  reasonCode,
  disabled,
  onClick,
}: {
  readonly kind: 'live2d' | 'vrm';
  readonly title: string;
  readonly detail: string;
  readonly state: 'available' | 'blocked';
  readonly reasonCode: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`zhiyu-home__avatar-import-button is-${kind}`}
      data-zhiyu-avatar-import-action={kind}
      data-zhiyu-avatar-import-state={state}
      data-zhiyu-avatar-import-reason={reasonCode}
      title={state === 'available' ? title : reasonCode}
    >
      <Upload size={18} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  );
}

function AvatarEvidenceRow({
  label,
  value,
  state,
}: {
  readonly label: string;
  readonly value: string;
  readonly state: 'ready' | 'pending' | 'missing' | 'blocked';
}) {
  return (
    <div
      className={`zhiyu-home__avatar-evidence-row is-${state}`}
      data-zhiyu-avatar-evidence-row={label}
      data-zhiyu-avatar-evidence-state={state}
    >
      <span>{state === 'ready' ? '✓' : state === 'pending' ? '…' : state === 'blocked' ? '!' : '-'}</span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
    </div>
  );
}

function Live2dReviewItem({
  itemId,
  title,
  detail,
  state,
}: {
  readonly itemId: 'preview_artifact' | 'model_framing' | 'render_policy' | 'expression_inventory' | 'adapter_manifest';
  readonly title: string;
  readonly detail: string;
  readonly state: 'ready' | 'pending' | 'missing' | 'blocked';
}) {
  return (
    <div
      className={`zhiyu-home__live2d-review-item is-${state}`}
      data-zhiyu-live2d-review-item={itemId}
      data-zhiyu-live2d-review-state={state}
    >
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <span>{live2dReviewStateLabel(state)}</span>
    </div>
  );
}

function live2dReviewStateLabel(state: 'ready' | 'pending' | 'missing' | 'blocked') {
  if (state === 'ready') {
    return '已就绪';
  }
  if (state === 'pending') {
    return '等待证据';
  }
  if (state === 'missing') {
    return '未选择';
  }
  return '已阻止';
}

function AvatarPolicyRow({
  dataKey,
  label,
  value,
  detail,
  policyValue,
}: {
  readonly dataKey: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly policyValue: string;
}) {
  return (
    <div
      className="zhiyu-home__avatar-policy-row"
      data-zhiyu-avatar-policy-row={dataKey}
      data-zhiyu-avatar-policy-value={policyValue}
      data-zhiyu-avatar-policy-state="read-only"
    >
      <div>
        <strong>{label}</strong>
        <small>{detail}</small>
      </div>
      <span>{value}</span>
    </div>
  );
}
