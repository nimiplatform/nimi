import {
  AgentCenter,
  createAgentCenterI18n,
  type AgentCenterSectionId,
  type AgentCenterSession,
  type AgentCenterTranslationKey,
} from '@nimiplatform/kit/features/agent-center';
import { Globe2, RotateCcw, Settings2, X } from 'lucide-react';
import { useMemo } from 'react';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  agentCenterHeaderStateLabel,
  agentCenterWorldLabel,
  currentPartnerAvatarUrl,
  partnerInitial,
} from './ZhiyuAgentChatLabels';

export type RightPanelMode = 'agent' | 'closed';
export type VisibleRightPanelMode = Exclude<RightPanelMode, 'closed'>;
export type AgentPanelTab = AgentCenterSectionId;

type RightAgentPanelProps = {
  readonly mode: VisibleRightPanelMode;
  readonly evidence: ZhiyuEvidence;
  readonly currentPartnerName: string;
  readonly activeTab: AgentPanelTab;
  readonly onActiveTabChange: (tab: AgentPanelTab) => void;
  readonly onClose: () => void;
  readonly onOpenDesktopRuntimeSettings: () => void;
  readonly onRetryAgentCenter: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly session: AgentCenterSession | null;
};

const ZHIYU_AGENT_CENTER_OVERRIDES = {
  'AgentCenter.chrome.title': '织羽伙伴中心',
  'AgentCenter.chrome.eyebrow': '伙伴设置',
  'AgentCenter.chrome.closeLabel': '关闭织羽伙伴中心',
  'AgentCenter.chrome.navLabel': '织羽伙伴中心分区',
  'AgentCenter.chrome.projectionLoadFailed': '织羽伙伴中心加载失败。',
} as const satisfies Partial<Record<AgentCenterTranslationKey, string>>;

export function RightAgentPanel(props: RightAgentPanelProps) {
  const agentCenterI18n = useMemo(() => createAgentCenterI18n({
    language: 'zh',
    t(key) {
      return ZHIYU_AGENT_CENTER_OVERRIDES[key as keyof typeof ZHIYU_AGENT_CENTER_OVERRIDES] || key;
    },
  }), []);
  const agentCenterWorld = agentCenterWorldLabel(props.evidence);
  const moodLabel = agentCenterHeaderStateLabel(props.evidence.companion.currentEmotion);
  const activityLabel = agentCenterHeaderStateLabel(props.evidence.companion.executionState);
  return (
    <aside
      className="zhiyu-agent-center mr-3 my-6 flex h-[calc(100cqh-48px)] min-h-0 w-[min(460px,calc(100cqw-96px))] max-w-full shrink-0 flex-col gap-2 [grid-area:side]"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode={props.mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      data-zhiyu-agent-panel-tab={props.activeTab}
      aria-label="伙伴中心"
    >
      {moodLabel || activityLabel || agentCenterWorld ? (
        <div
          className="zhiyu-agent-center__context flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 px-1"
          data-zhiyu-agent-center-host-context="true"
        >
          {moodLabel ? (
            <span className="rounded-full bg-violet-500/10 px-2 py-px text-[10px] font-semibold text-violet-700" data-zhiyu-agent-center-state-chip="mood">
              {moodLabel}
            </span>
          ) : null}
          {activityLabel ? (
            <span className="rounded-full bg-sky-500/10 px-2 py-px text-[10px] font-semibold text-sky-700" data-zhiyu-agent-center-state-chip="activity">
              {activityLabel}
            </span>
          ) : null}
          {agentCenterWorld ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[10.5px] text-[var(--nimi-text-secondary)]" data-zhiyu-agent-center-world-name={agentCenterWorld}>
              <Globe2 aria-hidden="true" size={12} />
              <span className="truncate">{agentCenterWorld}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {props.activeTab === 'advanced' && props.evidence.chat.state === 'failed' ? (
        <section className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-3 text-xs text-[var(--nimi-text-primary)]" aria-label="最近一次回复失败">
          <strong>最近一次回复失败</strong>
          <p>{props.evidence.chat.reasonCode}</p>
          <p>{props.evidence.chat.message}</p>
        </section>
      ) : null}
      {props.session ? <AgentCenter
        activeSection={props.activeTab}
        chrome="standalone"
        i18n={agentCenterI18n}
        identity={{
          displayName: props.currentPartnerName,
          avatarUrl: currentPartnerAvatarUrl(props.evidence),
          avatarFallback: partnerInitial(props.currentPartnerName),
        }}
        onSectionChange={props.onActiveTabChange}
        placementActions={{
          close: props.onClose,
          openRuntimeSettings: props.onOpenDesktopRuntimeSettings,
          launchAvatar: props.onAvatarLaunch,
        }}
        session={props.session}
        showResourcePack
      /> : (
        <section
          className="zhiyu-agent-center__unavailable flex min-h-0 flex-1 flex-col"
          data-zhiyu-agent-center-unavailable="owner-unavailable"
          aria-label="织羽伙伴中心暂不可用"
        >
          <header className="zhiyu-agent-center__unavailable-header">
            <h2>伙伴设置</h2>
            <button
              type="button"
              className="zhiyu-agent-center__icon-button"
              aria-label="关闭织羽伙伴中心"
              data-zhiyu-agent-center-unavailable-close="true"
              onClick={props.onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="zhiyu-agent-center__unavailable-content">
            <span className="zhiyu-agent-center__unavailable-icon" aria-hidden="true">
              <Settings2 size={26} strokeWidth={1.6} />
            </span>
            <div className="zhiyu-agent-center__unavailable-copy">
              <h3>设置暂时不可用</h3>
              <p>伙伴设置暂时没有响应，请稍后重试。</p>
            </div>
            <button
              type="button"
              className="zhiyu-agent-center__retry-button"
              data-zhiyu-agent-center-unavailable-action="retry"
              data-zhiyu-agent-center-unavailable-reason="owner-unavailable"
              onClick={props.onRetryAgentCenter}
            >
              <RotateCcw size={15} aria-hidden="true" />
              <span>重新加载伙伴设置</span>
            </button>
          </div>
        </section>
      )}
    </aside>
  );
}
