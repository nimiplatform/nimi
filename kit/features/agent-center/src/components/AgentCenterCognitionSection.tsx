import type { AgentCenterState } from '../types.js';

export interface AgentCenterCognitionSectionProps {
  readonly state: AgentCenterState;
}

export function AgentCenterCognitionSection({ state }: AgentCenterCognitionSectionProps) {
  const cognition = state.cognition;
  return (
    <section aria-labelledby="agent-center-cognition-title" style={{ display: 'grid', gap: 12 }}>
      <header>
        <h2 id="agent-center-cognition-title" style={{ margin: 0, fontSize: 18 }}>Cognition</h2>
        <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
          {cognition.statusText || cognition.executionState || 'Runtime state unavailable'}
        </p>
      </header>
      <dl style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(120px, auto) 1fr', margin: 0, fontSize: 13 }}>
        <dt style={{ color: '#687386' }}>Lifecycle</dt>
        <dd style={{ margin: 0 }}>{cognition.lifecycleStatus || 'unknown'}</dd>
        <dt style={{ color: '#687386' }}>Emotion</dt>
        <dd style={{ margin: 0 }}>{cognition.currentEmotion || 'unknown'}</dd>
        <dt style={{ color: '#687386' }}>Memory</dt>
        <dd style={{ margin: 0 }}>{cognition.memoryState}</dd>
      </dl>
      <div role="list" aria-label="Recent canonical memories" style={{ display: 'grid', gap: 8 }}>
        {cognition.recentCanonicalMemories.length > 0 ? cognition.recentCanonicalMemories.map((memory) => (
          <div key={memory.memoryId} role="listitem" style={{ border: '1px solid #d8dee8', borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{memory.summary}</div>
            <div style={{ color: '#687386', fontSize: 12, marginTop: 4 }}>
              {memory.canonicalClass || 'canonical'} - {memory.policyReason || 'runtime projection'}
            </div>
          </div>
        )) : (
          <p style={{ color: '#687386', fontSize: 13, margin: 0 }}>No recent canonical memories projected.</p>
        )}
      </div>
    </section>
  );
}
