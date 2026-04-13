import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEmptyState } from '@renderer/components/page-layout.js';
import { ForgeListCard } from '@renderer/components/card-list.js';
import type { AgentSummary } from '@renderer/hooks/use-agent-queries.js';
import type { WorkbenchPageSnapshot } from './workbench-page-shared.js';

type WorkbenchPageAgentsPanelProps = {
  snapshot: WorkbenchPageSnapshot;
  masterAgents: AgentSummary[];
  onOpenAgentDraft: (draftAgentId: string) => void;
  onAttachMasterAgentClone: (input: {
    masterAgentId: string;
    displayName: string;
    handle: string;
    concept: string;
  }) => void;
};

export function WorkbenchPageAgentsPanel({
  snapshot,
  masterAgents,
  onOpenAgentDraft,
  onAttachMasterAgentClone,
}: WorkbenchPageAgentsPanelProps) {
  return (
    <section className="mx-auto max-w-6xl p-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Surface tone="card" padding="md">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">World-Owned Draft Agents</h2>
          <div className="mt-5 space-y-3">
            {Object.values(snapshot.agentDrafts).length === 0 ? (
              <ForgeEmptyState message="No world-owned draft agents yet." />
            ) : Object.values(snapshot.agentDrafts).map((agentDraft) => (
              <ForgeListCard
                key={agentDraft.draftAgentId}
                title={agentDraft.displayName}
                subtitle={`@${agentDraft.handle} · ${agentDraft.source} · ${agentDraft.status}`}
                actions={(
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => onOpenAgentDraft(agentDraft.draftAgentId)}
                  >
                    Open
                  </Button>
                )}
              />
            ))}
          </div>
        </Surface>

        <Surface tone="card" padding="md">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">Master Agent Library</h2>
          <div className="mt-5 space-y-3">
            {masterAgents.map((agent) => (
              <ForgeListCard
                key={agent.id}
                title={agent.displayName || agent.handle}
                subtitle={`@${agent.handle} · ${agent.concept || 'No concept'}`}
                actions={(
                  <Button
                    tone="primary"
                    size="sm"
                    onClick={() => onAttachMasterAgentClone({
                      masterAgentId: agent.id,
                      displayName: agent.displayName || agent.handle,
                      handle: agent.handle,
                      concept: agent.concept,
                    })}
                  >
                    Clone to World
                  </Button>
                )}
              />
            ))}
          </div>
        </Surface>
      </div>
    </section>
  );
}
