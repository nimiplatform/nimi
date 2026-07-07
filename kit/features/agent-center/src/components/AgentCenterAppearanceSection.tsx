import type { AgentCenterState } from '../types.js';

export interface AgentCenterAppearanceSectionProps {
  readonly state: AgentCenterState;
}

export function AgentCenterAppearanceSection({ state }: AgentCenterAppearanceSectionProps) {
  const appearance = state.appearance;
  return (
    <section aria-labelledby="agent-center-appearance-title" style={{ display: 'grid', gap: 12 }}>
      <header>
        <h2 id="agent-center-appearance-title" style={{ margin: 0, fontSize: 18 }}>Appearance</h2>
        <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
          {appearance.status}
        </p>
      </header>
      <dl style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(120px, auto) 1fr', margin: 0, fontSize: 13 }}>
        <dt style={{ color: '#687386' }}>Backend</dt>
        <dd style={{ margin: 0 }}>{appearance.backendKind || 'not configured'}</dd>
        <dt style={{ color: '#687386' }}>Avatar</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{appearance.avatarAssetRef || 'not admitted'}</dd>
        <dt style={{ color: '#687386' }}>Background</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{appearance.backgroundRef || 'not admitted'}</dd>
        <dt style={{ color: '#687386' }}>Voice</dt>
        <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{appearance.defaultVoiceReference || 'Runtime projection missing'}</dd>
        <dt style={{ color: '#687386' }}>Autoplay</dt>
        <dd style={{ margin: 0 }}>{appearance.avatarAutoplay ? 'enabled' : 'disabled'}</dd>
      </dl>
      {appearance.disabledReason ? (
        <p style={{ color: '#8a5a00', fontSize: 13, margin: 0 }}>{appearance.disabledReason}</p>
      ) : null}
    </section>
  );
}
