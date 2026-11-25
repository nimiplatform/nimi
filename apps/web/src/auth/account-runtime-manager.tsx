import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  AppWindow,
  ArrowRight,
  KeyRound,
  Laptop,
  LoaderCircle,
  Lock,
  Power,
  Radio,
  RefreshCw,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Unplug,
} from 'lucide-react';
import {
  completeRuntimeClientLogin,
  matchesRuntimeClientCallback,
  prepareRuntimeClientLogin,
  type RuntimeClientLoginOptions,
  type RuntimeClientLoginTransaction,
  type RuntimeClientSession,
} from '@nimiplatform/sdk/realm/runtime-client';
import type { RemoteRuntimeConnection, RemoteRuntimeConnectOptions } from '@nimiplatform/sdk/runtime/remote';
import {
  RemoteSourceAccessState,
  RuntimeServiceMode,
  type GetRemoteAccessStateResponse,
} from '@nimiplatform/sdk/runtime/wire-types';
import type { NimiAIConfigOverwriteInput, NimiAIConfigSnapshot } from '@nimiplatform/sdk/ai';
import { extractNimiErrorFields } from '@nimiplatform/sdk/types';
import { ModelConfigAIConfigSurface, type ModelConfigCopy } from '@nimiplatform/kit/features/model-config';
import { createWebBrowserRealm, webRealmOrigin } from './browser-realm.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { AccountFeedback } from './account-center-layout.js';
import type { RuntimeLivePhase, RuntimeLiveSummary } from './account-runtime.js';

type ManagerConnection = Extract<RemoteRuntimeConnection, { role: 'official_manager' }>;
type Login = {
  accountId: string;
  options: Omit<RuntimeClientLoginOptions, 'currentUserContext' | 'fetch'>;
  transaction: RuntimeClientLoginTransaction;
};

const storageKey = 'nimi:runtime-manager:login';

const remoteModelConfigCopy: ModelConfigCopy = {
  localChoiceDescription: 'Use the model selected on the primary PC.',
  localSelectedLabel: 'Selected on the primary PC',
  localMissingLabel: 'No on-device model is selected for this capability on the primary PC.',
  cloudNoticeDescription:
    'The primary Runtime sends the request to the selected cloud provider, which may charge for it.',
};

const remoteModelConfigCopyZh: ModelConfigCopy = {
  description: '为此应用选择运行方式和模型。',
  backLabel: '返回能力列表',
  detailTitle: (capability) => `${capability}设置`,
  capabilityLabel: (contract, fallback) =>
    (
      {
        'text.generate': '文本生成',
        'text.annotate': '文本标注',
        'image.generate': '图像生成',
        'speech.synthesize': '语音合成',
        'speech.transcribe': '语音转写',
        'music.generate': '音乐生成',
      } as Record<string, string>
    )[contract] ?? fallback,
  activeModelLabel: '当前模型',
  activeModelHint: '更换模型',
  activeModelConfiguredLabel: '已配置',
  activeModelSetupPendingLabel: '待配置',
  modelPickerTitle: '选择模型',
  modelPickerSearchPlaceholder: '搜索模型',
  modelPickerLoadingLabel: '正在读取可用模型…',
  modelPickerEmptyLabel: '此能力暂无可用模型。',
  configuredSummary: '模型已配置',
  emptySummary: '尚未选择模型',
  routeLabel: '运行方式',
  localLabel: '主机本地',
  cloudLabel: '云端',
  localChoiceDescription: '使用主 PC 已选定的本地模型。',
  localSelectedLabel: '主 PC 当前选择',
  localMissingLabel: '主 PC 尚未为此能力选定本地模型。',
  localBrokenLabel: '主 PC 选定的本地模型不可用。',
  localUnavailableLabel: '无法读取主 PC 的本地模型选择。',
  cloudConnectorPickerLabel: '云连接',
  cloudConnectorPickerPlaceholder: '选择已配置的云连接',
  cloudNoConnectorsLabel: '主 PC 暂无可用的云连接。',
  cloudLoadFailed: '无法读取主 PC 的云连接或模型选项。',
  cloudNoticeLabel: '云端执行',
  cloudNoticeDescription: '主 Runtime 会向所选云服务商发送请求，服务商可能收费。',
  saveLocalLabel: '保存设置',
  saveCloudLabel: '保存设置',
  savingLabel: '正在保存…',
  savedLabel: '已保存',
  clearLabel: '清除配置',
  clearingLabel: '正在清除…',
  advancedLabel: '高级设置',
  defaultsLabel: '默认参数',
  defaultsPlaceholder: '留空则不为该参数指定默认值。',
  defaultsListPlaceholder: '每行一个值',
  conflictLabel: '配置已在其他页面修改',
  conflictDescription: '已保留当前草稿。请核对最新配置后再保存。',
  conflictCurrentLabel: (revision, summary) => `当前版本 ${revision}：${summary}`,
  retryLabel: '重试',
  saveFailed: '无法保存模型设置。',
  notConfiguredLabel: '未配置',
  configuredLabel: '已配置',
  selectionRequiredLabel: '待选择',
  blockedLabel: '暂不可用',
  unavailableLabel: '不可用',
  cancelLabel: '取消',
  confirmSelectionLabel: '使用所选模型',
};

type TransportState = Parameters<NonNullable<RemoteRuntimeConnectOptions['onState']>>[0];
type ManagerState = TransportState | 'running' | 'maintenance' | 'stop' | '';

export function deriveLivePhase(connected: boolean, state: ManagerState): RuntimeLivePhase {
  if (connected) {
    if (state === 'maintenance' || state === 'running') return state;
    return 'connected';
  }
  if (state === 'gathering' || state === 'waiting-for-pc' || state === 'connecting') {
    return 'connecting';
  }
  if (state === 'stop') {
    return 'stopped';
  }
  return 'idle';
}

export type AccountRuntimeManagerViewProps = {
  locale?: 'zh' | 'en';
  ready: boolean;
  connected: boolean;
  busy: boolean;
  state: ManagerState;
  error: string | null;
  access: GetRemoteAccessStateResponse | null;
  currentClientId?: string | null;
  selectedAppId: string;
  pendingPauseClientId: string | null;
  confirmingStop: boolean;
  onConnect: () => void;
  onRefreshState: () => void;
  onDisconnect: () => void;
  onRequestToggleSource: (clientId: string, currentlyPaused: boolean, isCurrentManager: boolean) => void;
  onConfirmPauseSelf: (clientId: string) => void;
  onCancelPauseSelf: () => void;
  onSelectApp: (appId: string) => void;
  onRequestStop: () => void;
  onConfirmStop: () => void;
  onCancelStop: () => void;
  modelConfigSlot?: ReactNode;
};

// @nimi-authority: rule.nimi.platform.product-lifecycle.remote-runtime-management
export function AccountRuntimeManagerView({
  locale = 'zh',
  ready,
  connected,
  busy,
  state,
  error,
  access,
  currentClientId = null,
  selectedAppId,
  pendingPauseClientId,
  confirmingStop,
  onConnect,
  onRefreshState,
  onDisconnect,
  onRequestToggleSource,
  onConfirmPauseSelf,
  onCancelPauseSelf,
  onSelectApp,
  onRequestStop,
  onConfirmStop,
  onCancelStop,
  modelConfigSlot,
}: AccountRuntimeManagerViewProps) {
  const zh = locale === 'zh';
  const say = (cn: string, en: string) => (zh ? cn : en);
  const unavailableId = useId();

  const labels: Partial<Record<ManagerState, string>> = {
    gathering: say('正在准备直连…', 'Preparing a direct connection…'),
    'waiting-for-pc': say(
      '等待 PC 响应；首次接入请在电脑端 Nimi Home 确认此管理来源。',
      'Waiting for your PC. Confirm this management source in Nimi Home on first use.',
    ),
    connecting: say('正在建立加密直连…', 'Establishing direct connection…'),
    connected: say('已直连主设备，服务状态尚未确认。', 'Connected directly. Host service status is unconfirmed.'),
    running: say('已直连主设备，普通服务正在运行。', 'Connected directly; ordinary host services are running.'),
    closed: say('连接已关闭，需要时可重新连接。', 'The connection closed. Connect again when needed.'),
    maintenance: say('主设备当前处于维护模式。', 'Your primary host is in maintenance mode.'),
    stop: say(
      '停止请求已接受。仅凭连接关闭不足以证明主机进程已退出；停止后需在 PC 上重新启动 Nimi。',
      'The stop request was accepted. A closed connection alone does not prove process exit. Restart Nimi from your PC after it stops.',
    ),
  };

  const isConnecting =
    !connected && (state === 'gathering' || state === 'waiting-for-pc' || state === 'connecting');

  if (!connected) {
    return (
      <section
        className="ac-host-connect-card"
        data-manager-mode="standby"
        data-manager-ready={ready ? 'true' : 'false'}
        aria-labelledby="ac-host-remote-title"
      >
        <div className="ac-host-connect-head">
          <span className="ac-host-section-icon" aria-hidden="true">
            <Radio size={18} />
          </span>
          <div className="ac-host-connect-head-copy">
            <h2 id="ac-host-remote-title">{say('网页直连管理', 'Direct browser management')}</h2>
            <p>
              {say(
                '验证当前账号所有权后，直接从浏览器管理主设备的远程接入与单应用 AI 模型路由。',
                'Verify account ownership to inspect host status, control remote app access, and adjust per-app AI routing from this browser.',
              )}
            </p>
          </div>
        </div>

        <AccountFeedback error={error} message={!isConnecting ? labels[state] : null} />

        {isConnecting ? (
          <div className="ac-host-connecting-bar" role="status">
            <LoaderCircle size={16} aria-hidden="true" className="is-spinning" />
            <span>{labels[state]}</span>
          </div>
        ) : null}

        <div className="ac-host-capabilities" aria-label={say('直连后可用能力', 'Capabilities once connected')}>
          <div className="ac-host-capability-tile">
            <span className="ac-host-capability-icon" aria-hidden="true">
              <Activity size={16} />
            </span>
            <strong>{say('实时服务状态', 'Live host status')}</strong>
            <p>{say('查看主设备当前运行模式与活跃直连会话数。', 'Inspect current service mode and active direct peers.')}</p>
          </div>

          <div className="ac-host-capability-tile">
            <span className="ac-host-capability-icon" aria-hidden="true">
              <ShieldCheck size={16} />
            </span>
            <strong>{say('应用接入控制', 'App access control')}</strong>
            <p>{say('随时暂停或恢复已授权网页应用与管理来源的访问。', 'Pause or resume access for admitted apps and managers.')}</p>
          </div>

          <div className="ac-host-capability-tile">
            <span className="ac-host-capability-icon" aria-hidden="true">
              <SlidersHorizontal size={16} />
            </span>
            <strong>{say('单应用 AI 与停机', 'Per-app AI & power')}</strong>
            <p>{say('为已接入应用调整模型路由，或在需要时远程停止服务。', 'Adjust per-app AI model routing or stop the host remotely.')}</p>
          </div>
        </div>

        <div className="ac-host-prereqs">
          <span className="ac-host-prereqs-label">{say('连接前提', 'Before connecting')}</span>
          <ul className="ac-host-prereqs-list">
            <li>
              <Laptop size={15} aria-hidden="true" />
              <span>
                {say(
                  '主电脑上的 Nimi Home 需保持运行并开启远程接入，当前网络必须允许直连。',
                  'Keep Nimi Home running on your PC with remote access enabled on a network that allows direct connections.',
                )}
              </span>
            </li>
            <li>
              <KeyRound size={15} aria-hidden="true" />
              <span>
                {say(
                  '首次使用此管理端时，请在 PC 上的 Nimi Home 确认来源；账号、主设备与来源版本未变时，换浏览器或设备不必重新确认。',
                  'Confirm this management source in PC Nimi Home the first time. Switching browsers or devices needs no re-confirmation if the account, primary host, and source version stay the same.',
                )}
              </span>
            </li>
          </ul>
        </div>

        {ready ? (
          <div className="ac-host-action-bar">
            <div className="ac-host-action-copy">
              <Lock size={15} aria-hidden="true" />
              <span>
                {say(
                  '将通过当前账号验证所有权，与主设备建立端到端直连。',
                  'Verifies account ownership and establishes an end-to-end direct session with your PC.',
                )}
              </span>
            </div>
            <button
              type="button"
              className="ac-button ac-button--pill"
              disabled={busy}
              onClick={onConnect}
            >
              <span>{busy ? say('正在连接…', 'Connecting…') : say('验证并连接', 'Verify and connect')}</span>
              {busy ? (
                <LoaderCircle size={15} aria-hidden="true" className="is-spinning" />
              ) : (
                <ArrowRight size={15} aria-hidden="true" />
              )}
            </button>
          </div>
        ) : (
          <div className="ac-host-action-bar ac-host-action-bar--unavailable">
            <div className="ac-host-unavailable-copy" id={unavailableId}>
              <span className="ac-host-unavailable-icon" aria-hidden="true">
                <Lock size={16} />
              </span>
              <div>
                <strong>{say('当前环境暂不可建立网页直连', 'Direct browser management is unavailable here')}</strong>
                <p>
                  {say(
                    '此部署尚未配置 HTTPS 官方管理来源。主设备绑定信息仍可正常查看；如需调整应用接入或 AI 配置，请直接在 PC 端 Nimi Home 操作。',
                    'This deployment has no configured HTTPS official manager origin. Primary binding details remain available; manage access and models directly in Nimi Home on your PC.',
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="ac-button ac-button--pill ac-button--unavailable"
              disabled
              aria-describedby={unavailableId}
            >
              {say('验证并连接', 'Verify and connect')}
            </button>
          </div>
        )}
      </section>
    );
  }

  const activeConnectionsByClient = new Map<string, number>();
  for (const conn of access?.connections ?? []) {
    activeConnectionsByClient.set(conn.clientId, (activeConnectionsByClient.get(conn.clientId) ?? 0) + 1);
  }

  const apps = new Map<string, { name: string; capabilities: Set<string> }>();
  for (const source of access?.sources ?? []) {
    if (
      source.officialManager
      || (source.state !== RemoteSourceAccessState.ALLOWED
        && source.state !== RemoteSourceAccessState.PAUSED)
    ) {
      continue;
    }
    const app = apps.get(source.appId) ?? { name: source.displayName, capabilities: new Set<string>() };
    for (const capability of source.capabilityContractRefs) app.capabilities.add(capability);
    apps.set(source.appId, app);
  }

  const selected = apps.get(selectedAppId);
  const sources = access?.sources ?? [];

  return (
    <div className="ac-host-console" data-manager-mode="connected">
      <div className="ac-host-session-bar">
        <div className="ac-host-session-meta">
          <strong role="status">{labels[state] ?? labels.connected}</strong>
          <span>
            {say('断开此客户端不会停止主设备运行。', 'Disconnecting this client does not stop the primary host.')}
          </span>
        </div>
        <div className="ac-actions">
          <button
            type="button"
            className="ac-button ac-button--secondary ac-button--small ac-button--pill"
            disabled={busy}
            onClick={onRefreshState}
          >
            <RefreshCw size={14} aria-hidden="true" className={busy ? 'is-spinning' : undefined} />
            <span>{say('刷新状态', 'Refresh state')}</span>
          </button>
          <button
            type="button"
            className="ac-button ac-button--secondary ac-button--small ac-button--pill"
            disabled={busy}
            onClick={onDisconnect}
          >
            <Unplug size={14} aria-hidden="true" />
            <span>{say('断开此客户端', 'Disconnect this client')}</span>
          </button>
        </div>
      </div>

      <AccountFeedback error={error} />

      <section className="ac-host-panel" aria-labelledby="ac-host-sources-title">
        <div className="ac-host-panel-head">
          <span className="ac-host-section-icon" aria-hidden="true">
            <ShieldCheck size={17} />
          </span>
          <div className="ac-host-panel-head-copy">
            <div className="ac-host-panel-title-row">
              <h2 id="ac-host-sources-title">{say('应用与管理端接入', 'Application & manager access')}</h2>
              <span className="ac-launchpad-count">{sources.length}</span>
            </div>
            <p>
              {say(
                '暂停或恢复已授权来源的远程访问；新来源或版本变化仍需在 PC 端 Nimi Home 确认。',
                'Pause or resume approved remote sources. New or changed sources still require confirmation in PC Nimi Home.',
              )}
            </p>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="ac-host-sub-empty">
            <p>{say('尚无远程接入记录。', 'No remote access sources are recorded yet.')}</p>
          </div>
        ) : (
          <ul className="ac-host-source-list">
            {sources.map((source) => {
              const isPaused = source.state === RemoteSourceAccessState.PAUSED;
              const isPending =
                source.state === RemoteSourceAccessState.PENDING
                || source.state === RemoteSourceAccessState.CHANGED;
              const isCurrentManager = Boolean(currentClientId && source.clientId === currentClientId);
              const activeCount = activeConnectionsByClient.get(source.clientId) ?? 0;
              const confirmingSelfPause = pendingPauseClientId === source.clientId;

              const stateBadge =
                source.state === RemoteSourceAccessState.ALLOWED
                  ? { label: say('允许接入', 'Allowed'), tone: 'allowed' }
                  : source.state === RemoteSourceAccessState.PAUSED
                    ? { label: say('已暂停', 'Paused'), tone: 'paused' }
                    : source.state === RemoteSourceAccessState.CHANGED
                      ? { label: say('来源已变更', 'Source changed'), tone: 'pending' }
                      : { label: say('待 PC 确认', 'Pending PC'), tone: 'pending' };

              return (
                <li className="ac-host-source-item" key={source.clientId}>
                  <div className="ac-host-source-row">
                    <div className="ac-host-source-main">
                      <span
                        className={`ac-host-source-icon${source.officialManager ? ' is-manager' : ''}`}
                        aria-hidden="true"
                      >
                        {source.officialManager ? <Shield size={16} /> : <AppWindow size={16} />}
                      </span>
                      <div className="ac-host-source-copy">
                        <div className="ac-host-source-name-row">
                          <strong>{source.displayName}</strong>
                          {source.officialManager ? (
                            <span className="ac-pill ac-pill--neutral">
                              {say('官方管理端', 'Official manager')}
                            </span>
                          ) : null}
                          {isCurrentManager ? (
                            <span className="ac-pill ac-pill--brand">
                              {say('当前会话', 'This session')}
                            </span>
                          ) : null}
                          {activeCount > 0 ? (
                            <span className="ac-host-live-chip">
                              {say(`${activeCount} 活跃`, `${activeCount} active`)}
                            </span>
                          ) : null}
                        </div>
                        <p className="ac-host-source-origin">{source.origin}</p>
                      </div>
                    </div>

                    <div className="ac-host-source-controls">
                      <span className={`ac-host-source-badge is-${stateBadge.tone}`}>
                        {stateBadge.label}
                      </span>
                      {isPending ? (
                        <span className="ac-host-source-hint">{say('在 PC Home 确认', 'Confirm in PC Home')}</span>
                      ) : (
                        <button
                          type="button"
                          className="ac-button ac-button--secondary ac-button--small ac-button--pill"
                          disabled={busy}
                          onClick={() => onRequestToggleSource(source.clientId, isPaused, isCurrentManager)}
                        >
                          {isPaused ? say('恢复访问', 'Resume access') : say('暂停访问', 'Pause access')}
                        </button>
                      )}
                    </div>
                  </div>

                  {confirmingSelfPause ? (
                    <div className="ac-host-inline-confirm" role="alert">
                      <p>
                        {say(
                          '暂停此管理来源将立即断开当前连接。之后需要在 PC Home 或其他已获准管理端恢复访问。是否确认暂停？',
                          'Pausing this management source disconnects you immediately. Resume access in PC Home or another approved manager. Pause this source?',
                        )}
                      </p>
                      <div className="ac-actions">
                        <button
                          type="button"
                          className="ac-button ac-button--danger ac-button--small ac-button--pill"
                          disabled={busy}
                          onClick={() => onConfirmPauseSelf(source.clientId)}
                        >
                          {say('确认暂停并断开', 'Pause and disconnect')}
                        </button>
                        <button
                          type="button"
                          className="ac-button ac-button--secondary ac-button--small ac-button--pill"
                          disabled={busy}
                          onClick={onCancelPauseSelf}
                        >
                          {say('取消', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="ac-host-panel" aria-labelledby="ac-host-ai-title">
        <div className="ac-host-panel-head">
          <span className="ac-host-section-icon" aria-hidden="true">
            <SlidersHorizontal size={17} />
          </span>
          <div className="ac-host-panel-head-copy">
            <h2 id="ac-host-ai-title">{say('远程应用 AI 配置', 'Remote application AI configuration')}</h2>
            <p>
              {say(
                '本地模型和云连接由主 PC 统一管理，这里的更改仅影响所选应用。',
                'The primary PC manages on-device models and cloud connectors. Changes here apply only to the selected app.',
              )}
            </p>
          </div>
        </div>

        {apps.size === 0 ? (
          <div className="ac-host-sub-empty">
            <p>
              {say(
                '暂无可配置的已接入应用。在 PC 端 Nimi Home 确认远程应用后，即可在此调整它的 AI 配置。',
                'No admitted remote applications yet. Confirm an application in PC Nimi Home to configure its AI routing here.',
              )}
            </p>
          </div>
        ) : (
          <>
            <div
              className="ac-host-app-picker"
              role="group"
              aria-label={say('选择已接入应用', 'Choose an admitted application')}
            >
              {Array.from(apps, ([id, app]) => {
                const active = selectedAppId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`ac-category-pill ac-host-app-pill${active ? ' is-active' : ''}`}
                    aria-pressed={active}
                    disabled={busy}
                    onClick={() => onSelectApp(id)}
                  >
                    <span>{app.name}</span>
                    {app.capabilities.size > 0 ? (
                      <span className="ac-category-count">
                        {say(`${app.capabilities.size} 项能力`, `${app.capabilities.size}`)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {selected ? (
              <div className="ac-host-model-stage">{modelConfigSlot}</div>
            ) : (
              <p className="ac-host-picker-hint">
                {say(
                  '选择一个已接入应用，读取并调整它的 AI 模型路由。',
                  'Choose an admitted application above to inspect and update its AI routing.',
                )}
              </p>
            )}
          </>
        )}
      </section>

      <section className="ac-host-danger-card" aria-labelledby="ac-host-stop-title">
        <div className="ac-host-danger-row">
          <div className="ac-host-danger-copy">
            <span className="ac-host-danger-icon" aria-hidden="true">
              <Power size={17} />
            </span>
            <div>
              <h2 id="ac-host-stop-title">{say('停止主设备服务', 'Stop the primary host')}</h2>
              <p>
                {say(
                  '所有远程连接将立即关闭。网页端无法再次启动已停止的服务，需要在主电脑上重新启动 Nimi。',
                  'All remote connections will close. This website cannot restart a stopped host; start Nimi again on the PC.',
                )}
              </p>
            </div>
          </div>

          {!confirmingStop ? (
            <button
              type="button"
              className="ac-button ac-button--danger-outline ac-button--small ac-button--pill"
              disabled={busy}
              onClick={onRequestStop}
            >
              {say('停止服务', 'Stop service')}
            </button>
          ) : null}
        </div>

        {confirmingStop ? (
          <div className="ac-host-inline-confirm ac-host-inline-confirm--danger" role="alert">
            <div className="ac-host-inline-confirm-title">
              <TriangleAlert size={15} aria-hidden="true" />
              <strong>
                {say(
                  '确认停止主设备服务并关闭所有远程连接？',
                  'Stop the primary host and close all remote connections?',
                )}
              </strong>
            </div>
            <div className="ac-actions">
              <button
                type="button"
                className="ac-button ac-button--danger ac-button--small ac-button--pill"
                disabled={busy}
                onClick={onConfirmStop}
              >
                {busy ? say('正在停止…', 'Stopping…') : say('确认停止服务', 'Confirm stop')}
              </button>
              <button
                type="button"
                className="ac-button ac-button--secondary ac-button--small ac-button--pill"
                disabled={busy}
                onClick={onCancelStop}
              >
                {say('取消', 'Cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.remote-runtime-management
export function AccountRuntimeManager({
  accountId,
  onLiveSummaryChange,
}: {
  accountId: string;
  onLiveSummaryChange?: (summary: RuntimeLiveSummary) => void;
}) {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  const locale: 'zh' | 'en' = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const zh = locale === 'zh';
  const say = (cn: string, en: string) => (zh ? cn : en);
  const clientId = String(import.meta.env.VITE_NIMI_RUNTIME_MANAGER_CLIENT_ID || '').trim();
  const realmEnvironmentId = String(import.meta.env.VITE_NIMI_REALM_ENVIRONMENT_ID || '').trim();
  const ready = !!clientId && !!realmEnvironmentId && window.location.protocol === 'https:';

  const [connection, setConnection] = useState<ManagerConnection | null>(null);
  const [access, setAccess] = useState<GetRemoteAccessStateResponse | null>(null);
  const [state, setState] = useState<ManagerState>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appId, setAppId] = useState('');
  const [config, setConfig] = useState<NimiAIConfigSnapshot | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [pendingPauseClientId, setPendingPauseClientId] = useState<string | null>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const mounted = useRef(true);
  const generation = useRef<string | null>(null);
  const session = useRef<RuntimeClientSession | null>(null);
  const peer = useRef<ManagerConnection | null>(null);
  const connecting = useRef<AbortController | null>(null);
  const working = useRef(false);
  const selectedApp = useRef('');

  function clearConfig() {
    selectedApp.current = '';
    setAppId('');
    setConfig(null);
    setConfigError(null);
  }

  function close() {
    generation.current = null;
    connecting.current?.abort();
    connecting.current = null;
    peer.current?.close();
    peer.current = null;
    if (session.current) {
      void session.current.end().catch((reason) => {
        if (mounted.current) setError(String(reason.message));
      });
    }
    session.current = null;
    if (mounted.current) {
      setConnection(null);
      setAccess(null);
      setPendingPauseClientId(null);
      setConfirmingStop(false);
      clearConfig();
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      close();
    };
  }, [accountId]);

  useEffect(() => {
    if (!onLiveSummaryChange) return;
    const phase = deriveLivePhase(Boolean(connection), state);
    const connectedPeers = connection && access ? access.connectedPeers : null;
    onLiveSummaryChange({ phase, connectedPeers });
  }, [access, connection, onLiveSummaryChange, state]);

  useEffect(() => {
    return () => {
      onLiveSummaryChange?.({ phase: 'idle', connectedPeers: null });
    };
  }, [onLiveSummaryChange]);

  const finishLogin = useEffectEvent(() => {
    if (ready) void action(connect);
  });

  useEffect(() => {
    const callback = new URLSearchParams(search);
    if (callback.has('code') || callback.has('error')) finishLogin();
  }, [search]);

  async function action(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (reason) {
      if (mounted.current) {
        const fields = extractNimiErrorFields(reason);
        setError(
          `${reason instanceof Error ? reason.message : String(reason)}${fields.reasonCode ? ` (${fields.reasonCode})` : ''}`,
        );
      }
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function verifyOwner() {
    const owner = await loadWebCurrentAccount();
    if (!mounted.current || owner?.id !== accountId) {
      close();
      throw new Error(say('账号已变更，请重新登录。', 'The account changed. Sign in again.'));
    }
  }

  async function connect() {
    await verifyOwner();
    const callback = new URL(window.location.href);
    if (!session.current && (callback.searchParams.has('code') || callback.searchParams.has('error'))) {
      const stored = sessionStorage.getItem(storageKey);
      navigate('/account/runtime', { replace: true });
      if (!stored) throw new Error(say('管理登录已失效，请重新验证。', 'Management sign-in expired. Verify again.'));
      const saved = JSON.parse(stored) as Login;
      if (
        saved.accountId !== accountId
        || saved.options.realmEnvironmentId !== realmEnvironmentId
        || saved.options.clientId !== clientId
        || saved.options.realmBaseUrl !== webRealmOrigin()
        || saved.options.officialWebBaseUrl !== window.location.origin
        || saved.options.redirectUri !== new URL('/account/runtime', window.location.origin).href
      ) {
        throw new Error(say('管理端登录条件已变化，请重新验证。', 'The management sign-in context changed. Verify again.'));
      }
      if (
        !matchesRuntimeClientCallback(callback.href, saved.transaction.redirectUri)
        || callback.searchParams.get('state') !== saved.transaction.state
      ) {
        throw new Error(say('此回调与当前管理登录不匹配。', 'This callback does not match the current management sign-in.'));
      }
      sessionStorage.removeItem(storageKey);
      generation.current = saved.transaction.applicationUserContext;
      session.current = await completeRuntimeClientLogin(
        { ...saved.options, currentUserContext: () => (mounted.current ? generation.current : null) },
        saved.transaction,
        callback.href,
      );
    }
    if (!session.current?.active) {
      const source = await createWebBrowserRealm().generated.getRuntimeClientSource({ path: { clientId } });
      if (
        source.role !== 'official_manager'
        || source.origin !== window.location.origin
        || source.redirectUri !== new URL('/account/runtime', window.location.origin).href
      ) {
        throw new Error(
          say('当前网站没有匹配的官方管理端登记。', 'This origin has no matching official manager registration.'),
        );
      }
      generation.current = crypto.randomUUID();
      const options = {
        realmBaseUrl: webRealmOrigin(),
        officialWebBaseUrl: window.location.origin,
        realmEnvironmentId,
        appId: source.appId,
        clientId,
        redirectUri: source.redirectUri,
      };
      const prepared = await prepareRuntimeClientLogin(
        { ...options, currentUserContext: () => (mounted.current ? generation.current : null) },
        accountId,
      );
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ accountId, options, transaction: prepared.transaction } satisfies Login),
      );
      window.location.assign(prepared.authorizationUrl);
      return;
    }
    const controller = new AbortController();
    connecting.current = controller;
    try {
      const { connectRemoteRuntime } = await import('@nimiplatform/sdk/runtime/remote');
      if (!mounted.current || controller.signal.aborted || !session.current?.active) return;
      const connected = await connectRemoteRuntime(session.current, {
        signal: controller.signal,
        onState(next) {
          if (!mounted.current) return;
          setState(next);
          if (next === 'closed') {
            peer.current = null;
            setConnection(null);
            setAccess(null);
            setPendingPauseClientId(null);
            setConfirmingStop(false);
            clearConfig();
          }
        },
      });
      if (!mounted.current || connected.role !== 'official_manager') {
        connected.close();
        throw new Error(say('请验证 Runtime 所有者身份后再连接。', 'Verify that you own this Runtime before connecting.'));
      }
      peer.current = connected;
      setConnection(connected);
      await readState(connected);
    } finally {
      if (connecting.current === controller) connecting.current = null;
    }
  }

  async function readState(current = peer.current) {
    if (!current || current.closed) throw new Error(say('请先连接主 Runtime。', 'Connect the primary Runtime first.'));
    setState('connected');
    await verifyOwner();
    if (!mounted.current || peer.current !== current || current.closed) return;
    const [service, sources] = await Promise.allSettled([current.management.state(), current.management.access()]);
    if (!mounted.current || peer.current !== current || current.closed) return;
    if (service.status === 'fulfilled') {
      if (service.value.mode === RuntimeServiceMode.ORDINARY) setState('running');
      if (service.value.mode === RuntimeServiceMode.MAINTENANCE) setState('maintenance');
    }
    setAccess(sources.status === 'fulfilled' ? sources.value : null);
    setPendingPauseClientId(null);
    if (service.status === 'rejected') throw service.reason;
    if (sources.status === 'rejected') throw sources.reason;
  }

  function isSelected(current: ManagerConnection, id: string) {
    return mounted.current && peer.current === current && !current.closed && selectedApp.current === id;
  }

  async function refreshConfig(current: ManagerConnection, id: string) {
    try {
      const next = await current.management.appAIConfig(id).get();
      if (isSelected(current, id)) {
        setConfig(next);
        setConfigError(null);
      }
    } catch {
      if (isSelected(current, id)) {
        setConfigError(say('无法读取最新的应用配置，请重试。', 'Could not read the latest app configuration. Try again.'));
      }
    }
  }

  async function readConfig(id: string) {
    clearConfig();
    selectedApp.current = id;
    setAppId(id);
    const current = peer.current;
    if (id && current && !current.closed) await refreshConfig(current, id);
  }

  async function overwriteConfig(current: ManagerConnection, id: string, input: NimiAIConfigOverwriteInput) {
    await verifyOwner();
    if (!isSelected(current, id)) {
      throw new Error(say('连接或所选应用已变更。', 'The connection or selected app changed.'));
    }
    const result = await current.management.appAIConfig(id).overwrite(input);
    if (isSelected(current, id)) await refreshConfig(current, id);
    return result;
  }

  async function applyToggleSource(targetClientId: string, pause: boolean) {
    const current = peer.current;
    if (!current || current.closed) {
      throw new Error(say('请先连接主 Runtime。', 'Connect the primary Runtime first.'));
    }
    setPendingPauseClientId(null);
    await verifyOwner();
    const result = await current.management.pauseSource(targetClientId, pause);
    if (result.auditDiagnostic) {
      setError(say('访问设置已生效，但审计记录未完成。', 'Access changed, but its audit record could not be completed.'));
    }
    if (!current.closed) await readState(current);
  }

  async function executeStop() {
    const current = peer.current;
    if (!current || current.closed) {
      throw new Error(say('请先连接主 Runtime。', 'Connect the primary Runtime first.'));
    }
    setConfirmingStop(false);
    await verifyOwner();
    const result = await current.management.stop();
    if (!result.accepted) throw new Error(say('停止请求未被接受。', 'The stop request was not accepted.'));
    close();
    setState('stop');
  }

  const apps = new Map<string, { name: string; capabilities: Set<string> }>();
  for (const source of access?.sources ?? []) {
    if (
      source.officialManager
      || (source.state !== RemoteSourceAccessState.ALLOWED
        && source.state !== RemoteSourceAccessState.PAUSED)
    ) {
      continue;
    }
    const app = apps.get(source.appId) ?? { name: source.displayName, capabilities: new Set<string>() };
    for (const capability of source.capabilityContractRefs) app.capabilities.add(capability);
    apps.set(source.appId, app);
  }
  const selected = apps.get(appId);

  const modelConfigSlot =
    connection && selected ? (
      <ModelConfigAIConfigSurface
        key={appId}
        context={{ owner: 'app-ai-config', appId }}
        capabilityContracts={[...selected.capabilities]}
        capabilities={config ? config.config?.capabilities ?? null : undefined}
        revision={config?.revision}
        effectiveSelections={config?.effectiveSelections}
        loading={busy && !config}
        loadError={configError}
        onRetry={() => void action(() => refreshConfig(connection, appId))}
        listOptions={(query) => connection.management.appAIConfig(appId).listOptions(query)}
        onOverwrite={(input) => overwriteConfig(connection, appId, input)}
        disabled={busy}
        copy={zh ? remoteModelConfigCopyZh : remoteModelConfigCopy}
        language={i18n.language}
        showTitle={false}
      />
    ) : null;

  return (
    <AccountRuntimeManagerView
      locale={locale}
      ready={ready}
      connected={Boolean(connection)}
      busy={busy}
      state={state}
      error={error}
      access={access}
      currentClientId={session.current?.identity.clientId ?? null}
      selectedAppId={selected ? appId : ''}
      pendingPauseClientId={pendingPauseClientId}
      confirmingStop={confirmingStop}
      onConnect={() => void action(connect)}
      onRefreshState={() => void action(() => readState())}
      onDisconnect={close}
      onRequestToggleSource={(targetClientId, currentlyPaused, isCurrentManager) => {
        if (!currentlyPaused && isCurrentManager) {
          setPendingPauseClientId(targetClientId);
          return;
        }
        void action(() => applyToggleSource(targetClientId, !currentlyPaused));
      }}
      onConfirmPauseSelf={(targetClientId) => void action(() => applyToggleSource(targetClientId, true))}
      onCancelPauseSelf={() => setPendingPauseClientId(null)}
      onSelectApp={(nextAppId) => void action(() => readConfig(nextAppId))}
      onRequestStop={() => setConfirmingStop(true)}
      onConfirmStop={() => void action(executeStop)}
      onCancelStop={() => setConfirmingStop(false)}
      modelConfigSlot={modelConfigSlot}
    />
  );
}
