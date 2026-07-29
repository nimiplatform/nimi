import { useState } from 'react';
import { SCENARIO } from '../scenario/scenario';
import { useSim, type SimWindow } from '../engine/SimContext';

type DeskTab = 'chat' | 'explore' | 'settings';

/** Mock of the Desktop main surface. Product shape only — no real renderer. */
export function DesktopMain({ win }: { win: SimWindow }) {
  const { state, runFlow } = useSim();
  const [tab, setTab] = useState<DeskTab>(win.route.startsWith('/explore') ? 'explore' : 'chat');
  const echoVale = SCENARIO.worlds.find((w) => w.id === 'echo-vale')!;
  const pinned = state.footprints.some((f) => f.worldId === 'echo-vale');

  return (
    <div className="mod mod-desktop">
      <nav className="mod-tabs">
        <button type="button" data-active={tab === 'chat'} onClick={() => setTab('chat')}>
          会话
        </button>
        <button type="button" data-active={tab === 'explore'} onClick={() => setTab('explore')}>
          探索
        </button>
        <button
          type="button"
          className="tab-disabled"
          title="宿主能力未声明：运行时设置在本模拟中不可用"
          onClick={() => setTab('settings')}
        >
          设置
        </button>
      </nav>

      {tab === 'chat' ? (
        <div className="mod-panel desk-chat">
          <div className="chat-scroll">
            {state.desktopChat.map((m) => (
              <div key={m.id} className={`msg msg-${m.who}`}>
                {m.who === 'agent' ? <span className="agent-orb sm" data-status="idle" /> : null}
                <div className="msg-bubble" data-agent={m.who === 'agent'}>
                  <p>{m.text}</p>
                  <span className="t-mono">{m.who === 'agent' ? 'Nimi · Runtime LocalAgent' : '林澈'} · {m.at}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="chat-footer">
            <span className="t-caption">此处显示 Runtime 对 Nimi LocalAgent 的应用投影（aurora 为投影标识）</span>
            <button type="button" className="sys-btn primary small" onClick={() => runFlow('local-agent.project')}>
              让 Nimi 把摘要带到织羽
            </button>
          </div>
        </div>
      ) : null}

      {tab === 'explore' ? (
        <div className="mod-panel desk-explore">
          <div className="world-panel" style={{ ['--world-hue' as string]: echoVale.hue }}>
            <span className="t-overline">探索 · 游戏世界</span>
            <h3>
              {echoVale.name} <em>{echoVale.en}</em>
            </h3>
            <p>{echoVale.blurb}</p>
            <div className="world-foot">
              <span className="t-caption">{echoVale.presence}</span>
              {pinned ? <span className="chip" data-tone="primary">已收录进生态足迹</span> : null}
            </div>
            <div className="world-actions">
              <button type="button" className="sys-btn small" onClick={() => runFlow('world.pin')} disabled={pinned}>
                {pinned ? '已收录' : '收录进生态足迹'}
              </button>
              <button type="button" className="sys-btn small" onClick={() => runFlow('handoff.zhiyu')}>
                带入织羽继续
              </button>
            </div>
            <p className="cradle-note dim">
              「收录」会经你已授权的「生态足迹写入」提交一条跨应用可见的足迹；Tester 的世界巡游会观察到它。
            </p>
          </div>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="mod-panel mod-empty">
          <span className="chip" data-tone="warning">SIMULATOR_UNSUPPORTED</span>
          <p>
            「运行时设置」需要未声明的宿主能力。生产主机上它由真实宿主提供；本模拟不伪造成功——
            这是能力驱动的不可用态，而不是隐藏入口。
          </p>
        </div>
      ) : null}
    </div>
  );
}
