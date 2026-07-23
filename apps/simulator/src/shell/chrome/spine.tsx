import { useUi, PHASE_LABEL, autoPhase } from './ui-context.tsx';
import { useShellActions } from './shell-actions.tsx';
import { useProductPresentation } from './product-presentation.tsx';

const AGENT_STATUS: Record<string, string> = {
  idle: '空闲',
  observing: '观察中',
  migrating: '迁移中',
  acting: '行动中',
};

/** The spine — bottom floating dock. Base-agent chip, a simulated world
 * marker, atmosphere controls, and the interaction ledger toggle. */
export function Spine() {
  const { navigate } = useShellActions();
  const { phase, effectivePhase, cyclePhase, skyPanelOpen, setSkyPanelOpen, showToast } = useUi();
  const { agent, agentPersona, ledgerOpen, toggleLedger } = useProductPresentation();
  const phaseTitle =
    phase === 'auto'
      ? `自动 · Auto（当前 ${PHASE_LABEL[effectivePhase ?? autoPhase()]}）`
      : PHASE_LABEL[phase];
  const where = agent.location === 'cradle' ? '@基座' : `@${agent.location}`;
  const agentTitle = `${agentPersona.name} · ${AGENT_STATUS[agent.status] ?? agent.status} ${where}${agent.carry ? ` · 携带 ${agent.carry}` : ''}`;

  return (
    <footer className="spine pane" data-nimi-material="glass-chrome" data-nimi-tone="panel">
      <button
        type="button"
        className="spine-btn"
        title={agentTitle}
        aria-label={agentTitle}
        data-agent-chip
        onClick={() => navigate({ kind: 'home' })}
      >
        <span className="agent-orb" data-status={agent.status} />
      </button>
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        title="世界 · 星港 Starport · simulated"
        aria-label="世界 · 星港 Starport · simulated"
        onClick={() => showToast({
          title: '星港 · Starport',
          detail: 'Simulated world marker — no live world runtime in the Simulator.',
        })}
      >
        <span className="spine-world" style={{ ['--world-hue' as string]: '#45b8d6' }} />
      </button>
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        title={`换背景 · ${phaseTitle}`}
        aria-label={`换背景 · ${phaseTitle}`}
        onClick={cyclePhase}
      >
        <span className="spine-text-glyph" aria-hidden>◐</span>
      </button>
      <button
        type="button"
        className="spine-btn"
        title="光影与时间"
        aria-label="光影与时间"
        aria-expanded={skyPanelOpen}
        aria-controls="sky-control-panel"
        data-open={skyPanelOpen}
        onClick={() => setSkyPanelOpen(!skyPanelOpen)}
      >
        <span className="spine-text-glyph" aria-hidden>☼</span>
      </button>
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        data-open={ledgerOpen}
        title={ledgerOpen ? '收起交互账本' : '打开交互账本'}
        aria-label={ledgerOpen ? '收起交互账本' : '打开交互账本'}
        aria-expanded={ledgerOpen}
        aria-controls="interaction-ledger-drawer"
        onClick={toggleLedger}
      >
        <span className="spine-glyph-lines" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </button>

      {agent.carry ? (
        <span className="spine-right">
          <span className="chip" data-tone="agent">
            携带 · {agent.carry}
          </span>
        </span>
      ) : null}
    </footer>
  );
}
