import { useState } from 'react';
import { SCENARIO } from '../scenario/scenario';
import { MODULES, MODULE_ORDER } from '../scenario/meta';
import { useSim } from '../engine/SimContext';
import { Pane } from './Pane';
import type { ModuleId } from '../scenario/types';
import moduleBannerUrl from '../assets/module-banner.png';
import skyNightUrl from '../assets/sky-night.png';

const PANE_IDS = ['identity', 'agent', 'modules', 'grants', 'worlds'] as const;
type PaneId = (typeof PANE_IDS)[number];

/** Per-world card backdrops: existing field imagery, re-cropped per world and
 * tinted by the world's hue on top. */
const WORLD_BACKDROPS: Record<string, { src: string; position: string }> = {
  starport: { src: skyNightUrl, position: 'center 30%' },
  'echo-vale': { src: moduleBannerUrl, position: 'center 42%' },
  atelier: { src: moduleBannerUrl, position: 'center 64%' },
};

/** The cradle — a constellation of draggable panes floating on the field. */
export function Cradle() {
  const { state, openApp, toggleGrant, runFlow, movePane } = useSim();
  const [zs, setZs] = useState<Record<string, number>>({});
  const [worldIdx, setWorldIdx] = useState(0);
  const footprints = state.footprints;
  const activeGrants = state.grants.filter((g) => g.status === 'active').length;
  const pos = state.cradlePos;

  const bringUp = (id: string) => {
    setZs((s) => ({ ...s, [id]: Math.max(0, ...Object.values(s)) + 1 }));
  };
  const zOf = (id: string, base: number) => zs[id] ?? base;
  const topZ = Math.max(0, ...Object.values(zs));

  const paneProps = (id: PaneId, baseZ: number, drift: number, enter: number) => ({
    id,
    x: pos[id].x,
    y: pos[id].y,
    w: pos[id].w,
    z: zOf(id, baseZ),
    top: zOf(id, baseZ) === topZ && topZ > 0,
    driftDelay: drift,
    enterDelay: enter,
    onFocus: bringUp,
    onDrag: movePane,
  });

  return (
    <div className="cradle-space">
      <Pane className="pane-bare" {...paneProps('identity', 1, 0, 0)}>
        <h1 className="cradle-hi">
          欢迎回来，<em>林澈</em>
        </h1>
        <div className="cradle-chips">
          <span className="chip" data-tone="primary">{MODULE_ORDER.length} 个领域</span>
          <span className="chip" data-tone="primary">{SCENARIO.worlds.length} 个世界</span>
          <span className="chip" data-tone="success">{activeGrants} 项授权生效</span>
        </div>
      </Pane>

      <Pane className="pane-bare pane-bare-agent" {...paneProps('agent', 2, 1.4, 0.1)}>
        <div className="cradle-agent-row">
          <span className="agent-sphere" data-status={state.agent.status} aria-hidden />
          <p className="cradle-quote">「上次我们在回声谷的『低语回廊』停下——第三段回声，只差最后一步。」</p>
        </div>
      </Pane>

      <Pane title="领域" sub="从基座进入" className="pane-modules" {...paneProps('modules', 3, 0.7, 0.2)}>
        <div className="cradle-modules-wrap">
          <img className="cradle-modules-background" src={moduleBannerUrl} alt="" aria-hidden />
          <div className="cradle-modules">
            {MODULE_ORDER.map((id: ModuleId) => {
              const m = MODULES[id];
              return (
                <button key={id} type="button" className="cradle-module-row" data-mod={id} onClick={() => openApp(id)}>
                  <span className="cradle-glyph" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="cradle-module-main">
                    <b>
                      {m.name} <em>{m.tag}</em>
                    </b>
                    <span>{m.desc}</span>
                  </span>
                  <span className="cradle-enter">进入 →</span>
                </button>
              );
            })}
          </div>
        </div>
      </Pane>

      <Pane title="授权" sub="可撤销" {...paneProps('grants', 4, 2.1, 0.3)}>
        <div className="cradle-grants">
          {state.grants.map((g) => (
            <div key={g.id} className="cradle-grant-row" data-revoked={g.status === 'revoked'}>
              <span className="grant-status-dot" data-active={g.status === 'active'} />
              <div className="cradle-grant-main">
                <b>{g.title}</b>
                <span>{g.scope}</span>
              </div>
              <button type="button" className="fld-btn small" onClick={() => toggleGrant(g.id)}>
                {g.status === 'active' ? '撤销' : '重新授权'}
              </button>
            </div>
          ))}
        </div>
      </Pane>

      <Pane title="世界" sub="生态地图" className="pane-worlds" {...paneProps('worlds', 5, 2.8, 0.4)}>
        {(() => {
          const worlds = SCENARIO.worlds;
          const w = worlds[worldIdx % worlds.length];
          const fp = footprints.find((f) => f.worldId === w.id);
          const backdrop = WORLD_BACKDROPS[w.id];
          const flip = (dir: 1 | -1) => setWorldIdx((i) => (i + dir + worlds.length) % worlds.length);
          return (
            <div className="cradle-world-stage" style={{ ['--world-hue' as string]: w.hue }}>
              <img
                key={w.id}
                className="cradle-world-backdrop"
                src={backdrop.src}
                style={{ objectPosition: backdrop.position }}
                alt=""
                aria-hidden
              />
              <div key={`${w.id}-body`} className="cradle-world-body">
                <div className="cradle-world-hero">
                  <b>
                    <span className="world-status-dot" aria-hidden />
                    {w.name} <em>{w.en}</em>
                  </b>
                  <span className="cradle-world-meta">
                    {w.kind} · {w.presence}
                    {fp ? ' · 足迹' : ''}
                  </span>
                </div>
                <div className="cradle-world-foot">
                  <span className="world-orb" aria-hidden />
                  <p>{w.blurb}</p>
                  <div className="cradle-world-actions">
                    <button
                      type="button"
                      className="fld-btn small"
                      onClick={() => {
                        openApp('desktop', `/explore/${w.id}`);
                        runFlow('handoff.zhiyu');
                      }}
                    >
                      带入织语
                    </button>
                    <button
                      type="button"
                      className="cradle-world-enter"
                      onClick={() => openApp('desktop', `/explore/${w.id}`)}
                    >
                      进入世界 →
                    </button>
                  </div>
                </div>
              </div>
              <button type="button" className="world-flip prev" aria-label="上一个世界" onClick={() => flip(-1)}>
                ‹
              </button>
              <button type="button" className="world-flip next" aria-label="下一个世界" onClick={() => flip(1)}>
                ›
              </button>
              <div className="cradle-world-dots" aria-hidden>
                {worlds.map((item, i) => (
                  <i key={item.id} data-active={i === worldIdx % worlds.length} />
                ))}
              </div>
            </div>
          );
        })()}
      </Pane>
    </div>
  );
}
