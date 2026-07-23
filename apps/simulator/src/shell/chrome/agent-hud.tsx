import { useState } from 'react';
import { useUi } from './ui-context.tsx';
import { useProductPresentation } from './product-presentation.tsx';

/* Inline SVG icons (lucide-react is intentionally NOT imported by simulator
 * sources: the resolver's mandatory-singleton catalog is pinned). */
function SettingsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2 17 7M7 17l-1.8 1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RotateCcwIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 3v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function BarChartIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 17v-6M13 17V7M18 17v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const AGENT_STATUS: Record<string, string> = {
  idle: '待命中',
  observing: '主动运行中',
  migrating: '迁移中',
  acting: '行动中',
};

/** Mock content for the agent HUD panel — presentation seeds, not memory. */
const AGENT_FEELING = '平静 · 专注';
const AGENT_FEED = [
  { text: '整理了 2 条生态足迹', done: true, at: null },
  { text: '在星港停留 23 分钟', done: false, at: null },
  { text: '为你恢复上次对话上下文', done: false, at: '14:27' },
];
const AGENT_LAST_CHAT = { text: '回声谷 · 低语回廊，停在第三段回声', at: '昨天 22:41' };
const AGENT_RECENT = '你在优化世界入口与 Agent 呈现方式';

/** Base-agent presence chip + expandable panel (cradle agent pane content).
 * 继续上次对话 runs the consentable agent.carry demo flow. */
export function AgentHud({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const { setAppsPageOpen } = useUi();
  const { agent, agentPersona, runFlow, ledgerOpen, toggleLedger } = useProductPresentation();
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || pinned;

  const setOpen = (next: boolean) => {
    setPinned(next);
    onOpenChange?.(next || hover);
  };

  return (
    <div
      className="agent-hud"
      data-open={open || undefined}
      onMouseEnter={() => {
        setHover(true);
        onOpenChange?.(true);
      }}
      onMouseLeave={() => {
        setHover(false);
        onOpenChange?.(pinned);
      }}
    >
      <button
        type="button"
        className="agent-hud-chip"
        aria-expanded={open}
        aria-controls="agent-hud-panel"
        title={`${agentPersona.name} · ${agentPersona.mode}`}
        onClick={() => setOpen(!pinned)}
      >
        <span className="agent-hud-sparkle" aria-hidden />
        <b>{agentPersona.name}</b>
        <span className="agent-hud-chip-status">
          · {agentPersona.mode}
        </span>
      </button>

      {open ? (
        <div className="agent-hud-panel" id="agent-hud-panel" role="dialog" aria-label="Nimi agent 面板">
          <header className="agent-hud-head">
            <span className="agent-hud-dot" data-status={agent.status} aria-hidden />
            <span className="agent-hud-head-main">
              <b>
                {agentPersona.name} · {AGENT_STATUS[agent.status] ?? agent.status}
              </b>
              <span>{agentPersona.kind}</span>
            </span>
            <button
              type="button"
              className="agent-hud-gear"
              title="管理应用与 agent"
              aria-label="管理应用与 agent"
              onClick={() => setAppsPageOpen(true)}
            >
              <SettingsIcon size={14} />
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
                setOpen(false);
                runFlow('agent.carry');
              }}
            >
              <RotateCcwIcon size={13} /> 继续上次对话
            </button>
            <button
              type="button"
              className="agent-hud-btn"
              onClick={() => {
                setOpen(false);
                if (!ledgerOpen) toggleLedger();
              }}
            >
              <BarChartIcon size={13} /> 查看今日轨迹
            </button>
          </div>

          <span className="agent-hud-meta">模拟演示 · 以上动态为演示投影，不是真实记忆。</span>
        </div>
      ) : null}
    </div>
  );
}
