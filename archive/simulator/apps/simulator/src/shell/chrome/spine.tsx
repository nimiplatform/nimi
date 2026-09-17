import { useUi, SCENE_PHASE_LABEL, autoScenePhase } from './ui-context.tsx';
import { liveInstancesOf, useShellActions } from './shell-actions.tsx';
import { useProductPresentation } from './product-presentation.tsx';
import { AppLogo } from './app-logo.tsx';

const AGENT_STATUS: Record<string, string> = {
  idle: '空闲',
  observing: '观察中',
  migrating: '迁移中',
  acting: '行动中',
};

/** The spine — bottom floating dock. LocalAgent projection chip, App launchers,
 * atmosphere controls, and the interaction ledger toggle. */
export function Spine() {
  const { navigate, modules, instances, open } = useShellActions();
  const {
    phase,
    effectivePhase,
    cycleScenePhase,
    skyPanelOpen,
    setSkyPanelOpen,
    windows,
    focusWindow,
    restoreWindow,
    setHomeDepthWindow,
    showToast,
  } = useUi();
  const { agent, localAgentPresentation, ledgerOpen, toggleLedger } = useProductPresentation();
  const phaseTitle =
    phase === 'auto'
      ? `演进 · Auto（当前 ${SCENE_PHASE_LABEL[effectivePhase ?? autoScenePhase()]}）`
      : SCENE_PHASE_LABEL[phase];
  const where = agent.location === 'cradle' ? '@基座' : `@${agent.location}`;
  const agentTitle = `${localAgentPresentation.name} · ${AGENT_STATUS[agent.status] ?? agent.status} ${where}${agent.carry ? ` · 投影上下文 ${agent.carry}` : ''}`;

  return (
    <footer className="spine pane" data-nimi-material="glass-chrome" data-nimi-tone="panel">
      <button
        type="button"
        className="spine-btn"
        title={agentTitle}
        aria-label={agentTitle}
        data-agent-chip
        onClick={() => {
          setHomeDepthWindow('modules');
          navigate({ kind: 'home' });
        }}
      >
        <span className="agent-orb" data-status={agent.status} />
      </button>
      <span className="spine-sep" />
      {modules.map((module) => {
        const id = module.moduleId;
        const latest = liveInstancesOf(instances, id).at(-1) ?? null;
        const minimized = latest ? windows[latest.instanceId]?.minimized === true : false;
        const title = latest
          ? minimized
            ? `${id} · 已最小化 · 点击恢复`
            : `${id} · 运行中`
          : `打开 · ${id}`;

        return (
          <button
            key={id}
            type="button"
            className="spine-btn"
            data-mod={id}
            data-open={latest ? true : undefined}
            data-minimized={minimized || undefined}
            title={title}
            aria-label={title}
            onClick={() => {
              if (latest) {
                if (minimized) restoreWindow(latest.instanceId);
                focusWindow(latest.instanceId);
              } else if (module.surfaces[0]) {
                open(id, module.surfaces[0].id);
              } else {
                showToast({ title: id, detail: 'This module declares no surfaces.' });
              }
            }}
          >
            <AppLogo moduleId={id} size="rail" />
          </button>
        );
      })}
      <span className="spine-sep" />
      <button
        type="button"
        className="spine-btn"
        title={`切换月昼相位 · ${phaseTitle}`}
        aria-label={`切换月昼相位 · ${phaseTitle}`}
        onClick={cycleScenePhase}
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
            投影上下文 · {agent.carry}
          </span>
        </span>
      ) : null}
    </footer>
  );
}
