import {
  AgentCenter,
  createAgentCenterI18n,
  type AgentCenterSectionId,
  type AgentCenterSession,
  type AgentCenterTranslationKey,
} from '@nimiplatform/kit/features/agent-center';
import { Globe2, X } from 'lucide-react';
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
  readonly onOpenDesktopPersonaCatalog: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly session: AgentCenterSession | null;
};

const ZHIYU_AGENT_CENTER_OVERRIDES = {
  'AgentCenter.chrome.title': '织羽伙伴中心',
  'AgentCenter.chrome.eyebrow': '织羽伙伴中心',
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
      className="zhiyu-agent-center mr-2 my-12 flex h-[calc(100cqh-96px)] min-h-0 w-[min(500px,calc(100cqw-96px))] max-w-full shrink-0 flex-col gap-2 [grid-area:side] max-[980px]:my-0 max-[980px]:mr-0 max-[980px]:h-auto max-[980px]:min-h-[min(640px,calc(100cqh-20px))] max-[980px]:w-full"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode={props.mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      data-zhiyu-agent-panel-tab={props.activeTab}
      aria-label="伙伴中心"
    >
      {moodLabel || activityLabel || agentCenterWorld ? (
        <div
          className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 px-1"
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
          openRuntimeSettings: props.onOpenDesktopPersonaCatalog,
          launchAvatar: props.onAvatarLaunch,
        }}
        session={props.session}
      /> : (
        <section
          className="flex min-h-0 flex-1 flex-col gap-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4"
          data-zhiyu-agent-center-unavailable="protected-app-access-unavailable"
          aria-label="织羽伙伴中心暂不可用"
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold">织羽伙伴中心</h2>
            <button
              type="button"
              aria-label="关闭织羽伙伴中心"
              data-zhiyu-agent-center-unavailable-close="true"
              onClick={props.onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="m-0 text-xs leading-relaxed text-[var(--nimi-text-secondary)]">
            伙伴设置暂时无法在织羽内修改，请前往 Nimi Desktop 继续设置。
          </p>
          <button
            type="button"
            data-zhiyu-agent-center-unavailable-action="desktop-open-persona-catalog"
            data-zhiyu-desktop-open-action="desktop_open_persona_catalog"
            onClick={props.onOpenDesktopPersonaCatalog}
          >
            在 Nimi Desktop 中浏览伙伴目录
          </button>
        </section>
      )}
    </aside>
  );
}
