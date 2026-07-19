import { useEffect, useMemo, useRef, useState } from 'react';
import { useSim } from '../engine/SimContext';
import { useUi, PHASE_LABEL } from './UiContext';

interface Command {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/** The Lens — ⌘K command palette. */
export function Lens() {
  const { lensOpen, setLensOpen, cyclePhase, phase, toggleTide } = useUi();
  const { openApp, goHome, toggleLedger, resetSession } = useSim();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!lensOpen) return undefined;
    setQuery('');
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(focusTimer);
  }, [lensOpen]);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'desktop', label: '打开 Desktop', hint: '宿主桌面 · main', run: () => openApp('desktop') },
      { id: 'zhiyu', label: '打开 织语 Zhiyu', hint: 'AI 写作空间 · main', run: () => openApp('zhiyu') },
      { id: 'tester', label: '打开 Tester', hint: '工作台 · main', run: () => openApp('tester') },
      { id: 'home', label: '回到基座', hint: 'cradle', run: goHome },
      { id: 'ledger', label: '交互账本', hint: 'ledger', run: toggleLedger },
      {
        id: 'phase',
        label: `切换氛围相位（当前 ${PHASE_LABEL[phase]}）`,
        hint: 'atmosphere',
        run: cyclePhase,
      },
      { id: 'tide', label: 'Tide 概览', hint: 'overview', run: toggleTide },
      { id: 'reset', label: '重置会话（新 epoch）', hint: 'reset', run: resetSession },
    ],
    [openApp, goHome, toggleLedger, cyclePhase, phase, toggleTide, resetSession],
  );

  if (!lensOpen) return null;
  const q = query.trim().toLowerCase();
  const matched = q ? commands.filter((c) => (c.label + c.hint).toLowerCase().includes(q)) : commands;

  const runAndClose = (c: Command) => {
    c.run();
    setLensOpen(false);
  };

  return (
    <div
      className="lens-backdrop nimi-material-glass-thin backdrop-blur-[var(--nimi-backdrop-blur-thin)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-thin"
      data-nimi-tone="overlay"
      onClick={() => setLensOpen(false)}
    >
      <div
        className="lens pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
        data-nimi-material="glass-chrome"
        data-nimi-tone="overlay"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Lens"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matched[0]) runAndClose(matched[0]);
            if (e.key === 'Escape') setLensOpen(false);
          }}
          placeholder="输入命令 · open, tide, phase, reset…"
        />
        <div className="lens-list">
          {matched.length === 0 ? <p className="t-caption lens-empty">没有匹配的命令</p> : null}
          {matched.map((c, i) => (
            <button key={c.id} type="button" className="lens-row" onClick={() => runAndClose(c)}>
              <span>{c.label}</span>
              <span className="t-mono">{c.hint}</span>
              {i === 0 ? <kbd>⏎</kbd> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
