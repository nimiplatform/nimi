import { type ReactNode } from 'react';
import {
  AppCardSurface,
  IconToggleAction,
  ScrollShell,
  cn,
} from '@nimiplatform/kit/ui';
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
import type { ZhiyuCapabilityRoomState } from '../app/capability-room-state';
import type { ZhiyuCapabilityStudioCapabilityId } from '../app/developer-capability-studio';
import type { ZhiyuHomeGatedSurface } from '../app/home-product-state';
import { DiagnosticSurface } from '../app/home-surface-sections';
import type { ZhiyuAvatarLaunchAction } from '../avatar/avatar-launch';
import { AgentCenterCapabilityProbePanel } from './AgentCenterCapabilityProbePanel';
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

function agentCenterTabClassName(active: boolean): string {
  return cn(
    'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border font-medium transition-colors',
    active
      ? 'is-active w-auto min-w-[76px] justify-start border-emerald-300/70 bg-emerald-500/10 px-3 text-[13px] text-emerald-800'
      : 'w-8 border-slate-200/70 bg-white/70 px-2 text-[0px] text-slate-600 hover:border-slate-300 hover:text-slate-900',
  );
}

export function RightAgentPanel({
  mode,
  evidence,
  currentPartnerName,
  hasCurrentPartner,
  modelConfigLabel,
  modelConfigContent,
  diagnostics,
  capabilityRoom,
  capabilityPrompt,
  capabilityStudioDisabled,
  showCapabilityStudio,
  technicalSurfaces,
  primaryMemorySurface,
  primaryCompanionSurface,
  primaryAvatarSurface,
  avatarLaunchAction,
  activeTab,
  onActiveTabChange,
  onClose,
  onOpenModelConfig,
  onCapabilityPromptChange,
  onCapabilityStudioRun,
  onSelectPartner,
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
  readonly capabilityRoom: ZhiyuCapabilityRoomState;
  readonly capabilityPrompt: string;
  readonly capabilityStudioDisabled: boolean;
  readonly showCapabilityStudio: boolean;
  readonly technicalSurfaces: readonly ZhiyuHomeGatedSurface[];
  readonly primaryMemorySurface: ZhiyuHomeGatedSurface | undefined;
  readonly primaryCompanionSurface: ZhiyuHomeGatedSurface | undefined;
  readonly primaryAvatarSurface: ZhiyuHomeGatedSurface | undefined;
  readonly avatarLaunchAction: ZhiyuAvatarLaunchAction;
  readonly activeTab: AgentPanelTab;
  readonly onActiveTabChange: (tab: AgentPanelTab) => void;
  readonly onClose: () => void;
  readonly onOpenModelConfig: () => void;
  readonly onCapabilityPromptChange: (value: string) => void;
  readonly onCapabilityStudioRun: (capabilityId: ZhiyuCapabilityStudioCapabilityId) => void;
  readonly onSelectPartner: () => void;
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
      className="zhiyu-agent-center mr-2 my-12 flex h-[calc(100vh-96px)] min-h-0 w-[min(500px,calc(100vw-96px))] max-w-full shrink-0 [grid-area:side] max-[980px]:my-0 max-[980px]:mr-0 max-[980px]:h-auto max-[980px]:min-h-[min(640px,calc(100vh-20px))] max-[980px]:w-full"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center="true"
      data-zhiyu-agent-panel-mode={mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      aria-label="伙伴中心"
    >
      <AppCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
      <div
        className="zhiyu-agent-center__header flex items-start gap-3 border-b border-white/70 px-4 pb-3 pt-7"
        data-zhiyu-agent-center-header="true"
      >
        <span className="zhiyu-agent-center__avatar grid h-14 w-14 shrink-0 place-items-center rounded-[18px] border border-emerald-300/70 bg-emerald-500/20 text-[18px] font-semibold text-emerald-900 shadow-[0_0_0_3px_rgba(168,85,247,0.28)]" aria-hidden="true">
          {partnerInitial(currentPartnerName)}
        </span>
        <div className="zhiyu-agent-center__title min-w-0 flex-1">
          <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]" data-zhiyu-agent-center-eyebrow="AGENT CENTER">AGENT CENTER</span>
          <strong className="m-0 block truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{currentPartnerName}</strong>
          <div className="zhiyu-agent-center__meta mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            {agentCenterRef ? (
              <small
                className="max-w-[250px] truncate font-mono text-[11.5px] text-[var(--nimi-text-secondary)]"
                data-zhiyu-agent-center-local-agent-ref={agentCenterRef}
                title={agentCenterRef}
              >
                {agentCenterRef}
              </small>
            ) : (
              <small className="max-w-[250px] truncate font-mono text-[11.5px] text-[var(--nimi-text-secondary)]" data-zhiyu-agent-center-local-agent-ref="not_selected">
                未选择本地伙伴
              </small>
            )}
            {agentCenterWorld ? (
              <em className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,#a855f7_30%,transparent)] bg-[color-mix(in_srgb,#a855f7_8%,transparent)] px-2 py-px text-[10.5px] font-medium not-italic text-[#7c3aed]" data-zhiyu-agent-center-world-chip="true">
                {agentCenterWorld}
              </em>
            ) : null}
          </div>
        </div>
        <IconToggleAction
          type="button"
          aria-label="关闭右侧面板"
          title="Close panel"
          data-zhiyu-agent-panel-close="true"
          onClick={onClose}
          icon={<X size={16} aria-hidden="true" />}
        />
      </div>
      <nav className="zhiyu-agent-center__tabs flex min-w-0 gap-2 overflow-x-auto px-4 py-3" aria-label="伙伴中心分区">
            <button type="button" data-zhiyu-agent-center-tab-button="overview" aria-current={activeTab === 'overview' ? 'page' : undefined} className={agentCenterTabClassName(activeTab === 'overview')} onClick={() => onActiveTabChange('overview')}><Home size={16} aria-hidden="true" /><span className={activeTab === 'overview' ? '' : 'sr-only'}>概览</span></button>
            <button type="button" data-zhiyu-agent-center-tab-button="appearance" aria-current={activeTab === 'appearance' ? 'page' : undefined} className={agentCenterTabClassName(activeTab === 'appearance')} onClick={() => onActiveTabChange('appearance')}><Eye size={16} aria-hidden="true" /><span className={activeTab === 'appearance' ? '' : 'sr-only'}>外观</span></button>
            <button type="button" data-zhiyu-agent-center-tab-button="behavior" aria-current={activeTab === 'behavior' ? 'page' : undefined} className={agentCenterTabClassName(activeTab === 'behavior')} onClick={() => onActiveTabChange('behavior')}><Brain size={16} aria-hidden="true" /><span className={activeTab === 'behavior' ? '' : 'sr-only'}>聊天行为</span></button>
            <button type="button" data-zhiyu-agent-center-tab-button="model" aria-current={activeTab === 'model' ? 'page' : undefined} className={agentCenterTabClassName(activeTab === 'model')} onClick={() => onActiveTabChange('model')}><SlidersHorizontal size={16} aria-hidden="true" /><span className={activeTab === 'model' ? '' : 'sr-only'}>模型</span></button>
            <button type="button" data-zhiyu-agent-center-tab-button="cognition" aria-current={activeTab === 'cognition' ? 'page' : undefined} className={agentCenterTabClassName(activeTab === 'cognition')} onClick={() => onActiveTabChange('cognition')}><Lightbulb size={16} aria-hidden="true" /><span className={activeTab === 'cognition' ? '' : 'sr-only'}>认知</span></button>
            <button type="button" data-zhiyu-agent-center-tab-button="advanced" aria-current={activeTab === 'advanced' ? 'page' : undefined} className={agentCenterTabClassName(activeTab === 'advanced')} onClick={() => onActiveTabChange('advanced')}><Settings size={16} aria-hidden="true" /><span className={activeTab === 'advanced' ? '' : 'sr-only'}>高级</span></button>
      </nav>
      <ScrollShell className="zhiyu-agent-center__body grid flex-1 content-start gap-3 px-5 py-3" data-zhiyu-agent-panel-tab={activeTab}>
            {activeTab === 'model' ? (
              <AgentCenterModelPanel
                evidence={evidence}
                modelConfigContent={modelConfigContent}
                onOpenModelConfig={onOpenModelConfig}
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
                evidence={evidence}
                diagnostics={diagnostics}
                capabilityRoom={capabilityRoom}
                capabilityPrompt={capabilityPrompt}
                capabilityStudioDisabled={capabilityStudioDisabled}
                showCapabilityStudio={showCapabilityStudio}
                hasCurrentPartner={hasCurrentPartner}
                technicalSurfaces={technicalSurfaces}
                onCapabilityPromptChange={onCapabilityPromptChange}
                onCapabilityStudioRun={onCapabilityStudioRun}
                onOpenModelConfig={onOpenModelConfig}
                onSelectPartner={onSelectPartner}
                renderGatedSurface={renderGatedSurface}
              />
            ) : (
              <>
            <section className={`zhiyu-agent-center__setup-hero${activeTab === 'overview' ? '' : ' is-compact'}`} data-zhiyu-agent-center-setup={`${setupDone}/${setupTotal}`}>
              <div className="zhiyu-agent-center__setup-meter">
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
            <section className="zhiyu-agent-center__section">
              <h2>配置清单</h2>
              <div className="zhiyu-agent-center__checklist-card">
                <RightPanelRow index={1} title="形象" detail="启动与停止入口在输入区。" status={avatarReady ? '已就绪' : '需设置'} tone={avatarReady ? 'ready' : 'attention'} onClick={openAppearanceConfig} />
                <RightPanelRow index={2} title="模型" detail={modelConfigLabel} status={routeReady ? '已就绪' : '需设置'} tone={routeReady ? 'ready' : 'attention'} onClick={onOpenModelConfig} />
                <RightPanelRow index={3} title="对话行为" detail="主动模式保留入口，当前关闭。" status="关闭" tone="muted" onClick={() => onActiveTabChange('behavior')} />
                <RightPanelRow index={4} title="认知" detail="记忆与认知只读展示。" status={cognitionReady ? '只读' : '等待'} tone={cognitionReady ? 'ready' : 'muted'} onClick={() => onActiveTabChange('cognition')} />
              </div>
            </section>
            <section className="zhiyu-agent-center__section">
              <h2>当前状态</h2>
              <div className="zhiyu-agent-center__live-state-card">
                <KeyValue label="状态" value={stateDisplayLabel(evidence.companion.state || evidence.chat.state)} badge={evidence.chat.state === 'streaming' ? '回复中' : '空闲'} />
                <KeyValue label="心情" value={evidence.companion.currentEmotion ?? '未投影'} />
                <KeyValue label="活动" value={stateDisplayLabel(evidence.companion.executionState ?? evidence.chat.state)} />
                <KeyValue label="形象" value={stateDisplayLabel(evidence.avatar.visualReadiness ?? 'not_projected')} />
              </div>
            </section>
            <div className="zhiyu-agent-center__projections">
              {primaryCompanionSurface ? renderGatedSurface(primaryCompanionSurface) : null}
              {primaryAvatarSurface ? renderGatedSurface(primaryAvatarSurface) : null}
              {primaryMemorySurface ? renderGatedSurface(primaryMemorySurface) : null}
            </div>
              </>
            )}
      </ScrollShell>
      </AppCardSurface>
    </aside>
  );
}

function AgentCenterModelPanel({
  evidence,
  modelConfigContent,
  onOpenModelConfig,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly modelConfigContent?: ReactNode;
  readonly onOpenModelConfig: () => void;
}) {
  const routeReady = Boolean(evidence.route.executionBinding);
  return (
    <div className="zhiyu-agent-center__model-tab" data-zhiyu-agent-model-tab="true">
      <section className="zhiyu-agent-center__section zhiyu-agent-center__model-route-section">
        <div className="zhiyu-agent-center__section-head">
          <span>模型</span>
          <div>
            <h2>模型路由</h2>
            <em className={`zhiyu-agent-center__status is-${routeReady ? 'ready' : 'attention'}`}>
              {routeReady ? '已就绪' : '需要设置'}
            </em>
          </div>
        </div>
        <div className="zhiyu-agent-center__model-route-card" data-zhiyu-agent-model-route-card="true">
          <div>
            <strong>共享模型配置</strong>
            <span>该 Agent 使用工作区的默认路由。</span>
          </div>
          <button type="button" onClick={onOpenModelConfig}>
            覆盖
          </button>
        </div>
      </section>
      <section className="zhiyu-agent-center__section zhiyu-agent-center__model-config-section">
        <div className="zhiyu-agent-center__model-config-card">
          {modelConfigContent ?? (
            <div className="zhiyu-agent-center__model-empty">
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
      className="zhiyu-agent-center__behavior-tab"
      data-zhiyu-agent-behavior-panel="true"
      data-zhiyu-agent-behavior-state={proactive.state}
      data-zhiyu-agent-behavior-mode={autonomyMode}
      data-zhiyu-agent-behavior-ready={String(behaviorReady)}
    >
      <section className="zhiyu-agent-center__section">
        <div className="zhiyu-agent-center__section-head">
          <span>聊天行为</span>
          <div>
            <h2>行为模式</h2>
            <em className={`zhiyu-agent-center__status is-${behaviorReady ? 'ready' : 'muted'}`}>
              {behaviorStatus}
            </em>
          </div>
        </div>
        <div className="zhiyu-agent-center__behavior-mode-card" data-zhiyu-agent-behavior-mode-picker="read-only">
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

      <section className="zhiyu-agent-center__section">
        <h2>服务托管</h2>
        <div className="zhiyu-agent-center__live-state-card" data-zhiyu-agent-behavior-service="runtime-managed">
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
      className="zhiyu-agent-center__cognition-tab"
      data-zhiyu-agent-cognition-panel="true"
      data-zhiyu-agent-cognition-ready={String(cognitionReady)}
      data-zhiyu-agent-memory-record-count={String(evidence.memory.recordCount)}
    >
      <section className="zhiyu-agent-center__section">
        <div className="zhiyu-agent-center__section-head">
          <span>认知</span>
          <div>
            <h2>来源详情</h2>
            <em className={`zhiyu-agent-center__status is-${cognitionReady ? 'ready' : 'muted'}`}>
              {cognitionReady ? '只读' : '不可用'}
            </em>
          </div>
        </div>
        <div className="zhiyu-agent-center__cognition-source-card" data-zhiyu-agent-cognition-source="true">
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

      <section className="zhiyu-agent-center__section">
        <h2>认知状态</h2>
        <div className="zhiyu-agent-center__live-state-card" data-zhiyu-agent-cognition-status="true">
          <KeyValue label="Memory mode" value={evidence.memory.ready ? 'Baseline' : 'Unavailable'} badge="只读" />
          <KeyValue label="Memory records" value={String(evidence.memory.recordCount)} />
          <KeyValue label="Memory banks" value={String(evidence.memory.bankCount)} />
          <KeyValue label="Companion state" value={stateDisplayLabel(evidence.companion.state)} />
        </div>
      </section>

      <div className="zhiyu-agent-center__projections" data-zhiyu-agent-cognition-projections="true">
        {primaryMemorySurface ? renderGatedSurface(primaryMemorySurface) : null}
        {primaryCompanionSurface ? renderGatedSurface(primaryCompanionSurface) : null}
      </div>
    </div>
  );
}

function AgentCenterAdvancedPanel({
  evidence,
  diagnostics,
  capabilityRoom,
  capabilityPrompt,
  capabilityStudioDisabled,
  showCapabilityStudio,
  hasCurrentPartner,
  technicalSurfaces,
  onCapabilityPromptChange,
  onCapabilityStudioRun,
  onOpenModelConfig,
  onSelectPartner,
  renderGatedSurface,
}: {
  readonly evidence: ZhiyuEvidence;
  readonly diagnostics: ZhiyuDiagnosticState;
  readonly capabilityRoom: ZhiyuCapabilityRoomState;
  readonly capabilityPrompt: string;
  readonly capabilityStudioDisabled: boolean;
  readonly showCapabilityStudio: boolean;
  readonly hasCurrentPartner: boolean;
  readonly technicalSurfaces: readonly ZhiyuHomeGatedSurface[];
  readonly onCapabilityPromptChange: (value: string) => void;
  readonly onCapabilityStudioRun: (capabilityId: ZhiyuCapabilityStudioCapabilityId) => void;
  readonly onOpenModelConfig: () => void;
  readonly onSelectPartner: () => void;
  readonly renderGatedSurface: (surface: ZhiyuHomeGatedSurface) => ReactNode;
}) {
  return (
    <div
      className="zhiyu-agent-center__advanced-tab"
      data-zhiyu-agent-advanced-panel="true"
      data-zhiyu-agent-advanced-mode={diagnostics.mode}
    >
      <section className="zhiyu-agent-center__advanced-warning" data-zhiyu-agent-advanced-warning="true">
        <strong>诊断与运行时覆盖</strong>
        <span>这些内容用于开发与审计；Zhiyu 只展示 Runtime/SDK 投影，不在应用内创建平行状态。</span>
      </section>
      <AgentCenterCapabilityProbePanel
        evidence={evidence}
        capabilityRoom={capabilityRoom}
        capabilityPrompt={capabilityPrompt}
        capabilityStudioDisabled={capabilityStudioDisabled}
        showCapabilityStudio={showCapabilityStudio}
        hasCurrentPartner={hasCurrentPartner}
        onCapabilityPromptChange={onCapabilityPromptChange}
        onCapabilityStudioRun={onCapabilityStudioRun}
        onOpenModelConfig={onOpenModelConfig}
        onSelectPartner={onSelectPartner}
      />
      <div className="zhiyu-agent-center__projections" data-zhiyu-agent-advanced-technical-surfaces="true">
        {technicalSurfaces.map(renderGatedSurface)}
      </div>
      <DiagnosticSurface diagnostics={diagnostics} />
    </div>
  );
}
