import type { AgentCenterState } from '../types.js';

export interface AgentCenterBehaviorSectionProps {
  readonly state: AgentCenterState;
}

export function AgentCenterBehaviorSection({ state }: AgentCenterBehaviorSectionProps) {
  const autonomy = state.autonomy;
  return (
    <section aria-labelledby="agent-center-behavior-title" style={{ display: 'grid', gap: 12 }}>
      <header>
        <h2 id="agent-center-behavior-title" style={{ margin: 0, fontSize: 18 }}>Behavior</h2>
        <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
          Autonomy {autonomy.enabled === true ? 'enabled' : autonomy.enabled === false ? 'disabled' : 'unavailable'}
        </p>
      </header>
      <div style={{ border: '1px solid #d8dee8', borderRadius: 8, display: 'grid', gap: 10, padding: 12 }}>
        <label style={{ alignItems: 'center', display: 'flex', gap: 10 }}>
          <input
            aria-label="Autonomy enabled"
            checked={autonomy.enabled === true}
            disabled={autonomy.controlsDisabled}
            readOnly
            type="checkbox"
          />
          <span>Autonomy mode {autonomy.mode || 'unknown'}</span>
        </label>
        <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', fontSize: 13 }}>
          <span>Daily budget: {autonomy.dailyTokenBudget ?? 'not projected'}</span>
          <span>Per hook: {autonomy.maxTokensPerHook ?? 'not projected'}</span>
          <span>Budget: {autonomy.budgetExhausted ? 'exhausted' : 'available'}</span>
        </div>
        {autonomy.controlsDisabled ? (
          <p style={{ color: '#8a5a00', fontSize: 13, margin: 0 }}>{autonomy.disabledReason}</p>
        ) : null}
      </div>
    </section>
  );
}
