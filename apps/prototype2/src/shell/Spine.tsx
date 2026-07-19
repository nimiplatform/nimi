import { fmtTime, useSim } from '../engine/SimContext';
import { MODULES, MODULE_ORDER } from '../scenario/meta';
import { useUi, PHASE_LABEL, autoPhase } from './UiContext';
import type { ModuleId } from '../scenario/types';

const AGENT_STATUS: Record<string, string> = {
  idle: '空闲',
  observing: '观察中',
  migrating: '迁移中',
  acting: '行动中',
};

function SpineGlyph({ id }: { id: ModuleId }) {
  return (
    <span className={`spine-glyph spine-glyph-${id}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

/** The spine — bottom floating dock. Home, modules, tools, agent status,
 * logical clock and the persistent simulation badge. */
export function Spine() {
  const { state, openApp, focusWindow, goHome, toggleLedger, resetSession } = useSim();
  const { setLensOpen, phase, effectivePhase, cyclePhase, toggleTide } = useUi();
  const { agent, opSeq, epoch } = state;
  const where = agent.location === 'cradle' ? '@基座' : `@${MODULES[agent.location].name}`;
  const phaseTitle =
    phase === 'auto'
      ? `自动 · Auto（当前 ${PHASE_LABEL[effectivePhase ?? autoPhase()]}）`
      : PHASE_LABEL[phase];

  return (
    <footer
      className="spine pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-chrome"
      data-nimi-tone="panel"
    >
      <button type="button" className="spine-btn" title="回到基座" onClick={goHome}>
        <span className="spine-home" />
      </button>
      <span className="spine-sep" />
      {MODULE_ORDER.map((id) => {
        const win = state.windows.find((w) => w.moduleId === id);
        return (
          <button
            key={id}
            type="button"
            className="spine-btn"
            data-open={Boolean(win && !win.minimized)}
            title={MODULES[id].name}
            onClick={() => (win ? focusWindow(win.instanceId) : openApp(id))}
          >
            <SpineGlyph id={id} />
          </button>
        );
      })}
      <span className="spine-sep" />
      <button type="button" className="spine-btn" title="交互账本" data-open={state.ledgerOpen} onClick={toggleLedger}>
        <span className="spine-glyph-lines" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </button>
      <button type="button" className="spine-btn" title="Lens (⌘K)" onClick={() => setLensOpen(true)}>
        <span className="spine-text-glyph">⌘</span>
      </button>
      <button type="button" className="spine-btn" title={`Tide 概览 (\`)`} onClick={toggleTide}>
        <span className="spine-text-glyph">~</span>
      </button>
      <button type="button" className="spine-btn" title={phaseTitle} onClick={cyclePhase}>
        <span className="spine-text-glyph">◐</span>
      </button>
      <button type="button" className="spine-btn" title="重置会话" onClick={resetSession}>
        <span className="spine-text-glyph">↻</span>
      </button>

      <span className="spine-sep" />
      <span className="spine-agent" data-agent-chip>
        <span className="agent-orb" data-status={agent.status} />
        <span className="spine-agent-label">
          Nimi · {AGENT_STATUS[agent.status]} {where}
        </span>
        {agent.carry ? (
          <span className="chip" data-tone="agent">
            携带 · {agent.carry}
          </span>
        ) : null}
      </span>

      <span className="spine-right">
        <span className="t-mono">
          {fmtTime(opSeq)} · epoch {epoch}
        </span>
        <span className="spine-sim" role="note">
          <span className="dot" />
          模拟演示
        </span>
      </span>
    </footer>
  );
}
