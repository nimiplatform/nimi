import type { AgentCenterState } from '../types.js';
import {
  Card,
  Kv,
  KvGrid,
  Notice,
  SectionHeader,
  SectionShell,
  StateRow,
  StatusPill,
} from './AgentCenterPrimitives.js';

export interface AgentCenterCognitionSectionProps {
  readonly state: AgentCenterState;
}

export function AgentCenterCognitionSection({ state }: AgentCenterCognitionSectionProps) {
  const cognition = state.cognition;
  return (
    <SectionShell labelledBy="agent-center-cognition-title">
      <SectionHeader
        description={cognition.statusText || cognition.executionState || 'Runtime state unavailable'}
        id="agent-center-cognition-title"
        right={<StatusPill label={cognition.memoryState} tone={cognition.memoryState === 'unavailable' ? 'muted' : 'ready'} />}
        title="Cognition"
      />
      <Card>
        <StateRow label="Lifecycle" value={cognition.lifecycleStatus || 'unknown'} />
        <StateRow label="Emotion" value={cognition.currentEmotion || 'unknown'} />
        <StateRow label="Memory" value={cognition.memoryState} />
      </Card>
      <Card>
        <KvGrid>
          <Kv label="Execution" value={cognition.executionState || 'unknown'} muted={!cognition.executionState} />
          <Kv label="Status" value={cognition.statusText || 'not projected'} muted={!cognition.statusText} />
        </KvGrid>
      </Card>
      <div className="grid min-w-0 gap-2" role="list" aria-label="Recent canonical memories">
        {cognition.recentCanonicalMemories.length > 0 ? cognition.recentCanonicalMemories.map((memory) => (
          <Card className="p-3.5" key={memory.memoryId}>
            <div className="min-w-0 text-[13px] leading-[1.5] text-slate-950" role="listitem">{memory.summary}</div>
            <div className="mt-1.5 text-[12px] leading-[1.45] text-slate-500">
              {memory.canonicalClass || 'canonical'} · {memory.policyReason || 'runtime projection'}
            </div>
          </Card>
        )) : (
          <Notice>No recent canonical memories projected.</Notice>
        )}
      </div>
    </SectionShell>
  );
}
