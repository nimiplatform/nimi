import { useState } from 'react';
import { IconButton } from '@nimiplatform/kit/ui';
import { BarChart3, PanelRightOpen, RotateCcw, Settings } from 'lucide-react';
import { SCENARIO } from '../scenario/scenario';
import { MODULES, MODULE_ORDER } from '../scenario/meta';
import { useSim } from '../engine/SimContext';
import { Pane } from './Pane';
import { GRANT_PARTY_TONES, GrantReceiptDialog } from './GrantReceipt';
import type { ModuleId } from '../scenario/types';
import moduleBackgroundUrl from '../assets/module-background.png';
import moduleBannerUrl from '../assets/module-banner.png';
import skyNightUrl from '../assets/sky-night.png';

const PANE_IDS = ['identity', 'agent', 'modules', 'grants', 'worlds'] as const;
type PaneId = (typeof PANE_IDS)[number];

const AGENT_STATUS: Record<string, string> = {
  idle: '待命中',
  observing: '主动运行中',
  migrating: '迁移中',
  acting: '行动中',
};

/** Mock content for the agent HUD panel (top-right presence chip). */
const AGENT_FEELING = '平静 · 专注';
const AGENT_FEED = [
  { text: '整理了 2 条生态足迹', done: true, at: null },
  { text: '在星港停留 23 分钟', done: false, at: null },
  { text: '为你恢复上次对话上下文', done: false, at: '14:27' },
];
const AGENT_LAST_CHAT = { text: '回声谷 · 低语回廊，停在第三段回声', at: '昨天 22:41' };
const AGENT_RECENT = '你在优化世界入口与 LocalAgent 投影方式';

/** Per-world card backdrops: existing field imagery, re-cropped per world and
 * tinted by the world's hue on top. */
const WORLD_BACKDROPS: Record<string, { src: string; position: string }> = {
  starport: { src: skyNightUrl, position: 'center 30%' },
  'echo-vale': { src: moduleBannerUrl, position: 'center 42%' },
  atelier: { src: moduleBannerUrl, position: 'center 64%' },
};

/** The cradle — a constellation of draggable panes floating on the field. */
export function Cradle({
  onOpenApps,
  onOpenGrantLedger,
}: {
  onOpenApps: () => void;
  onOpenGrantLedger: () => void;
}) {
  const { state, openApp, toggleGrant, toggleLedger, runFlow, movePane } = useSim();
  const [zs, setZs] = useState<Record<string, number>>({});
  const [worldIdx, setWorldIdx] = useState(0);
  const [receiptGrantId, setReceiptGrantId] = useState<string | null>(null);
  const [agentHover, setAgentHover] = useState(false);
  const [agentPinned, setAgentPinned] = useState(false);
  const agentOpen = agentHover || agentPinned;
  const footprints = state.footprints;
  const visibleGrants = state.grants.filter((g) => g.id !== 'g-local-agent-context-projection');
  const pos = state.cradlePos;

  const paneTopZ = Math.max(PANE_IDS.length, ...Object.values(zs));
  const bringUp = (id: string) => {
    setZs((s) => ({ ...s, [id]: Math.max(PANE_IDS.length, ...Object.values(s)) + 1 }));
  };
  const zOf = (id: string, base: number) => zs[id] ?? base;

  const paneProps = (id: PaneId, baseZ: number, drift: number, enter: number, elevated = false) => {
    const z = elevated ? Math.max(state.zTop, paneTopZ) + 1 : zOf(id, baseZ);
    return {
      id,
      x: pos[id].x,
      y: pos[id].y,
      w: pos[id].w,
      z,
      top: elevated || z === paneTopZ,
      driftDelay: drift,
      enterDelay: enter,
      onFocus: bringUp,
      onDrag: movePane,
    };
  };

  return (
    <div className="cradle-space">
      <Pane className="pane-bare" {...paneProps('identity', 1, 0, 0)}>
        <h1 className="cradle-hi">
          欢迎回来，<em>林澈</em>
        </h1>
      </Pane>

      <Pane className="pane-bare" {...paneProps('agent', 2, 1.4, 0.1, agentOpen)}>
        <div
          className="agent-hud"
          data-open={agentOpen || undefined}
          onMouseEnter={() => setAgentHover(true)}
          onMouseLeave={() => setAgentHover(false)}
        >
          <button
            type="button"
            className="agent-hud-chip"
            aria-expanded={agentOpen}
            aria-controls="agent-hud-panel"
            title={`${SCENARIO.localAgentPresentation.name} · ${SCENARIO.localAgentPresentation.mode}`}
            onClick={() => setAgentPinned((v) => !v)}
          >
            <span className="agent-hud-sparkle" aria-hidden />
            <b>{SCENARIO.localAgentPresentation.name}</b>
            <span className="agent-hud-chip-status">
              · {SCENARIO.localAgentPresentation.mode}
            </span>
          </button>

          {agentOpen ? (
            <div className="agent-hud-panel" id="agent-hud-panel" role="dialog" aria-label="Nimi LocalAgent 面板">
              <header className="agent-hud-head">
                <span className="agent-hud-dot" data-status={state.agent.status} aria-hidden />
                <span className="agent-hud-head-main">
                  <b>
                    {SCENARIO.localAgentPresentation.name} · {AGENT_STATUS[state.agent.status] ?? state.agent.status}
                  </b>
                  <span>{SCENARIO.localAgentPresentation.kind}</span>
                </span>
                <button
                  type="button"
                  className="agent-hud-gear"
                  title="管理应用与 LocalAgent"
                  aria-label="管理应用与 LocalAgent"
                  onClick={onOpenApps}
                >
                  <Settings size={14} strokeWidth={1.8} aria-hidden />
                </button>
              </header>

              <section className="agent-hud-section">
                <span className="agent-hud-label">
                  <i className="agent-hud-label-ico" aria-hidden /> 今日心情
                </span>
                <span className="agent-hud-mood">
                  <i aria-hidden /> {AGENT_FEELING}
                </span>
              </section>

              <section className="agent-hud-section">
                <span className="agent-hud-label">
                  <i className="agent-hud-label-ico" aria-hidden /> 今日动态
                </span>
                <ul className="agent-hud-feed">
                  {AGENT_FEED.map((item) => (
                    <li key={item.text} data-done={item.done || undefined}>
                      {item.text}
                      {item.at ? <time>{item.at}</time> : null}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="agent-hud-section">
                <span className="agent-hud-label">
                  <i className="agent-hud-label-ico" aria-hidden /> 上次聊到
                </span>
                <p className="agent-hud-note">{AGENT_LAST_CHAT.text}</p>
                <span className="agent-hud-meta">{AGENT_LAST_CHAT.at}</span>
              </section>

              <section className="agent-hud-section">
                <span className="agent-hud-label">
                  <i className="agent-hud-label-ico" aria-hidden /> 你最近在做
                </span>
                <p className="agent-hud-note">{AGENT_RECENT}</p>
              </section>

              <div className="agent-hud-actions">
                <button
                  type="button"
                  className="agent-hud-btn primary"
                  onClick={() => {
                    setAgentPinned(false);
                    openApp('desktop');
                  }}
                >
                  <RotateCcw size={13} strokeWidth={1.8} aria-hidden /> 继续上次对话
                </button>
                <button
                  type="button"
                  className="agent-hud-btn"
                  onClick={() => {
                    setAgentPinned(false);
                    if (!state.ledgerOpen) toggleLedger();
                  }}
                >
                  <BarChart3 size={13} strokeWidth={1.8} aria-hidden /> 查看今日轨迹
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Pane>

      <Pane
        title="领域"
        className="pane-modules"
        actions={
          <button
            type="button"
            className="pane-action-enter"
            title="打开全部应用"
            aria-label="打开全部应用"
            onClick={onOpenApps}
          >
            从基座进入 <span aria-hidden>⤢</span>
          </button>
        }
        {...paneProps('modules', 3, 0.7, 0.2)}
      >
        <img className="cradle-modules-background" src={moduleBackgroundUrl} alt="" aria-hidden />
        <div className="cradle-modules-wrap">
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

      <Pane
        title="授权动态"
        actions={
          <IconButton
            tone="ghost"
            size="sm"
            className="cradle-grants-all"
            icon={<PanelRightOpen size={15} strokeWidth={1.8} aria-hidden />}
            title="查看全部授权"
            aria-label="查看全部授权，并打开交互账本授权页"
            onClick={onOpenGrantLedger}
          />
        }
        {...paneProps('grants', 4, 2.1, 0.3)}
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
                      带入织羽
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

      {receiptGrantId ? <GrantReceiptDialog grantId={receiptGrantId} onClose={() => setReceiptGrantId(null)} /> : null}
    </div>
  );
}
