import { useSim } from '../engine/SimContext';
import { MODULES } from '../scenario/meta';
import { SCENARIO } from '../scenario/scenario';
import { useUi, PHASE_LABEL, autoPhase } from './UiContext';
import type { ModuleId } from '../scenario/types';

const AGENT_STATUS: Record<string, string> = {
  idle: '空闲',
  observing: '观察中',
  migrating: '迁移中',
  acting: '行动中',
};

const DOCK_APP_ID: ModuleId = 'zhiyu';

function SpineGlyph({ id }: { id: ModuleId }) {
  return (
    <span className={`spine-glyph spine-glyph-${id}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

interface SpineProps {
  onOpenSkyPanel: () => void;
  skyPanelOpen: boolean;
}

/** The spine — bottom floating dock. Agent, apps, world, background controls,
 * interaction ledger, carry state, and the persistent simulation badge. */
export function Spine({ onOpenSkyPanel, skyPanelOpen }: SpineProps) {
  const { state, openApp, focusWindow, goHome, toggleLedger } = useSim();
  const { phase, effectivePhase, cyclePhase } = useUi();
  const { agent } = state;
  const where = agent.location === 'cradle' ? '@基座' : `@${MODULES[agent.location].name}`;
  const phaseTitle =
    phase === 'auto'
      ? `自动 · Auto（当前 ${PHASE_LABEL[effectivePhase ?? autoPhase()]}）`
      : PHASE_LABEL[phase];
  const desktopWin = state.windows.find((w) => w.moduleId === 'desktop');
  const dockAppWin = state.windows.find((w) => w.moduleId === DOCK_APP_ID);
  const hasBuoys = state.windows.some((w) => w.minimized);
  const dockApp = MODULES[DOCK_APP_ID];
  const dockWorld = SCENARIO.worlds.find((world) => world.id === 'echo-vale')!;

  return (
    <footer
      className="spine pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-chrome"
      data-nimi-tone="panel"
      data-has-buoys={hasBuoys || undefined}
    >
      <button
        type="button"
        className="spine-btn"
        title={`Nimi · ${AGENT_STATUS[agent.status]} ${where}${agent.carry ? ` · 携带 ${agent.carry}` : ''}`}
        aria-label={`Nimi · ${AGENT_STATUS[agent.status]} ${where}${agent.carry ? ` · 携带 ${agent.carry}` : ''}`}
        data-agent-chip
        onClick={goHome}
      >
        <span className="agent-orb" data-status={agent.status} />
      </button>
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        data-open={Boolean(desktopWin && !desktopWin.minimized)}
        title="Desktop · 宿主桌面"
        onClick={() => (desktopWin ? focusWindow(desktopWin.instanceId) : openApp('desktop'))}
      >
        <SpineGlyph id="desktop" />
      </button>
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        data-open={Boolean(dockAppWin && !dockAppWin.minimized)}
        title={`应用 · ${dockApp.name}`}
        onClick={() => (dockAppWin ? focusWindow(dockAppWin.instanceId) : openApp(DOCK_APP_ID))}
      >
        <SpineGlyph id={DOCK_APP_ID} />
      </button>
      <button
        type="button"
        className="spine-btn"
        title={`世界 · ${dockWorld.name} · ${dockWorld.en}`}
        onClick={() => openApp('desktop', `/explore/${dockWorld.id}`)}
      >
        <span className="spine-world" style={{ ['--world-hue' as string]: dockWorld.hue }} />
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
        onClick={onOpenSkyPanel}
      >
        <span className="spine-text-glyph" aria-hidden>☼</span>
      </button>
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        data-open={state.ledgerOpen}
        title={state.ledgerOpen ? '收起交互账本' : '打开交互账本'}
        aria-label={state.ledgerOpen ? '收起交互账本' : '打开交互账本'}
        aria-expanded={state.ledgerOpen}
        aria-controls="interaction-ledger-drawer"
        onClick={toggleLedger}
      >
        <span className="spine-glyph-lines" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </button>

      <span className="spine-right">
        {agent.carry ? (
          <span className="chip" data-tone="agent">
            携带 · {agent.carry}
          </span>
        ) : null}
        <span className="spine-sim" role="note">
          <span className="dot" />
          模拟演示
        </span>
      </span>
    </footer>
  );
}
