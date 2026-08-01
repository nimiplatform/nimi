import nimiLogoImage from '../assets/logo.png';

type DesktopPresenceRailProps = {
  readonly agents: readonly {
    readonly itemKey: string;
    readonly agentHandle: string | null;
    readonly displayName?: string | null;
    readonly avatarUrl: string | null;
    readonly sourceReady: boolean;
  }[];
  readonly currentAgentHandle: string | null;
  readonly currentPartnerName: string;
  readonly hasCurrentPartner: boolean;
  readonly onOpenCurrentAgent: () => void;
  readonly onSelectAgent: (agentHandle: string) => void;
};

export function DesktopPresenceRail({
  agents,
  currentAgentHandle,
  currentPartnerName,
  hasCurrentPartner,
  onOpenCurrentAgent,
  onSelectAgent,
}: DesktopPresenceRailProps) {
  return (
    <section
      className="zhiyu-agent-rail"
      data-zhiyu-region="presence"
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
          const isCurrent = hasCurrentPartner && agent.agentHandle === currentAgentHandle;
          const sourceReady = agent.sourceReady === true;
          const canSelect = Boolean(agent.agentHandle) && sourceReady && !isCurrent;
          return (
            <div
              key={agent.agentHandle ?? agent.itemKey}
              className={`zhiyu-agent-rail__agent-row${sourceReady ? '' : ' is-unavailable'}`}
              data-zhiyu-local-agent-row="true"
              data-zhiyu-local-agent-source-ready={String(sourceReady)}
            >
              <span
                className={`zhiyu-agent-rail__agent-indicator${isCurrent ? ' is-active' : ''}`}
                aria-hidden="true"
              />
              <button
                type="button"
                className={`zhiyu-agent-rail__agent${isCurrent ? ' is-active' : ''}${sourceReady ? '' : ' is-unavailable'}`}
                aria-label={isCurrent ? `当前伙伴：${displayName}` : sourceReady ? `选择伙伴：${displayName}` : `伙伴资料尚未就绪：${displayName}`}
                title={sourceReady ? displayName : `${displayName} · 资料尚未就绪`}
                data-zhiyu-local-agent-candidate="true"
                data-zhiyu-local-agent-candidate-active={String(isCurrent)}
                data-zhiyu-local-agent-candidate-ready={String(sourceReady)}
                data-zhiyu-agent-handle={agent.agentHandle ?? ''}
                disabled={!agent.agentHandle || !sourceReady}
                onClick={() => {
                  if (canSelect && agent.agentHandle) {
                    onSelectAgent(agent.agentHandle);
                    return;
                  }
                  if (isCurrent) {
                    onOpenCurrentAgent();
                  }
                }}
              >
                {agent.avatarUrl ? (
                  <img
                    src={agent.avatarUrl}
                    alt=""
                    aria-hidden="true"
                    referrerPolicy="no-referrer"
                  />
                ) : partnerInitial(agent.displayName)}
              </button>
            </div>
          );
        })}
      </div>
    </section>
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
