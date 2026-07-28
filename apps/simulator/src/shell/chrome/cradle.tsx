import { useState } from 'react';
import { Pane } from './pane.tsx';
import { useUi } from './ui-context.tsx';
import { useShellActions } from './shell-actions.tsx';
import { useProductPresentation } from './product-presentation.tsx';
import { AgentHud } from './agent-hud.tsx';
import { GRANT_PARTY_TONES } from './grant-receipt.tsx';

const PANE_IDS = ['identity', 'agent', 'modules', 'instances', 'grants', 'worlds'] as const;
type PaneId = (typeof PANE_IDS)[number];

/**
 * The cradle — a constellation of draggable panes floating on the field.
 * Hosts the pinned home-route contract structures (modules summary, Open
 * buttons, Reset scenario, `.simulator-windows__item` list) plus the
 * presentation-layer agent HUD and grants panes. Identity/world panes are
 * static presentation; grants/agent/ledger state is seeded simulation.
 */
export function Cradle() {
  const {
    modules,
    instances,
    phase,
    open,
    close,
    activate,
    deactivate,
    navigate,
    reset,
    moduleCount,
  } = useShellActions();
  const { persona, grants, toggleGrant, runFlow } = useProductPresentation();
  const { panePos, paneZs, paneZCounter, movePane, focusPane, setAppsPageOpen, setReceiptGrantId } = useUi();
  const [agentOpen, setAgentOpen] = useState(false);

  const visibleGrants = grants.filter((g) => g.id !== 'g-local-agent-context-projection');
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

  return (
    <main className="simulator-home cradle-space">
      <Pane className="pane-bare" {...paneProps('identity', 1, 0, 0)}>
        <h1 className={`cradle-hi${persona ? '' : ' cradle-hi--placeholder'}`}>
          欢迎回来，<em>{persona ? persona.name : 'Simulator User'}</em>
        </h1>
        <p className="cradle-dim">
          {persona
            ? `${persona.id} · 模拟居民身份投影 — no real identity, data, or effects.`
            : 'Simulated persona pending — Desktop 完成模拟登录后共享身份。'}
        </p>
      </Pane>

      <Pane className="pane-bare" {...paneProps('agent', 2, 1.4, 0.1, agentOpen)}>
        <AgentHud onOpenChange={setAgentOpen} />
      </Pane>

      <Pane
        title="领域"
        className="pane-modules pane-clip"
        actions={
          <button
            type="button"
            className="pane-action-enter"
            title="打开全部应用"
            aria-label="打开全部应用"
            onClick={() => setAppsPageOpen(true)}
          >
            从基座进入 <span aria-hidden>⤢</span>
          </button>
        }
        {...paneProps('modules', 3, 0.7, 0.2)}
      >
        <div className="cradle-modules-background" aria-hidden />
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
                  <span className="cradle-glyph" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="cradle-module-main">
                    <b>
                      {surface.label} <em>{module.moduleId}</em>
                    </b>
                    <span>{module.moduleId} · {surface.id}</span>
                  </span>
                  <span className="cradle-enter" aria-hidden>进入 →</span>
                </button>
              )))}
              <button
                type="button"
                className="fld-btn small"
                onClick={reset}
                disabled={phase !== 'open'}
                data-simulator-action="reset"
              >
                Reset scenario
              </button>
            </section>
          </div>
        </div>
      </Pane>

      <Pane title="实例" sub="app instances" className="pane-clip" {...paneProps('instances', 4, 2.1, 0.3)}>
        {instances.length === 0 ? (
          <p className="simulator-home__empty">No App instances are open.</p>
        ) : (
          <ul className="simulator-windows" aria-label="Open instances">
            {instances.map((instance) => (
              <li
                key={instance.instanceId}
                className="simulator-windows__item"
                data-instance-status={instance.status}
                data-readiness-status={instance.readiness}
                data-instance-id={instance.instanceId}
                data-module-id={instance.moduleId}
                data-surface-id={instance.surfaceId}
              >
                <span>{`${instance.moduleId} — ${instance.status} — ${instance.readiness}`}</span>
                {instance.status === 'active' ? (
                  <button type="button" onClick={() => deactivate(instance.instanceId)}>Deactivate</button>
                ) : instance.status === 'inactive' ? (
                  <button type="button" onClick={() => activate(instance.instanceId)}>Activate</button>
                ) : null}
                {instance.status === 'active' || instance.status === 'inactive' ? (
                  <button
                    type="button"
                    onClick={() => navigate({
                      kind: 'instance',
                      instanceId: instance.instanceId,
                      appRoute: instance.route,
                    })}
                  >
                    Full window
                  </button>
                ) : null}
                {instance.status !== 'disposed' ? (
                  <button type="button" onClick={() => close(instance.instanceId)}>Close</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Pane>

      <Pane
        title="授权动态"
        className="pane-clip"
        actions={
          <button
            type="button"
            className="pane-action-enter"
            title="记录一条生态足迹（演示流）"
            aria-label="记录一条生态足迹（演示流）"
            onClick={() => runFlow('world.pin')}
          >
            记录足迹 <span aria-hidden>⤢</span>
          </button>
        }
        {...paneProps('grants', 5, 2.8, 0.4)}
      >
        <div className="cradle-grants">
          {visibleGrants.map((g) => (
            <div
              key={g.id}
              className="cradle-grant-card"
              data-revoked={g.status === 'revoked'}
            >
              <button
                type="button"
                className="cradle-grant-open"
                aria-label={`查看授权回单：${g.title}`}
                onClick={() => setReceiptGrantId(g.id)}
              >
                <span className="cradle-grant-head">
                  <span className="grant-party" data-tone={GRANT_PARTY_TONES[g.from] ?? 'eco'}>
                    <span className="grant-party-icon" aria-hidden />
                    <span className="grant-party-main">
                      <b>{g.from}</b>
                      <em>发起方</em>
                    </span>
                  </span>
                  <span className="grant-arrow" aria-hidden>
                    →
                  </span>
                  <span className="grant-party" data-tone={GRANT_PARTY_TONES[g.to] ?? 'eco'}>
                    <span className="grant-party-icon" aria-hidden />
                    <span className="grant-party-main">
                      <b>{g.to}</b>
                      <em>接收方</em>
                    </span>
                  </span>
                </span>
                <b className="cradle-grant-title">{g.title}</b>
                <span className="cradle-grant-tags">
                  {g.tags.map((t) => (
                    <span key={t} className="grant-tag">
                      {t}
                    </span>
                  ))}
                </span>
              </button>
              <span className="grant-status">
                <button
                  type="button"
                  className="grant-status-badge"
                  data-active={g.status === 'active'}
                  title={g.status === 'active' ? '点击撤销' : '点击重新授权'}
                  onClick={() => toggleGrant(g.id)}
                >
                  {g.status === 'active' ? '生效中' : '已撤销'}
                </button>
                <span className="grant-status-meta">
                  {g.status === 'active' ? g.meta : '点击徽标重新授权'}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Pane>

      <Pane
        title="世界"
        sub="simulated"
        className="pane-clip"
        actions={
          <button
            type="button"
            className="pane-action-enter"
            title="把世界带入织语（演示交接流）"
            aria-label="把世界带入织语（演示交接流）"
            onClick={() => runFlow('handoff.zhiyu')}
          >
            带入织语 <span aria-hidden>⤢</span>
          </button>
        }
        {...paneProps('worlds', 6, 3.5, 0.5)}
      >
        <div className="cradle-world-stage" style={{ ['--world-hue' as string]: '#45b8d6', height: 24 }}>
          <div className="cradle-world-backdrop" aria-hidden />
          <div className="cradle-world-body" style={{ padding: '2px 12px' }}>
            <div className="cradle-world-hero">
              <b style={{ fontSize: '0.95rem' }}>
                <span className="world-status-dot" aria-hidden />
                星港 <em>Starport · presentation only</em>
              </b>
            </div>
          </div>
        </div>
      </Pane>
    </main>
  );
}
