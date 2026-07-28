import { useState } from 'react';
import { Pane } from './pane.tsx';
import { useUi } from './ui-context.tsx';
import { useShellActions } from './shell-actions.tsx';
import { useProductPresentation } from './product-presentation.tsx';
import { AgentHud } from './agent-hud.tsx';
import { AppLogo } from './app-logo.tsx';
import {
  TiledWorkspace,
  type DepthWindowDefinition,
} from './depth-workspace.tsx';

const moduleBackgroundUrl = new URL('../../assets/module-background.png', import.meta.url).href;
const lunarScenePreviewUrl = new URL(
  '../../assets/sky-night.png',
  import.meta.url,
).href;

const PANE_IDS = ['identity', 'agent'] as const;
type PaneId = (typeof PANE_IDS)[number];

/**
 * The cradle — a constellation of draggable panes floating on the field.
 * Hosts the pinned home-route contract structures (modules summary, Open
 * buttons) plus the presentation-layer agent HUD. Identity/world panes are
 * static presentation; authorization receipts live in the Shell-owned dock.
 */
export function Cradle() {
  const {
    modules,
    open,
    moduleCount,
  } = useShellActions();
  const {
    persona,
  } = useProductPresentation();
  const {
    panePos,
    paneZs,
    paneZCounter,
    homeDepthWindow,
    movePane,
    focusPane,
    setAppsPageOpen,
    setHomeDepthWindow,
  } = useUi();
  const [agentOpen, setAgentOpen] = useState(false);

  const topZ = Math.max(PANE_IDS.length, paneZCounter, ...Object.values(paneZs));

  const paneProps = (id: PaneId, baseZ: number, drift: number, enter: number, elevated = false) => {
    const z = elevated ? topZ + 1 : (paneZs[id] ?? baseZ);
    return {
      id,
      x: panePos[id].x,
      y: panePos[id].y,
      w: panePos[id].w,
      h: panePos[id].h,
      z,
      top: elevated || z === topZ,
      driftDelay: drift,
      enterDelay: enter,
      onFocus: focusPane,
      onDrag: movePane,
    };
  };

  const depthWindows: readonly DepthWindowDefinition[] = [
    {
      id: 'modules',
      title: '应用',
      className: 'depth-window--modules',
      actions: (
        <button
          type="button"
          className="pane-action-enter"
          title="打开全部应用"
          aria-label="打开全部应用"
          onClick={() => setAppsPageOpen(true)}
        >
          全部 <span aria-hidden>⤢</span>
        </button>
      ),
      content: (
        <>
          <img className="cradle-modules-background" src={moduleBackgroundUrl} alt="" aria-hidden="true" />
          <div className="cradle-modules-wrap">
            <div className="cradle-modules">
              <p className="simulator-home__summary">
                {`${moduleCount} selected module${moduleCount === 1 ? '' : 's'}`}
              </p>
              <section className="simulator-modules" aria-label="Selected modules">
                {modules.flatMap((module) => module.surfaces.map((surface) => (
                  <button
                    key={`${module.moduleId}/${surface.id}`}
                    type="button"
                    className="cradle-module-row"
                    data-mod={module.moduleId}
                    data-module-id={module.moduleId}
                    data-surface-id={surface.id}
                    aria-label={`Open ${surface.label}`}
                    onClick={() => open(module.moduleId, surface.id)}
                  >
                    <AppLogo moduleId={module.moduleId} size="home" />
                    <span className="cradle-module-main">
                      <b>{surface.label}</b>
                    </span>
                    <span className="cradle-enter" aria-hidden>进入 →</span>
                  </button>
                )))}
              </section>
            </div>
          </div>
        </>
      ),
    },
    {
      id: 'worlds',
      title: '世界',
      className: 'depth-window--worlds',
      hideHeader: true,
      content: (
        <div className="cradle-world-stage" style={{ ['--world-hue' as string]: '#45b8d6' }}>
          <img
            className="cradle-world-backdrop"
            src={lunarScenePreviewUrl}
            style={{ objectPosition: 'center 30%' }}
            alt=""
            aria-hidden="true"
          />
          <div className="cradle-world-body">
            <div className="cradle-world-hero">
              <b>
                <span className="world-status-dot" aria-hidden />
                星港
              </b>
              <span className="cradle-world-meta">12 位居民在场 · 足迹</span>
            </div>
            <div className="cradle-world-foot">
              <span className="world-orb" aria-hidden />
              <p>生态居民的公共停泊港。大厅、集市与临时聚会的默认集合点。</p>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <main className="simulator-home cradle-space">
      <Pane className="pane-bare" {...paneProps('identity', 1, 0, 0)}>
        <h1 className={`cradle-identity${persona ? '' : ' cradle-identity--placeholder'}`}>
          <span className="cradle-identity__welcome">欢迎回来</span>
          <span className="cradle-identity__main">
            <span className="cradle-identity__sigil" aria-hidden="true" />
            <span className="cradle-identity__name">
              {persona ? persona.name : 'Simulator User'}
            </span>
            <span className="cradle-identity__status" aria-hidden="true" />
            <span className="cradle-identity__line" aria-hidden="true" />
          </span>
        </h1>
      </Pane>

      <Pane className="pane-bare" {...paneProps('agent', 2, 1.4, 0.1, agentOpen)}>
        <AgentHud onOpenChange={setAgentOpen} />
      </Pane>

      <TiledWorkspace
        windows={depthWindows}
        activeId={homeDepthWindow}
        onActiveChange={setHomeDepthWindow}
      />
    </main>
  );
}
