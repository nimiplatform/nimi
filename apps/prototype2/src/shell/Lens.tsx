import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatePresence,
  motion,
  nimiOverlayBackdropMotion,
  nimiOverlayPanelMotion,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui';
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
  const reducedMotion = useNimiReducedMotion();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!lensOpen) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
    return () => {
      previousFocus?.focus();
    };
  }, [lensOpen]);

  const commands = useMemo<Command[]>(
    () => [
      { id: 'desktop', label: '打开 Desktop', hint: '宿主桌面 · main', run: () => openApp('desktop') },
      { id: 'zhiyu', label: '打开 织羽 Zhiyu', hint: 'AI 写作空间 · main', run: () => openApp('zhiyu') },
      { id: 'lab', label: '打开 Lab', hint: '工作台 · main', run: () => openApp('lab') },
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

  const q = query.trim().toLowerCase();
  const matched = q ? commands.filter((c) => (c.label + c.hint).toLowerCase().includes(q)) : commands;
  const clampedIndex = matched.length > 0 ? Math.min(activeIndex, matched.length - 1) : -1;

  const runAndClose = (c: Command) => {
    c.run();
    setLensOpen(false);
  };

  return (
    <AnimatePresence>
      {lensOpen ? (
        <motion.div
          key="lens-backdrop"
          className="lens-backdrop"
          onClick={() => setLensOpen(false)}
          {...nimiOverlayBackdropMotion({ reducedMotion })}
        >
          <motion.div
            key="lens-panel"
            className="lens pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
            data-nimi-material="glass-chrome"
            data-nimi-tone="overlay"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Lens"
            {...nimiOverlayPanelMotion({ kind: 'dialog', reducedMotion })}
          >
            <input
              ref={inputRef}
              value={query}
              role="combobox"
              aria-expanded={matched.length > 0}
              aria-controls="lens-command-list"
              aria-activedescendant={clampedIndex >= 0 ? `lens-cmd-${matched[clampedIndex]!.id}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' && matched.length > 0) {
                  e.preventDefault();
                  setActiveIndex((idx) => (idx + 1) % matched.length);
                } else if (e.key === 'ArrowUp' && matched.length > 0) {
                  e.preventDefault();
                  setActiveIndex((idx) => (idx - 1 + matched.length) % matched.length);
                } else if (e.key === 'Home' && matched.length > 0) {
                  e.preventDefault();
                  setActiveIndex(0);
                } else if (e.key === 'End' && matched.length > 0) {
                  e.preventDefault();
                  setActiveIndex(matched.length - 1);
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && clampedIndex >= 0) {
                  e.preventDefault();
                  runAndClose(matched[clampedIndex]!);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setLensOpen(false);
                }
              }}
              placeholder="输入命令 · open, tide, phase, reset…"
            />
            <div id="lens-command-list" className="lens-list" role="listbox" aria-label="命令列表">
              {matched.length === 0 ? <p className="t-caption lens-empty">没有匹配的命令</p> : null}
              {matched.map((c, i) => (
                <button
                  key={c.id}
                  id={`lens-cmd-${c.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === clampedIndex}
                  data-active={i === clampedIndex || undefined}
                  className="lens-row"
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => runAndClose(c)}
                >
                  <span>{c.label}</span>
                  <span className="t-mono">{c.hint}</span>
                  {i === clampedIndex ? <kbd>⏎</kbd> : null}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
