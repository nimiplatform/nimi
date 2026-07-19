import { useRef, useState } from 'react';
import { SCENARIO } from '../scenario/scenario';
import { MODULES, MODULE_ORDER } from '../scenario/meta';
import { useSim } from '../engine/SimContext';
import { edgeDir, groupOf, guideFor, type Rect } from './weave';
import { Pane } from './Pane';
import { SnapGuide } from './SnapGuide';
import type { ModuleId } from '../scenario/types';

const PANE_IDS = ['identity', 'agent', 'modules', 'grants', 'worlds'] as const;
type PaneId = (typeof PANE_IDS)[number];

/** The cradle — a constellation of weavable panes floating on the field. */
export function Cradle() {
  const { state, openApp, toggleGrant, runFlow, movePane, weaveEval, weaveUnlink } = useSim();
  const [zs, setZs] = useState<Record<string, number>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [guide, setGuide] = useState<Rect | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const footprints = state.footprints;
  const activeGrants = state.grants.filter((g) => g.status === 'active').length;
  const pos = state.cradlePos;
  const groups = state.weaveGroups;

  const setRef = (id: string, el: HTMLElement | null) => {
    if (el) refs.current.set(id, el);
    else refs.current.delete(id);
  };

  const rectsOf = (): Record<string, Rect> => {
    const out: Record<string, Rect> = {};
    for (const id of PANE_IDS) {
      const el = refs.current.get(id);
      if (el) {
        const r = el.getBoundingClientRect();
        out[id] = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    }
    return out;
  };

  const bringUp = (id: string) => {
    const members = groupOf(groups, id) ?? [id];
    setZs((s) => {
      const base = Math.max(0, ...Object.values(s));
      const next = { ...s };
      members.forEach((m, i) => {
        next[m] = base + i + 1;
      });
      return next;
    });
  };
  const zOf = (id: string, base: number) => zs[id] ?? base;
  const topZ = Math.max(0, ...Object.values(zs));

  const onDrag = (id: string, x: number, y: number) => {
    movePane(id, x, y);
    const mine = refs.current.get(id);
    if (mine) {
      const r = mine.getBoundingClientRect();
      const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      let found: { id: string; dir: NonNullable<ReturnType<typeof edgeDir>>; rect: Rect } | null = null;
      for (const other of PANE_IDS) {
        if (other === id) continue;
        const el = refs.current.get(other);
        if (!el) continue;
        const o = el.getBoundingClientRect();
        const oRect = { x: o.left, y: o.top, w: o.width, h: o.height };
        const dir = edgeDir(rect, oRect);
        if (dir) {
          found = { id: other, dir, rect: oRect };
          break;
        }
      }
      setHint(found?.id ?? null);
      setGuide(found ? guideFor(found.dir, found.rect) : null);
    }
  };

  const onDragEnd = (id: string, pos: { x: number; y: number }) => {
    // the pointer-derived final position is authoritative: continuous-event
    // batching can leave the last state render pending at pointerup time
    const rects = rectsOf();
    const el = refs.current.get(id);
    const measured = el ? el.getBoundingClientRect() : null;
    rects[id] = {
      x: pos.x,
      y: pos.y,
      w: state.cradlePos[id]?.w ?? measured?.width ?? 400,
      h: measured?.height ?? 200,
    };
    weaveEval(id, rects);
    setHint(null);
    setGuide(null);
  };

  const paneProps = (id: PaneId, baseZ: number, drift: number, enter: number) => ({
    id,
    x: pos[id].x,
    y: pos[id].y,
    w: pos[id].w,
    z: zOf(id, baseZ),
    top: zOf(id, baseZ) === topZ && topZ > 0,
    woven: Boolean(groupOf(groups, id)),
    weaveHint: hint === id,
    driftDelay: drift,
    enterDelay: enter,
    paneRef: setRef,
    onFocus: bringUp,
    onDrag,
    onDragEnd,
    onUnlink: weaveUnlink,
  });

  return (
    <div className="cradle-space">
      <SnapGuide rect={guide} />
      <Pane title="基座 · cradle" sub="身份与智能体的家" {...paneProps('identity', 1, 0, 0)}>
        <h1 className="cradle-hi">
          欢迎回来，<em>林澈</em>
        </h1>
        <p className="cradle-sub">这是你和你的智能体的基座。领域（应用）只是你们在不同世界的衍生模块。</p>
        <div className="cradle-chips">
          <span className="chip" data-tone="primary">{MODULE_ORDER.length} 个领域</span>
          <span className="chip" data-tone="primary">{SCENARIO.worlds.length} 个世界</span>
          <span className="chip" data-tone="success">{activeGrants} 项授权生效</span>
        </div>
        <p className="cradle-dim">本页一切身份、数据与交互均为模拟演示。拖动 pane 相互靠近可以编织成组。</p>
      </Pane>

      <Pane title="基座 agent · Nimi" sub="连续 context" agent {...paneProps('agent', 2, 1.4, 0.1)}>
        <div className="cradle-agent-row">
          <span className="agent-sphere" data-status={state.agent.status} aria-hidden />
          <p className="cradle-quote">「上次我们在回声谷的『低语回廊』停下——第三段回声，只差最后一步。」</p>
        </div>
        <p className="cradle-dim">它记得你，是因为本演示预置了历史；不连接任何真实 runtime。</p>
      </Pane>

      <Pane title="领域 · modules" sub="从基座进入" {...paneProps('modules', 3, 0.7, 0.2)}>
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
      </Pane>

      <Pane title="授权 · grants" sub="可撤销" {...paneProps('grants', 4, 2.1, 0.3)}>
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

      <Pane title="世界 · worlds" sub="生态地图" {...paneProps('worlds', 5, 2.8, 0.4)}>
        <div className="cradle-worlds">
          {SCENARIO.worlds.map((w) => {
            const fp = footprints.find((f) => f.worldId === w.id);
            return (
              <div key={w.id} className="cradle-world" style={{ ['--world-hue' as string]: w.hue }}>
                <span className="world-pin" />
                <div className="cradle-world-main">
                  <b>
                    {w.name} <em>{w.en}</em>
                  </b>
                  <span className="t-caption">
                    {w.kind} · {w.presence}
                    {fp ? ' · 足迹' : ''}
                  </span>
                </div>
                <div className="cradle-world-actions">
                  <button type="button" className="fld-btn small" onClick={() => openApp('desktop', `/explore/${w.id}`)}>
                    探索
                  </button>
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
                </div>
              </div>
            );
          })}
        </div>
      </Pane>
    </div>
  );
}
