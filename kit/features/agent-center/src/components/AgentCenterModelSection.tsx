import type { AgentCenterState } from '../types.js';

export interface AgentCenterModelSectionProps {
  readonly state: AgentCenterState;
}

export function AgentCenterModelSection({ state }: AgentCenterModelSectionProps) {
  return (
    <section aria-labelledby="agent-center-model-title" style={{ display: 'grid', gap: 12 }}>
      <header>
        <h2 id="agent-center-model-title" style={{ margin: 0, fontSize: 18 }}>Model</h2>
        <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
          Revision {state.configRevision ?? 'unavailable'}
        </p>
      </header>
      <div role="list" style={{ display: 'grid', gap: 8 }}>
        {state.capabilities.map((capability) => (
          <div
            key={capability.capability}
            role="listitem"
            style={{
              border: '1px solid #d8dee8',
              borderRadius: 8,
              display: 'grid',
              gap: 8,
              padding: 12,
            }}
          >
            <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 14 }}>{capability.label}</strong>
              <span style={{ color: capability.readinessState === 'ready' ? '#146c43' : '#8a5a00', fontSize: 12 }}>
                {capability.readinessState}
              </span>
            </div>
            <div style={{ color: '#3f4550', fontSize: 13 }}>{capability.summary}</div>
            <dl style={{ display: 'grid', gap: 4, gridTemplateColumns: 'minmax(88px, auto) 1fr', margin: 0, fontSize: 12 }}>
              <dt style={{ color: '#687386' }}>Route</dt>
              <dd style={{ margin: 0 }}>{capability.binding?.route || 'Runtime projection missing'}</dd>
              <dt style={{ color: '#687386' }}>Model</dt>
              <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{capability.binding?.modelId || 'Not configured'}</dd>
              <dt style={{ color: '#687386' }}>Mode</dt>
              <dd style={{ margin: 0 }}>{capability.editable ? 'Editable' : 'Read-only projection'}</dd>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
