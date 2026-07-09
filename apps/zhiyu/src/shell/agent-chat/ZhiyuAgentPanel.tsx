import { Surface } from '@nimiplatform/kit/ui';
import {
  Settings,
} from 'lucide-react';
import nimiLogoImage from '../assets/logo.png';
import type { ZhiyuEvidence } from '../app/evidence';
import { HiddenEvidenceStatus } from '../app/home-surface-sections';

type DesktopPresenceRailProps = {
  readonly evidence: ZhiyuEvidence;
  readonly agents: readonly {
    readonly itemKey: string;
    readonly localAgentRef: string | null;
    readonly displayName?: string | null;
  }[];
  readonly currentLocalAgentRef: string | null;
  readonly currentPartnerName: string;
  readonly hasCurrentPartner: boolean;
  readonly onOpenCurrentAgent: () => void;
  readonly onOpenSettings: () => void;
  readonly onSelectLocalAgent: (localAgentRef: string) => void;
};

export function DesktopPresenceRail({
  evidence,
  agents,
  currentLocalAgentRef,
  currentPartnerName,
  hasCurrentPartner,
  onOpenCurrentAgent,
  onOpenSettings,
  onSelectLocalAgent,
}: DesktopPresenceRailProps) {
  return (
    <Surface
      as="section"
      className="zhiyu-agent-rail"
      data-zhiyu-region="presence"
      material="solid"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-agent-rail__logo" aria-label="Nimi" data-zhiyu-desktop-logo-image="nimi">
        <img src={nimiLogoImage} alt="" aria-hidden="true" />
      </div>
      <div
        className="zhiyu-agent-rail__agents"
        data-zhiyu-region="relationship-rail"
        data-zhiyu-relationship-rail-density="desktop"
        data-zhiyu-relationship-rail-source="desktop-chat-relationship-rail"
        data-zhiyu-relationship-rail-empty={String(agents.length === 0)}
      >
        {agents.length > 0 ? <div className="zhiyu-agent-rail__separator" aria-hidden="true" /> : null}
        {agents.map((agent) => {
          const displayName = normalizedDisplayName(agent.displayName) ?? currentPartnerName;
          const isCurrent = hasCurrentPartner && agent.localAgentRef === currentLocalAgentRef;
          const canSelect = Boolean(agent.localAgentRef) && !isCurrent;
          return (
            <div
              key={agent.localAgentRef ?? agent.itemKey}
              className="zhiyu-agent-rail__agent-row"
              data-zhiyu-local-agent-row="true"
            >
              <span
                className={`zhiyu-agent-rail__agent-indicator${isCurrent ? ' is-active' : ''}`}
                aria-hidden="true"
              />
              <button
                type="button"
                className={`zhiyu-agent-rail__agent${isCurrent ? ' is-active' : ''}`}
                aria-label={isCurrent ? `当前伙伴：${displayName}` : `选择伙伴：${displayName}`}
                title={displayName}
                data-zhiyu-local-agent-candidate="true"
                data-zhiyu-local-agent-candidate-active={String(isCurrent)}
                data-zhiyu-local-agent-ref={agent.localAgentRef ?? ''}
                onClick={() => {
                  if (canSelect && agent.localAgentRef) {
                    onSelectLocalAgent(agent.localAgentRef);
                    return;
                  }
                  if (isCurrent) {
                    onOpenCurrentAgent();
                  }
                }}
              >
                {partnerInitial(agent.displayName)}
              </button>
            </div>
          );
        })}
      </div>
      <div className="zhiyu-agent-rail__tools" aria-label="关系栏设置">
        <button type="button" aria-label="设置" data-zhiyu-settings-entry="presence-rail" onClick={onOpenSettings}>
          <Settings size={20} aria-hidden="true" />
        </button>
      </div>
      <HiddenEvidenceStatus evidence={evidence} />
    </Surface>
  );
}

function normalizedDisplayName(value: string | null | undefined): string | null {
  const displayName = value?.trim();
  return displayName || null;
}

function partnerInitial(value: string | null | undefined): string {
  const displayName = normalizedDisplayName(value);
  if (!displayName) {
    return '本';
  }
  const firstLetter = displayName.match(/[A-Za-z]/)?.[0];
  if (firstLetter) {
    return firstLetter.toUpperCase();
  }
  return Array.from(displayName)[0] || '本';
}
