import { type ReactNode } from 'react';
import {
  Brain,
  Eye,
  Home,
  Lightbulb,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuDiagnosticState } from '../app/diagnostic-state';
import type { ZhiyuHomeGatedSurface } from '../app/home-product-state';
import { DiagnosticSurface } from '../app/home-surface-sections';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { AgentCenterAppearancePanel } from './ZhiyuAgentAppearancePanel';
import {
  BehaviorControlRow,
  KeyValue,
  RightPanelRow,
  behaviorModeSubtitle,
  behaviorModeTitle,
} from './ZhiyuAgentChatPieces';
import {
  agentCenterLocalAgentRef,
  agentCenterWorldLabel,
  currentPartnerSubtitle,
  partnerInitial,
  stateDisplayLabel,
} from './ZhiyuAgentChatLabels';

export type RightPanelMode = 'agent' | 'closed';
export type VisibleRightPanelMode = Exclude<RightPanelMode, 'closed'>;
export type AgentPanelTab = 'overview' | 'appearance' | 'behavior' | 'model' | 'cognition' | 'advanced';

export function RightAgentPanel({
  mode,
  evidence,
  currentPartnerName,
  hasCurrentPartner,
  modelConfigLabel,
  modelConfigContent,
  diagnostics,
  technicalSurfaces,
  primaryMemorySurface,
  primaryCompanionSurface,
  primaryAvatarSurface,
  avatarLaunchAction,
  activeTab,
  onActiveTabChange,
  onClose,
  onOpenModelConfig,
  onAvatarLaunch,
  renderGatedSurface,
}: {
  readonly mode: VisibleRightPanelMode;
  readonly evidence: ZhiyuEvidence;
  readonly currentPartnerName: string;
  readonly hasCurrentPartner: boolean;
  readonly modelConfigLabel: string;
  readonly modelConfigContent?: ReactNode;
  readonly diagnostics: ZhiyuDiagnosticState;
  readonly technicalSurfaces: readonly ZhiyuHomeGatedSurface[];
  readonly primaryMemorySurface: ZhiyuHomeGatedSurface | undefined;
  readonly primaryCompanionSurface: ZhiyuHomeGatedSurface | undefined;
  readonly primaryAvatarSurface: ZhiyuHomeGatedSurface | undefined;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly activeTab: AgentPanelTab;
  readonly onActiveTabChange: (tab: AgentPanelTab) => void;
  readonly onClose: () => void;
  readonly onOpenModelConfig: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly renderGatedSurface: (surface: ZhiyuHomeGatedSurface) => ReactNode;
}) {
  const routeReady = Boolean(evidence.route.executionBinding);
  const avatarReady = evidence.avatar.ready || avatarLaunchAction.state === 'ready';
  const cognitionReady = evidence.memory.ready || evidence.companion.ready;
  const setupTotal = 5;
  const setupDone = [
    hasCurrentPartner,
    routeReady,
    avatarReady,
    cognitionReady,
    evidence.runtime.ready,
  ].filter(Boolean).length;
  const openAppearanceConfig = () => onActiveTabChange('appearance');
  const agentCenterRef = agentCenterLocalAgentRef(evidence);
  const agentCenterWorld = agentCenterWorldLabel(evidence);
  return (
    <aside
      className="zhiyu-home__agent-panel"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-panel-mode={mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      aria-label="伙伴中心"
    >
      <div
        className="zhiyu-home__agent-panel-header"
        data-zhiyu-agent-center-header="true"
      >
        <span className="zhiyu-home__agent-panel-avatar" aria-hidden="true">
          {partnerInitial(currentPartnerName)}
        </span>
        <div className="zhiyu-home__agent-panel-title">
          <span data-zhiyu-agent-center-eyebrow="AGENT CENTER">AGENT CENTER</span>
          <strong>{currentPartnerName}</strong>
          <div className="zhiyu-home__agent-panel-meta">
            {agentCenterRef ? (
              <small
                data-zhiyu-agent-center-local-agent-ref={agentCenterRef}
                title={agentCenterRef}
              >
                {agentCenterRef}
              </small>
            ) : (
              <small data-zhiyu-agent-center-local-agent-ref="not_selected">
                未选择本地伙伴
              </small>
            )}
            {agentCenterWorld ? (
              <em data-zhiyu-agent-center-world-chip="true">
                {agentCenterWorld}
              </em>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭右侧面板"
          data-zhiyu-agent-panel-close="true"
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </button>
      </div>
      <nav className="zhiyu-home__agent-tabs" aria-label="伙伴中心分区">
            <button type="button" data-zhiyu-agent-center-tab-button="overview" aria-current={activeTab === 'overview' ? 'page' : undefined} className={activeTab === 'overview' ? 'is-active' : ''} onClick={() => onActiveTabChange('overview')}><Home size={16} aria-hidden="true" />概览</button>
            <button type="button" data-zhiyu-agent-center-tab-button="appearance" aria-current={activeTab === 'appearance' ? 'page' : undefined} className={activeTab === 'appearance' ? 'is-active' : ''} onClick={() => onActiveTabChange('appearance')}><Eye size={16} aria-hidden="true" />外观</button>
            <button type="button" data-zhiyu-agent-center-tab-button="behavior" aria-current={activeTab === 'behavior' ? 'page' : undefined} className={activeTab === 'behavior' ? 'is-active' : ''} onClick={() => onActiveTabChange('behavior')}><Brain size={16} aria-hidden="true" />聊天行为</button>
            <button type="button" data-zhiyu-agent-center-tab-button="model" aria-current={activeTab === 'model' ? 'page' : undefined} className={activeTab === 'model' ? 'is-active' : ''} onClick={() => onActiveTabChange('model')}><SlidersHorizontal size={16} aria-hidden="true" />模型</button>
            <button type="button" data-zhiyu-agent-center-tab-button="cognition" aria-current={activeTab === 'cognition' ? 'page' : undefined} className={activeTab === 'cognition' ? 'is-active' : ''} onClick={() => onActiveTabChange('cognition')}><Lightbulb size={16} aria-hidden="true" />认知</button>
            <button type="button" data-zhiyu-agent-center-tab-button="advanced" aria-current={activeTab === 'advanced' ? 'page' : undefined} className={activeTab === 'advanced' ? 'is-active' : ''} onClick={() => onActiveTabChange('advanced')}><Settings size={16} aria-hidden="true" />高级</button>
      </nav>
      <div className="zhiyu-home__agent-panel-scroll" data-zhiyu-agent-panel-tab={activeTab}>
            {activeTab === 'model' ? (
              <AgentCenterModelPanel
                evidence={evidence}
                modelConfigLabel={modelConfigLabel}
                modelConfigContent={modelConfigContent}
              />
            ) : activeTab === 'appearance' ? (
              <AgentCenterAppearancePanel
                evidence={evidence}
                avatarLaunchAction={avatarLaunchAction}
                onAvatarLaunch={onAvatarLaunch}
              />
            ) : activeTab === 'behavior' ? (
              <AgentCenterBehaviorPanel
                evidence={evidence}
                avatarLaunchAction={avatarLaunchAction}
              />
            ) : activeTab === 'cognition' ? (
              <AgentCenterCognitionPanel
                evidence={evidence}
                primaryMemorySurface={primaryMemorySurface}
                primaryCompanionSurface={primaryCompanionSurface}
                renderGatedSurface={renderGatedSurface}
              />
            ) : activeTab === 'advanced' ? (
              <AgentCenterAdvancedPanel
                diagnostics={diagnostics}
                technicalSurfaces={technicalSurfaces}
                renderGatedSurface={renderGatedSurface}
              />
            ) : (
              <>
            <section className={`zhiyu-home__setup-hero${activeTab === 'overview' ? '' : ' is-compact'}`} data-zhiyu-agent-center-setup={`${setupDone}/${setupTotal}`}>
              <div className="zhiyu-home__setup-meter">
                <strong>{setupDone}</strong>
                <span>/{setupTotal}</span>
                <small>配置</small>
              </div>
              <div>
                <strong>{setupDone === setupTotal ? '可以开始对话' : '还差一点就绪'}</strong>
                <span>还有 {setupTotal - setupDone} 项需要处理。</span>
                <button type="button" onClick={avatarReady ? onOpenModelConfig : openAppearanceConfig}>
                  {avatarReady ? '配置模型' : '继续设置形象'}
                </button>
              </div>
            </section>
            <section className="zhiyu-home__agent-section">
              <h2>配置清单</h2>
              <div className="zhiyu-home__checklist-card">
                <RightPanelRow index={1} title="形象" detail="启动与停止入口在输入区。" status={avatarReady ? '已就绪' : '需设置'} tone={avatarReady ? 'ready' : 'attention'} onClick={openAppearanceConfig} />
                <RightPanelRow index={2} title="模型" detail={modelConfigLabel} status={routeReady ? '已就绪' : '需设置'} tone={routeReady ? 'ready' : 'attention'} onClick={onOpenModelConfig} />
                <RightPanelRow index={3} title="对话行为" detail="主动模式保留入口，当前关闭。" status="关闭" tone="muted" onClick={() => onActiveTabChange('behavior')} />
                <RightPanelRow index={4} title="认知" detail="记忆与认知只读展示。" status={cognitionReady ? '只读' : '等待'} tone={cognitionReady ? 'ready' : 'muted'} onClick={() => onActiveTabChange('cognition')} />
              </div>
            </section>
            <section className="zhiyu-home__agent-section">
              <h2>当前状态</h2>
              <div className="zhiyu-home__live-state-card">
                <KeyValue label="状态" value={stateDisplayLabel(evidence.companion.state || evidence.chat.state)} badge={evidence.chat.state === 'streaming' ? '回复中' : '空闲'} />
                <KeyValue label="心情" value={evidence.companion.currentEmotion ?? '未投影'} />
                <KeyValue label="活动" value={stateDisplayLabel(evidence.companion.executionState ?? evidence.chat.state)} />
                <KeyValue label="形象" value={stateDisplayLabel(evidence.avatar.visualReadiness ?? 'not_projected')} />
              </div>
            </section>
            <div className="zhiyu-home__right-projections">
              {primaryCompanionSurface ? renderGatedSurface(primaryCompanionSurface) : null}
              {primaryAvatarSurface ? renderGatedSurface(primaryAvatarSurface) : null}
              {primaryMemorySurface ? renderGatedSurface(primaryMemorySurface) : null}
            </div>
              </>
            )}
      </div>
    </aside>
  );
}

function AgentCenterModelPanel({
  evidence,
  modelConfigLabel,
  modelConfigContent,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly modelConfigLabel: string;
  readonly modelConfigContent?: ReactNode;
}) {
  const routeReady = Boolean(evidence.route.executionBinding);
  return (
    <div className="zhiyu-home__agent-model-tab" data-zhiyu-agent-model-tab="true">
      <section className="zhiyu-home__agent-section zhiyu-home__agent-model-route-section">
        <div className="zhiyu-home__agent-section-head">
          <span>模型</span>
          <div>
            <h2>模型路由</h2>
            <em className={`zhiyu-home__agent-model-status is-${routeReady ? 'ready' : 'attention'}`}>
              {routeReady ? '已就绪' : '需要设置'}
            </em>
          </div>
        </div>
        <div className="zhiyu-home__model-route-card" data-zhiyu-agent-model-route-card="true">
          <div>
            <strong>共享模型配置</strong>
            <span>{routeReady ? modelConfigLabel : '该伙伴使用织羽的默认 runtime 路由。'}</span>
          </div>
          <button type="button" disabled title="路由覆盖由 Runtime / SDK 配置面负责">
            覆盖
          </button>
        </div>
      </section>
      <section className="zhiyu-home__agent-section zhiyu-home__agent-model-config-section">
        <div className="zhiyu-home__agent-model-config-card">
          {modelConfigContent ?? (
            <div className="zhiyu-home__agent-model-empty">
              模型配置暂时不可用。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AgentCenterBehaviorPanel({
  evidence,
  avatarLaunchAction,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
}) {
  const proactive = evidence.companion.proactiveInterruptibility;
  const behaviorReady = proactive.ready || proactive.state === 'off' || proactive.state === 'projected';
  const behaviorStatus = behaviorReady ? stateDisplayLabel(proactive.state) : '不可用';
  const autonomyMode = proactive.mode ?? 'off';
  const pendingActions = evidence.delegation.pendingApprovalCount + evidence.delegation.diagnosticCount;
  const voiceAutoplayReady = evidence.avatar.voiceReadiness === 'projected' && avatarLaunchAction.state === 'ready';
  return (
    <div
      className="zhiyu-home__agent-behavior-tab"
      data-zhiyu-agent-behavior-panel="true"
      data-zhiyu-agent-behavior-state={proactive.state}
      data-zhiyu-agent-behavior-mode={autonomyMode}
      data-zhiyu-agent-behavior-ready={String(behaviorReady)}
    >
      <section className="zhiyu-home__agent-section">
        <div className="zhiyu-home__agent-section-head">
          <span>聊天行为</span>
          <div>
            <h2>行为模式</h2>
            <em className={`zhiyu-home__agent-model-status is-${behaviorReady ? 'ready' : 'muted'}`}>
              {behaviorStatus}
            </em>
          </div>
        </div>
        <div className="zhiyu-home__behavior-mode-card" data-zhiyu-agent-behavior-mode-picker="read-only">
          {(['off', 'low', 'medium', 'high'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled
              className={autonomyMode === mode ? 'is-selected' : ''}
              data-zhiyu-agent-behavior-mode-option={mode}
              data-zhiyu-agent-behavior-mode-selected={String(autonomyMode === mode)}
              title="行为模式由 Runtime/SDK authority 管理"
            >
              <strong>{behaviorModeTitle(mode)}</strong>
              <span>{behaviorModeSubtitle(mode)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="zhiyu-home__avatar-config-card" data-zhiyu-agent-behavior-controls="read-only">
        <div className="zhiyu-home__avatar-config-head">
          <h2>主动行为</h2>
          <span>Runtime 管理</span>
        </div>
        <BehaviorControlRow
          label="主动沟通"
          detail={proactive.message}
          status={behaviorStatus}
          dataKey="proactive"
        />
        <BehaviorControlRow
          label="Avatar 语音自动播放"
          detail={voiceAutoplayReady ? 'Avatar 可播放 Runtime 语音回复。' : '需要 Avatar 启动与语音投影证据。'}
          status={voiceAutoplayReady ? '开启' : '关闭'}
          dataKey="avatar-autoplay"
        />
        <BehaviorControlRow
          label="生成语音缓存"
          detail="清理动作需要公开 Runtime/SDK handoff。"
          status="只读"
          dataKey="voice-cleanup"
        />
      </section>

      <section className="zhiyu-home__agent-section">
        <h2>服务托管</h2>
        <div className="zhiyu-home__live-state-card" data-zhiyu-agent-behavior-service="runtime-managed">
          <KeyValue label="主动沟通" value={behaviorStatus} badge={proactive.ready ? '已投影' : '只读'} />
          <KeyValue label="连续动作" value={evidence.delegation.approvalMode ?? '未投影'} />
          <KeyValue label="待处理动作" value={String(pendingActions)} />
          <KeyValue label="Avatar 语音自动播放" value={voiceAutoplayReady ? '开启' : '关闭'} />
        </div>
      </section>
    </div>
  );
}

function AgentCenterCognitionPanel({
  evidence,
  primaryMemorySurface,
  primaryCompanionSurface,
  renderGatedSurface,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly primaryMemorySurface: ZhiyuHomeGatedSurface | undefined;
  readonly primaryCompanionSurface: ZhiyuHomeGatedSurface | undefined;
  readonly renderGatedSurface: (surface: ZhiyuHomeGatedSurface) => ReactNode;
}) {
  const currentAgent = evidence.inventory.localAgents.find((agent) => agent.localAgentRef === evidence.localAgent.localAgentRef) ?? evidence.inventory.localAgents[0] ?? null;
  const cognitionReady = evidence.memory.ready || evidence.companion.ready;
  return (
    <div
      className="zhiyu-home__agent-cognition-tab"
      data-zhiyu-agent-cognition-panel="true"
      data-zhiyu-agent-cognition-ready={String(cognitionReady)}
      data-zhiyu-agent-memory-record-count={String(evidence.memory.recordCount)}
    >
      <section className="zhiyu-home__agent-section">
        <div className="zhiyu-home__agent-section-head">
          <span>认知</span>
          <div>
            <h2>来源详情</h2>
            <em className={`zhiyu-home__agent-model-status is-${cognitionReady ? 'ready' : 'muted'}`}>
              {cognitionReady ? '只读' : '不可用'}
            </em>
          </div>
        </div>
        <div className="zhiyu-home__cognition-source-card" data-zhiyu-agent-cognition-source="true">
          <KeyValue label="人格" value={currentPartnerSubtitle(evidence)} />
          <KeyValue label="世界观" value={currentAgent?.sourceWorldId ?? evidence.source.sourceRef?.worldId ?? '未提供'} />
          <KeyValue label="归属" value={evidence.localAgent.ownerUserId ?? '未提供'} />
          <KeyValue label="活动" value={stateDisplayLabel(evidence.companion.executionState ?? evidence.chat.state)} />
          <KeyValue label="状态备注" value={evidence.companion.statusText ?? '未提供'} />
          <KeyValue label="参考图像" value={evidence.avatar.projectionRef ? '已投影' : '未提供'} />
          <KeyValue label="参考语音" value={evidence.avatar.voiceReadiness === 'projected' ? '已投影' : '未提供'} />
          <KeyValue label="认知状态" value={evidence.memory.ready ? 'Memory 已连接' : stateDisplayLabel(evidence.memory.state)} />
        </div>
      </section>

      <section className="zhiyu-home__agent-section">
        <h2>认知状态</h2>
        <div className="zhiyu-home__live-state-card" data-zhiyu-agent-cognition-status="true">
          <KeyValue label="Memory mode" value={evidence.memory.ready ? 'Baseline' : 'Unavailable'} badge="只读" />
          <KeyValue label="Memory records" value={String(evidence.memory.recordCount)} />
          <KeyValue label="Memory banks" value={String(evidence.memory.bankCount)} />
          <KeyValue label="Companion state" value={stateDisplayLabel(evidence.companion.state)} />
        </div>
      </section>

      <div className="zhiyu-home__right-projections" data-zhiyu-agent-cognition-projections="true">
        {primaryMemorySurface ? renderGatedSurface(primaryMemorySurface) : null}
        {primaryCompanionSurface ? renderGatedSurface(primaryCompanionSurface) : null}
      </div>
    </div>
  );
}

function AgentCenterAdvancedPanel({
  diagnostics,
  technicalSurfaces,
  renderGatedSurface,
}: {
  readonly diagnostics: ZhiyuDiagnosticState;
  readonly technicalSurfaces: readonly ZhiyuHomeGatedSurface[];
  readonly renderGatedSurface: (surface: ZhiyuHomeGatedSurface) => ReactNode;
}) {
  return (
    <div
      className="zhiyu-home__agent-advanced-tab"
      data-zhiyu-agent-advanced-panel="true"
      data-zhiyu-agent-advanced-mode={diagnostics.mode}
    >
      <section className="zhiyu-home__advanced-warning" data-zhiyu-agent-advanced-warning="true">
        <strong>诊断与运行时覆盖</strong>
        <span>这些内容用于开发与审计；Zhiyu 只展示 Runtime/SDK 投影，不在应用内创建平行状态。</span>
      </section>
      <div className="zhiyu-home__right-projections" data-zhiyu-agent-advanced-technical-surfaces="true">
        {technicalSurfaces.map(renderGatedSurface)}
      </div>
      <DiagnosticSurface diagnostics={diagnostics} />
    </div>
  );
}
